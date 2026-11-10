import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_SETTINGS, DEFAULT_EVENTS, DEFAULT_PLACES } from './seed.js';

export function openDb(file = process.env.DB_FILE || 'data/wedding.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY,
      role      TEXT NOT NULL CHECK (role IN ('admin','guest','driver')),
      name      TEXT NOT NULL,
      phone     TEXT,
      login     TEXT UNIQUE,          -- admin/driver username
      pass_hash TEXT,                 -- admin/driver password (scrypt)
      code      TEXT UNIQUE,          -- guest invite code
      seats     INTEGER DEFAULT 4,    -- driver: passenger capacity
      vehicle   TEXT,                 -- driver: car description
      available INTEGER DEFAULT 1,    -- driver: on duty
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, starts_at INTEGER NOT NULL,
      venue TEXT, details TEXT
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL, body TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id DESC);
    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, address TEXT,
      maps_url TEXT, note TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rides (
      id INTEGER PRIMARY KEY,
      guest_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      driver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      pickup TEXT NOT NULL, dropoff TEXT NOT NULL,
      pickup_at INTEGER NOT NULL,
      passengers INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested','assigned','enroute','completed','cancelled')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id, pickup_at);
  `);
  // additive migrations for databases created by earlier versions
  const addCol = (table, col, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addCol('places', 'kind', "TEXT NOT NULL DEFAULT 'eat'");
  addCol('places', 'city', 'TEXT');
  addCol('places', 'lat', 'REAL');
  addCol('places', 'lng', 'REAL');
  addCol('places', 'approx', 'INTEGER NOT NULL DEFAULT 0');
  addCol('notifications', 'url', 'TEXT');   // optional link, e.g. directions to where the meal is served
  addCol('users', 'rsvp', 'TEXT');            // 'yes' | 'no'
  addCol('users', 'rsvp_count', 'INTEGER');   // how many people are coming
  return db;
}

/** Fill in wedding details/schedule/places that are missing. Never overwrites what the admin edited. */
export function seedContent(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  if (!db.prepare('SELECT 1 FROM events').get())
    for (const e of DEFAULT_EVENTS) db.prepare('INSERT INTO events (title,starts_at,venue,details) VALUES (?,?,?,?)').run(e.title, e.starts_at, e.venue, e.details);
  if (!db.prepare('SELECT 1 FROM places').get() && process.env.SEED_PLACES !== '0')
    for (const p of DEFAULT_PLACES)
      db.prepare('INSERT INTO places (name,category,address,maps_url,note,created_at,kind,city,lat,lng,approx) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(p.name, p.category, p.address, '', p.note, Date.now(), p.kind, p.city, p.lat, p.lng, p.approx ? 1 : 0);
}

/* ---------- password hashing (scrypt, no extra deps) ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const expect = Buffer.from(h, 'hex');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'hex'), expect.length);
  return crypto.timingSafeEqual(got, expect);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function newInviteCode(len = 6) {
  let c = '';
  for (let i = 0; i < len; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return c;
}

/** Create the admin on first run. Password comes from env, else is generated and printed once. */
export function seedAdmin(db) {
  if (db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) return null;
  const login = process.env.ADMIN_USER || 'admin';
  let pass = process.env.ADMIN_PASS;
  let generated = false;
  if (!pass) { pass = crypto.randomBytes(9).toString('base64url'); generated = true; }
  db.prepare("INSERT INTO users (role,name,login,pass_hash,created_at) VALUES ('admin','Admin',?,?,?)")
    .run(login, hashPassword(pass), Date.now());
  return { login, pass: generated ? pass : '(from ADMIN_PASS)' };
}
