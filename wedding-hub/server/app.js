import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, newInviteCode } from './db.js';
import { DEFAULT_SETTINGS } from './seed.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSION_MS = 14 * 24 * 3600 * 1000;
const RIDE_WINDOW_MS = 90 * 60 * 1000; // a driver is busy ±90 min around an accepted pickup
const LIVE = ['assigned', 'enroute'];

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
const PLACE_KINDS = ['eat', 'visit', 'stay', 'home', 'airport'];
// digits only; drops India's +91 / leading 0 so "+91 98765 43210", "098765 43210" and "9876543210" are one account
const normPhone = (v) => {
  const d = String(v ?? '').replace(/[\s\-().+]/g, '');
  return /^\d+$/.test(d) ? (d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d) : d;
};
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '');

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:",
    });
    next();
  });

  /* ---------- tx helper ---------- */
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  /* ---------- live notifications (Server-Sent Events) ---------- */
  const streams = new Map(); // userId -> Set<res>
  const emit = (userId, event, data) => {
    for (const res of streams.get(userId) || []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const notify = (userId, title, body = '', kind = 'info', url = null) => {
    const created_at = Date.now();
    const r = db.prepare('INSERT INTO notifications (user_id,kind,title,body,created_at,url) VALUES (?,?,?,?,?,?)')
      .run(userId, kind, title, body, created_at, url);
    emit(userId, 'notification', { id: Number(r.lastInsertRowid), kind, title, body, url, read: 0, created_at });
  };
  const notifyRole = (role, title, body, kind, url) => {
    for (const u of db.prepare('SELECT id FROM users WHERE role=?').all(role)) notify(u.id, title, body, kind, url);
  };
  const placeUrl = (p) => p.maps_url || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([p.name, p.address, p.city].filter(Boolean).join(', '));

  /* ---------- auth ---------- */
  // Only FAILED logins are counted, so a whole wedding party on one Wi-Fi/mobile network is never locked out.
  const attempts = new Map(); // ip -> {n, reset}
  const isLocked = (ip) => { const a = attempts.get(ip); return !!a && a.reset > Date.now() && a.n >= 30; };
  const recordFailure = (ip) => {
    const now = Date.now(), a = attempts.get(ip);
    if (!a || a.reset < now) attempts.set(ip, { n: 1, reset: now + 10 * 60 * 1000 }); else a.n++;
  };
  const cookieOf = (req) => /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
  const setCookie = (res, token, maxAge) =>
    res.append('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);

  app.use((req, _res, next) => {
    const token = cookieOf(req);
    if (token) {
      req.user = db.prepare(`SELECT u.id,u.role,u.name,u.phone,u.seats,u.vehicle,u.available,u.rsvp,u.rsvp_count,u.stay_type,u.stay_room,u.stay_place_id,
        p.name stay_place, p.address stay_address, p.city stay_city, p.maps_url stay_maps FROM sessions s
        JOIN users u ON u.id=s.user_id LEFT JOIN places p ON p.id=u.stay_place_id WHERE s.token=? AND s.created_at>?`).get(token, Date.now() - SESSION_MS);
    }
    next();
  });
  const need = (...roles) => (req, res, next) =>
    !req.user ? res.status(401).json({ error: 'Please log in' })
      : roles.length && !roles.includes(req.user.role) ? res.status(403).json({ error: 'Not allowed' })
        : next();

  app.get('/api/settings', (req, res) => {
    const all = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((r) => [r.key, r.value]));
    if (req.user?.role !== 'admin') { all.reg_needs_passcode = all.reg_passcode ? '1' : '0'; delete all.reg_passcode; } // never reveal the passcode
    res.json(all);
  });

  app.post('/api/login', (req, res) => {
    if (isLocked(req.ip)) return res.status(429).json({ error: 'Too many attempts, try again later' });
    let user;
    if (req.body.code) { // guest: invite code only
      user = db.prepare("SELECT * FROM users WHERE role='guest' AND code=?").get(str(req.body.code, 20).toUpperCase());
    } else {
      const raw = str(req.body.login, 60).toLowerCase();
      const u = db.prepare('SELECT * FROM users WHERE login=?').get(raw) || db.prepare("SELECT * FROM users WHERE role='guest' AND login=?").get(normPhone(raw));
      if (u && verifyPassword(str(req.body.password, 200), u.pass_hash)) user = u;
    }
    if (!user) { recordFailure(req.ip); return res.status(401).json({ error: 'Wrong details, please check and retry' }); }
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').run(token, user.id, Date.now());
    setCookie(res, token, SESSION_MS / 1000);
    res.json({ ok: true });
  });

  /* ---------- guest self-registration ---------- */
  const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
  const regs = new Map(); // ip -> {n, reset}; generous, since a whole wedding party may share one network
  const startSession = (res, userId) => {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').run(token, userId, Date.now());
    setCookie(res, token, SESSION_MS / 1000);
  };
  app.post('/api/register', (req, res) => {
    const cfg = Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE key IN ('reg_open','reg_passcode')").all().map((r) => [r.key, r.value]));
    if (cfg.reg_open === '0') return res.status(403).json({ error: 'Registration is closed. Please use the invite code you were sent, or ask the family.' });
    const now = Date.now(), r = regs.get(req.ip);
    if (!r || r.reset < now) regs.set(req.ip, { n: 1, reset: now + 3600000 }); else if (++r.n > 60) return res.status(429).json({ error: 'Too many registrations, try again later' });
    if (cfg.reg_passcode && !crypto.timingSafeEqual(sha(str(req.body.passcode, 60).toLowerCase()), sha(cfg.reg_passcode.toLowerCase())))
      return res.status(403).json({ error: 'Wrong passcode. It is printed on your invitation.' });
    const name = str(req.body.name, 80), phone = normPhone(req.body.phone), password = str(req.body.password, 200);
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
    if (!/^\d{10,15}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid mobile number (10 to 15 digits)' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (db.prepare('SELECT 1 FROM users WHERE login=?').get(phone)) return res.status(409).json({ error: 'This number is already registered. Please sign in instead.' });
    const ins = db.prepare("INSERT INTO users (role,name,phone,login,pass_hash,code,created_at) VALUES ('guest',?,?,?,?,?,?)");
    let id;
    for (let i = 0; i < 20 && !id; i++) {
      try { id = Number(ins.run(name, phone, phone, hashPassword(password), newInviteCode(), Date.now()).lastInsertRowid); }
      catch (e) { if (!/UNIQUE/.test(e.message)) throw e; if (db.prepare('SELECT 1 FROM users WHERE login=?').get(phone)) return res.status(409).json({ error: 'This number is already registered. Please sign in instead.' }); }
    }
    notifyRole('admin', `New guest registered: ${name}`, phone, 'info');
    startSession(res, id);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const t = cookieOf(req);
    if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  app.get('/api/me', need(), (req, res) => {
    const u = req.user;
    res.json({ ...u, stay_url: u.stay_place ? placeUrl({ name: u.stay_place, address: u.stay_address, city: u.stay_city, maps_url: u.stay_maps }) : null });
  });

  app.get('/api/stream', need(), (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const set = streams.get(req.user.id) || streams.set(req.user.id, new Set()).get(req.user.id);
    set.add(res);
    const ka = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ka); set.delete(res); if (!set.size) streams.delete(req.user.id); });
  });

  /* ---------- settings & schedule (admin edits) ---------- */
  app.put('/api/settings', need('admin'), (req, res) => {
    const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof req.body[k] !== 'string') continue;
      const v = str(req.body[k], 400);
      if (k === 'maps_url' && v && !safeUrl(v)) return res.status(400).json({ error: 'Maps link must start with http(s)://' });
      if (['event_start', 'event_end', 'reception_start'].includes(k) && v && Number.isNaN(Date.parse(v))) return res.status(400).json({ error: 'Invalid date/time' });
      up.run(k, v);
    }
    res.json({ ok: true });
  });

  app.get('/api/events', need(), (_req, res) => res.json(db.prepare('SELECT * FROM events ORDER BY starts_at').all()));
  app.post('/api/events', need('admin'), (req, res) => {
    const title = str(req.body.title, 120), starts_at = int(req.body.starts_at);
    if (!title || !starts_at) return res.status(400).json({ error: 'Title and time are required' });
    const ends_at = int(req.body.ends_at) || null;
    if (ends_at && ends_at <= starts_at) return res.status(400).json({ error: 'End time must be after the start time' });
    db.prepare('INSERT INTO events (title,starts_at,ends_at,venue,details) VALUES (?,?,?,?,?)')
      .run(title, starts_at, ends_at, str(req.body.venue, 200), str(req.body.details, 500));
    res.json({ ok: true });
  });
  app.delete('/api/events/:id', need('admin'), (req, res) => {
    db.prepare('DELETE FROM events WHERE id=?').run(int(req.params.id));
    res.json({ ok: true });
  });

  /* ---------- notifications ---------- */
  app.get('/api/notifications', need(), (req, res) => {
    res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id));
  });
  app.post('/api/notifications/read', need(), (req, res) => {
    db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
    res.json({ ok: true });
  });

  // Admin broadcast. kind: 'info' | 'meal'
  app.post('/api/announce', need('admin'), (req, res) => {
    const sent = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role='guest'").get().c;
    // Meal alert: "<Meal> is ready at <place>", with the place's address and a directions link.
    if (req.body.meal) {
      const meal = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'].find((m) => m === req.body.meal);
      if (!meal) return res.status(400).json({ error: 'Choose Breakfast, Lunch, Snacks or Dinner' });
      const place = db.prepare('SELECT * FROM places WHERE id=?').get(int(req.body.place_id));
      if (!place) return res.status(400).json({ error: 'Choose where the meal is served' });
      const body = [`Please head to ${place.name}${place.address ? ', ' + place.address : ''}.`, str(req.body.note, 200)].filter(Boolean).join(' ');
      notifyRole('guest', `${meal} is ready at ${place.name} 🍛`, body, 'meal', placeUrl(place));
      return res.json({ ok: true, sent: sent() });
    }
    const title = str(req.body.title, 120);
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const kind = req.body.kind === 'meal' ? 'meal' : 'info';
    notifyRole('guest', title, str(req.body.body, 500), kind);
    res.json({ ok: true, sent: sent() });
  });

  /* ---------- nearby places ---------- */
  app.get('/api/places', need(), (_req, res) => res.json(db.prepare('SELECT * FROM places ORDER BY city, kind, id').all()));
  app.post('/api/places', need('admin'), (req, res) => {
    const name = str(req.body.name, 120);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const lat = num(req.body.lat), lng = num(req.body.lng);
    if ((lat != null && Math.abs(lat) > 90) || (lng != null && Math.abs(lng) > 180)) return res.status(400).json({ error: 'Invalid coordinates' });
    const r = db.prepare('INSERT INTO places (name,category,address,maps_url,note,created_at,kind,city,lat,lng,approx) VALUES (?,?,?,?,?,?,?,?,?,?,0)')
      .run(name, str(req.body.category, 40), str(req.body.address, 200), safeUrl(str(req.body.maps_url, 500)), str(req.body.note, 300), Date.now(),
        PLACE_KINDS.includes(req.body.kind) ? req.body.kind : 'eat', str(req.body.city, 40), lat, lng);
    if (req.body.notify) notifyRole('guest', `New place added: ${name}`, str(req.body.note, 200) || str(req.body.address, 200), 'place', placeUrl({ name, address: str(req.body.address, 200), city: str(req.body.city, 40), maps_url: safeUrl(str(req.body.maps_url, 500)) }));
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });
  app.delete('/api/places/:id', need('admin'), (req, res) => {
    db.prepare('DELETE FROM places WHERE id=?').run(int(req.params.id));
    res.json({ ok: true });
  });

  /* ---------- people (admin) ---------- */
  app.get('/api/guests', need('admin'), (_req, res) =>
    res.json(db.prepare(`SELECT u.id,u.name,u.phone,u.code,u.login,u.rsvp,u.rsvp_count,u.stay_type,u.stay_room,u.stay_place_id,p.name stay_place
      FROM users u LEFT JOIN places p ON p.id=u.stay_place_id WHERE u.role='guest' ORDER BY u.name`).all()));
  app.post('/api/guests', need('admin'), (req, res) => {
    // accepts one name or many (one per line) for fast bulk entry
    const names = (Array.isArray(req.body.names) ? req.body.names : [req.body.name]).map((n) => str(n, 80)).filter(Boolean);
    if (!names.length) return res.status(400).json({ error: 'Add at least one name' });
    const ins = db.prepare("INSERT INTO users (role,name,phone,code,created_at) VALUES ('guest',?,?,?,?)");
    const made = tx(() => names.map((name) => {
      for (let i = 0; i < 20; i++) {
        const code = newInviteCode();
        try { ins.run(name, str(req.body.phone, 30), code, Date.now()); return { name, code }; }
        catch (e) { if (!/UNIQUE/.test(e.message)) throw e; }
      }
      throw new Error('Could not generate a unique code');
    }));
    res.json({ ok: true, guests: made });
  });

  // Admin can set a new temporary password for a guest who forgot theirs (signs out their old sessions).
  app.post('/api/guests/:id/reset-password', need('admin'), (req, res) => {
    const g = db.prepare("SELECT id FROM users WHERE id=? AND role='guest'").get(int(req.params.id));
    if (!g) return res.status(404).json({ error: 'Guest not found' });
    const password = newInviteCode(8);
    db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(password), g.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(g.id);
    res.json({ ok: true, password });
  });

  // Where a guest is staying: a hotel (with room number), the new house or the old house.
  const STAYS = { hotel: 'Hotel', new_house: 'New house', old_house: 'Old house' };
  app.put('/api/guests/:id/stay', need('admin'), (req, res) => {
    const g = db.prepare("SELECT id FROM users WHERE id=? AND role='guest'").get(int(req.params.id));
    if (!g) return res.status(404).json({ error: 'Guest not found' });
    const type = str(req.body.type, 20);
    if (type && !STAYS[type]) return res.status(400).json({ error: 'Choose hotel, new house or old house' });
    const place = req.body.place_id ? db.prepare('SELECT * FROM places WHERE id=?').get(int(req.body.place_id)) : null;
    if (req.body.place_id && !place) return res.status(400).json({ error: 'Place not found' });
    const room = type === 'hotel' ? str(req.body.room, 20) : '';
    if (type === 'hotel' && !place) return res.status(400).json({ error: 'Choose the hotel' });
    db.prepare('UPDATE users SET stay_type=?, stay_place_id=?, stay_room=? WHERE id=?')
      .run(type || null, type && place ? place.id : null, type ? room : null, g.id);
    if (type) {
      const where = [STAYS[type], place && place.name !== STAYS[type] ? place.name : '', room ? `Room ${room}` : ''].filter(Boolean).join(' · ');
      notify(g.id, 'Your stay is confirmed', where, 'stay', place ? placeUrl(place) : null);
    }
    res.json({ ok: true });
  });

  app.get('/api/drivers', need('admin'), (_req, res) =>
    res.json(db.prepare("SELECT id,name,phone,login,seats,vehicle,available FROM users WHERE role='driver' ORDER BY name").all()));
  app.post('/api/drivers', need('admin'), (req, res) => {
    const name = str(req.body.name, 80), login = str(req.body.login, 60).toLowerCase(), pw = str(req.body.password, 200);
    if (!name || !login || pw.length < 6) return res.status(400).json({ error: 'Name, username and a 6+ character password are required' });
    try {
      db.prepare("INSERT INTO users (role,name,phone,login,pass_hash,seats,vehicle,created_at) VALUES ('driver',?,?,?,?,?,?,?)")
        .run(name, str(req.body.phone, 30), login, hashPassword(pw), Math.min(Math.max(int(req.body.seats, 4), 1), 20), str(req.body.vehicle, 80), Date.now());
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'That username is taken' });
      throw e;
    }
    res.json({ ok: true });
  });
  // guests and drivers only: never delete the admin
  app.delete('/api/people/:id', need('admin'), (req, res) => {
    db.prepare("DELETE FROM users WHERE id=? AND role IN ('guest','driver')").run(int(req.params.id));
    res.json({ ok: true });
  });
  app.post('/api/drivers/me/available', need('driver'), (req, res) => {
    db.prepare('UPDATE users SET available=? WHERE id=?').run(req.body.available ? 1 : 0, req.user.id);
    if (req.body.available) assignWaiting();
    res.json({ ok: true });
  });

  /* ---------- RSVP ---------- */
  app.post('/api/rsvp', need('guest'), (req, res) => {
    const yes = req.body.attending === true;
    const count = yes ? Math.min(Math.max(int(req.body.count, 1), 1), 20) : null;
    db.prepare('UPDATE users SET rsvp=?, rsvp_count=? WHERE id=?').run(yes ? 'yes' : 'no', count, req.user.id);
    notifyRole('admin', `${req.user.name} ${yes ? `is coming (${count})` : 'cannot make it'}`, '', 'rsvp');
    res.json({ ok: true, rsvp: yes ? 'yes' : 'no', rsvp_count: count });
  });
  app.get('/api/rsvp/summary', need('admin'), (_req, res) => {
    res.json(db.prepare(`SELECT COALESCE(SUM(rsvp='yes'),0) yes_households, COALESCE(SUM(CASE WHEN rsvp='yes' THEN rsvp_count END),0) people,
      COALESCE(SUM(rsvp='no'),0) declined, COALESCE(SUM(rsvp IS NULL),0) pending FROM users WHERE role='guest'`).get());
  });

  /* ---------- cab booking ---------- */
  const rideSelect = `SELECT r.*, g.name guest_name, g.phone guest_phone,
      d.name driver_name, d.phone driver_phone, d.vehicle driver_vehicle
    FROM rides r JOIN users g ON g.id=r.guest_id LEFT JOIN users d ON d.id=r.driver_id`;
  const fmt = (ms) => new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  /** Pick the free, big-enough driver with the fewest trips. Must run inside a transaction. */
  function pickDriver(ride) {
    return db.prepare(`
      SELECT u.id FROM users u
      WHERE u.role='driver' AND u.available=1 AND u.seats>=?
        AND NOT EXISTS (SELECT 1 FROM rides x WHERE x.driver_id=u.id AND x.status IN ('assigned','enroute')
                        AND x.id<>? AND ABS(x.pickup_at-?)<?)
      ORDER BY (SELECT COUNT(*) FROM rides y WHERE y.driver_id=u.id AND y.status<>'cancelled'), u.id
      LIMIT 1`).get(ride.passengers, ride.id, ride.pickup_at, RIDE_WINDOW_MS)?.id;
  }

  function assign(rideId, driverId) {
    db.prepare("UPDATE rides SET driver_id=?, status='assigned' WHERE id=?").run(driverId, rideId);
    const r = db.prepare(rideSelect + ' WHERE r.id=?').get(rideId);
    notify(r.guest_id, 'Your cab is booked', `${r.driver_name}${r.driver_vehicle ? ` (${r.driver_vehicle})` : ''} will pick you up at ${fmt(r.pickup_at)}. ${r.driver_phone ? 'Call: ' + r.driver_phone : ''}`.trim(), 'ride');
    notify(driverId, 'New trip assigned', `${r.guest_name}: ${r.pickup} → ${r.dropoff}, ${fmt(r.pickup_at)}, ${r.passengers} passenger(s)`, 'ride');
  }

  /** Give any waiting requests to newly-free drivers, oldest pickup first. */
  function assignWaiting() {
    tx(() => {
      for (const r of db.prepare("SELECT * FROM rides WHERE status='requested' AND pickup_at>? ORDER BY pickup_at").all(Date.now() - RIDE_WINDOW_MS)) {
        const d = pickDriver(r);
        if (d) assign(r.id, d);
      }
    });
  }

  app.post('/api/rides', need('guest'), (req, res) => {
    const pickup = str(req.body.pickup, 200), dropoff = str(req.body.dropoff, 200);
    const pickup_at = int(req.body.pickup_at), passengers = Math.min(Math.max(int(req.body.passengers, 1), 1), 20);
    if (!pickup || !dropoff) return res.status(400).json({ error: 'Pickup and drop-off are required' });
    if (pickup_at < Date.now() - 5 * 60 * 1000) return res.status(400).json({ error: 'Pickup time must be in the future' });
    const out = tx(() => {
      const id = Number(db.prepare('INSERT INTO rides (guest_id,pickup,dropoff,pickup_at,passengers,notes,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(req.user.id, pickup, dropoff, pickup_at, passengers, str(req.body.notes, 300), Date.now()).lastInsertRowid);
      const driver = pickDriver({ id, passengers, pickup_at });
      if (driver) assign(id, driver);
      else notifyRole('admin', 'Cab request needs a driver', `${req.user.name}: ${pickup} → ${dropoff}, ${fmt(pickup_at)}`, 'ride');
      return db.prepare(rideSelect + ' WHERE r.id=?').get(id);
    });
    res.json(out);
  });

  app.get('/api/rides', need(), (req, res) => {
    const { role, id } = req.user;
    const where = role === 'guest' ? 'WHERE r.guest_id=?' : role === 'driver' ? 'WHERE r.driver_id=?' : 'WHERE ?=?';
    res.json(db.prepare(`${rideSelect} ${where} ORDER BY r.pickup_at DESC LIMIT 200`).all(...(role === 'admin' ? [1, 1] : [id])));
  });

  app.post('/api/rides/:id/cancel', need('guest', 'admin'), (req, res) => {
    const r = db.prepare('SELECT * FROM rides WHERE id=?').get(int(req.params.id));
    if (!r || (req.user.role === 'guest' && r.guest_id !== req.user.id)) return res.status(404).json({ error: 'Not found' });
    if (!['requested', 'assigned'].includes(r.status)) return res.status(409).json({ error: 'This trip can no longer be cancelled' });
    db.prepare("UPDATE rides SET status='cancelled' WHERE id=?").run(r.id);
    if (r.driver_id) notify(r.driver_id, 'Trip cancelled', `${fmt(r.pickup_at)}: ${r.pickup} → ${r.dropoff}`, 'ride');
    if (req.user.role === 'admin') notify(r.guest_id, 'Your cab was cancelled', `${fmt(r.pickup_at)}. Please book again.`, 'ride');
    assignWaiting(); // the freed driver may now take a waiting request
    res.json({ ok: true });
  });

  app.post('/api/rides/:id/status', need('driver'), (req, res) => {
    const to = req.body.status;
    const r = db.prepare('SELECT * FROM rides WHERE id=? AND driver_id=?').get(int(req.params.id), req.user.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const ok = (r.status === 'assigned' && to === 'enroute') || (['assigned', 'enroute'].includes(r.status) && to === 'completed');
    if (!ok) return res.status(409).json({ error: 'Invalid status change' });
    db.prepare('UPDATE rides SET status=? WHERE id=?').run(to, r.id);
    if (to === 'enroute') notify(r.guest_id, 'Your driver is on the way', `${req.user.name} is heading to ${r.pickup}.`, 'ride');
    else assignWaiting();
    res.json({ ok: true });
  });

  app.post('/api/rides/:id/assign', need('admin'), (req, res) => {
    const r = db.prepare('SELECT * FROM rides WHERE id=?').get(int(req.params.id));
    const d = db.prepare("SELECT id FROM users WHERE id=? AND role='driver'").get(int(req.body.driver_id));
    if (!r || !d) return res.status(404).json({ error: 'Not found' });
    if (!['requested', 'assigned'].includes(r.status)) return res.status(409).json({ error: 'Trip is already ' + r.status });
    tx(() => {
      if (r.driver_id && r.driver_id !== d.id) notify(r.driver_id, 'Trip reassigned', `${fmt(r.pickup_at)}: ${r.pickup} → ${r.dropoff}`, 'ride');
      assign(r.id, d.id);
    });
    res.json({ ok: true });
  });

  /* ---------- static + errors ---------- */
  // Calendar file so guests can save the muhurtham to their phone with one tap.
  app.get('/invite.ics', (_req, res) => {
    const st = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((r) => [r.key, r.value]));
    const z = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const esc = (t) => String(t || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
    const where = 'LOCATION:' + esc(`${st.venue}, ${st.venue_address}`), stamp = 'DTSTAMP:' + z(new Date().toISOString());
    const vevent = (id, summary, startIso, endIso, fallbackMs, note) => {
      const start = Date.parse(startIso), end = Date.parse(endIso);
      if (Number.isNaN(start)) return [];
      return ['BEGIN:VEVENT', `UID:${id}-${start}@wedding-hub`, stamp, 'DTSTART:' + z(start), 'DTEND:' + z(Number.isNaN(end) ? start + fallbackMs : end),
        'SUMMARY:' + esc(summary), where, 'DESCRIPTION:' + esc(note), 'END:VEVENT'];
    };
    const events = [
      ...vevent('reception', `Reception: ${st.couple}`, st.reception_start, '', 3 * 3600000, st.reception_text),
      ...vevent('wedding', `Wedding of ${st.couple} (Muhurtham)`, st.event_start, st.event_end, 3600000, st.muhurtham_text),
    ];
    if (!events.length) return res.status(404).end();
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="wedding.ics"' });
    res.send(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wedding Hub//EN', ...events, 'END:VCALENDAR'].join('\r\n'));
  });
  app.get('/app', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'app.html')));
  app.use(express.static(PUBLIC_DIR));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status === 400 ? 400 : 500).json({ error: err.status === 400 ? 'Bad request' : 'Something went wrong' });
  });
  return app;
}
