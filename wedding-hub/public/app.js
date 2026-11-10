/* Wedding Hub frontend. DOM is built with h() only (never innerHTML) so user text can't inject markup. */
const $app = document.getElementById('app');
const $toasts = document.getElementById('toasts');

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (typeof v === 'boolean' && k.startsWith('aria-')) { el.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
};

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && state.me) { state.me = null; showLogin(); }
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

let geo = null; // guest's location, kept only in memory for this visit
const state = { me: null, settings: {}, tab: null, unread: 0, es: null, refresh: null };
const when = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const STATUS = { requested: 'Finding a driver…', assigned: 'Driver booked', enroute: 'Driver on the way', completed: 'Completed', cancelled: 'Cancelled' };

function toast(title, body) {
  const t = h('div', { class: 'toast', role: 'status' }, h('b', {}, title), body || '');
  $toasts.append(t);
  setTimeout(() => t.remove(), 7000);
}

/* A form helper: runs fn(values), shows errors inline, disables button while busy. */
function form(fields, submitLabel, fn, { reset = true } = {}) {
  const err = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'block', type: 'submit' }, submitLabel);
  const f = h('form', { novalidate: true }, fields, err, btn);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await fn(new FormData(f)); if (reset) f.reset(); }
    catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; }
  });
  return f;
}
const field = (label, name, o = {}) => {
  const id = o.attrs?.id || 'f_' + name + Math.random().toString(36).slice(2, 6);
  const input = o.type === 'textarea' ? h('textarea', { id, name, ...o.attrs, value: null }, o.attrs?.value || '')
    : o.options ? h('select', { id, name }, o.options.map(([v, t]) => h('option', { value: v }, t)))
      : h('input', { id, name, type: o.type || 'text', ...o.attrs });
  return h('div', {}, h('label', { for: id }, label), input);
};

/* ---------------- login ---------------- */
function showLogin() {
  state.es?.close(); state.es = null;
  let mode = 'guest';
  const s = state.settings;
  const box = h('div');
  const draw = () => {
    box.replaceChildren(
      h('div', { class: 'seg', role: 'group' },
        h('button', { type: 'button', 'aria-pressed': mode === 'guest', onclick: () => { mode = 'guest'; draw(); } }, 'Guest'),
        h('button', { type: 'button', 'aria-pressed': mode === 'staff', onclick: () => { mode = 'staff'; draw(); } }, 'Driver / Admin')),
      mode === 'guest'
        ? form([field('Your invite code', 'code', { attrs: { autocomplete: 'off', autocapitalize: 'characters', placeholder: 'e.g. K7M2QX', required: true } })],
          'Enter', (fd) => api('POST', '/login', { code: fd.get('code') }).then(start), { reset: false })
        : form([field('Username', 'login', { attrs: { autocomplete: 'username', autocapitalize: 'none' } }),
          field('Password', 'password', { type: 'password', attrs: { autocomplete: 'current-password' } })],
        'Log in', (fd) => api('POST', '/login', { login: fd.get('login'), password: fd.get('password') }).then(start), { reset: false }),
    );
  };
  draw();
  $app.replaceChildren(h('div', { class: 'wrap' },
    h('div', { class: 'hero login-hero' }, h('div', { class: 'te' }, 'శుభ వివాహం'), h('p', {}, 'You are invited to celebrate'), h('h1', { class: 'script' }, s.couple), h('p', {}, `${s.date} · ${s.venue}`)),
    h('div', { class: 'card' }, box),
    h('p', { class: 'muted center' }, 'Your invite code is on your invitation, or ask the family. ', h('a', { href: '/' }, 'View the invitation'))));
}

/* ---------------- shell ---------------- */
const TABS = {
  guest: [['home', '🏠', 'Home'], ['cabs', '🚖', 'Cabs'], ['eat', '🍽️', 'Eat'], ['alerts', '🔔', 'Alerts']],
  driver: [['trips', '🚖', 'Trips'], ['alerts', '🔔', 'Alerts']],
  admin: [['send', '📣', 'Send'], ['rides', '🚖', 'Cabs'], ['guests', '👥', 'Guests'], ['places', '🍽️', 'Places'], ['drivers', '🧑‍✈️', 'Drivers'], ['setup', '⚙️', 'Setup'], ['alerts', '🔔', 'Alerts']],
};

async function start() {
  state.me = await api('GET', '/me');
  state.tab = TABS[state.me.role][0][0];
  const notifs = await api('GET', '/notifications');
  state.unread = notifs.filter((n) => !n.read).length;
  connectStream();
  render();
}

function connectStream() {
  state.es?.close();
  const es = new EventSource('/api/stream');
  es.addEventListener('notification', (e) => {
    const n = JSON.parse(e.data);
    state.unread++;
    toast(n.title, n.body);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(n.title, { body: n.body, tag: 'wh-' + n.id }); } catch { /* some mobiles only allow via service worker */ }
    }
    navigator.vibrate?.(n.kind === 'meal' ? [200, 100, 200] : 100);
    if (state.tab === 'alerts') state.refresh?.(); else if (['cabs', 'trips', 'rides'].includes(state.tab) && n.kind === 'ride') state.refresh?.();
    updateBadge();
  });
  state.es = es;
}
const updateBadge = () => {
  const b = document.querySelector('.badge');
  if (b) { b.textContent = state.unread; b.hidden = !state.unread; }
};

function render() {
  const { me } = state;
  const main = h('main', { class: 'wrap' });
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Sections' }, TABS[me.role].map(([id, ico, label]) =>
    h('button', { 'aria-current': id === state.tab ? 'page' : null, onclick: () => { state.tab = id; render(); } },
      h('span', { class: 'ico' }, ico, id === 'alerts' ? h('span', { class: 'badge', hidden: !state.unread }, state.unread) : null), label)));
  $app.replaceChildren(
    h('header', { class: 'top' }, h('span', { class: 'brand' }, state.settings.couple),
      h('span', { class: 'row' }, h('span', { class: 'muted' }, me.name),
        h('button', { class: 'ghost small', onclick: async () => { await api('POST', '/logout'); state.me = null; showLogin(); } }, 'Log out'))),
    main, tabs);
  const view = VIEWS[me.role][state.tab];
  const run = async () => { try { main.replaceChildren(...[await view()].flat(Infinity).filter(Boolean)); } catch (e) { main.replaceChildren(h('p', { class: 'err' }, e.message)); } };
  state.refresh = run;
  run();
}

const list = (items, empty, draw) => items.length ? items.map(draw) : h('div', { class: 'empty' }, empty);

/* ---------------- shared pieces ---------------- */
async function alertsView() {
  const items = await api('GET', '/notifications');
  api('POST', '/notifications/read').then(() => { state.unread = 0; updateBadge(); });
  const enable = 'Notification' in window && Notification.permission === 'default'
    ? h('div', { class: 'card row between' }, h('span', {}, 'Get alerts even when the app is in the background.'),
      h('button', { class: 'small', onclick: async (e) => { await Notification.requestPermission(); e.target.closest('.card').remove(); } }, 'Turn on'))
    : null;
  return [h('h2', {}, 'Alerts'), enable, list(items, 'Nothing yet. Meal and cab updates will show up here.', (n) =>
    h('div', { class: `card ${n.kind === 'meal' ? 'meal' : ''} ${n.read ? '' : 'unread'}` },
      h('b', {}, (n.kind === 'meal' ? '🍛 ' : n.kind === 'ride' ? '🚖 ' : n.kind === 'place' ? '📍 ' : '') + n.title),
      n.body ? h('div', {}, n.body) : null, h('div', { class: 'muted' }, when(n.created_at))))];
}

const rideCard = (r, actions = []) => h('div', { class: 'card' },
  h('div', { class: 'row between' }, h('b', {}, when(r.pickup_at)), h('span', { class: `pill ${r.status}` }, STATUS[r.status])),
  h('div', {}, `${r.pickup} → ${r.dropoff}`), h('div', { class: 'muted' }, `${r.passengers} passenger${r.passengers > 1 ? 's' : ''}${r.notes ? ' · ' + r.notes : ''}`),
  r.guest_name && state.me.role !== 'guest' ? h('div', {}, `👤 ${r.guest_name}`, r.guest_phone ? h('a', { href: 'tel:' + r.guest_phone }, ' ' + r.guest_phone) : '') : null,
  r.driver_name && state.me.role !== 'driver' ? h('div', {}, `🧑‍✈️ ${r.driver_name}${r.driver_vehicle ? ' · ' + r.driver_vehicle : ''} `,
    r.driver_phone ? h('a', { href: 'tel:' + r.driver_phone }, r.driver_phone) : '') : null,
  actions.length ? h('div', { class: 'row' }, actions) : null);

const mapsLink = (p) => p.maps_url || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([p.name, p.address, p.city].filter(Boolean).join(', '));
const placeCard = (p, admin, dist) => h('div', { class: 'card place' },
  h('div', { class: 'row between' }, h('b', {}, (p.kind === 'visit' ? '🏛️ ' : '🍽️ ') + p.name), dist != null ? h('span', { class: 'pill near' }, `${p.approx ? '~' : ''}${dist < 10 ? dist.toFixed(1) : Math.round(dist)} km`) : null),
  h('div', { class: 'row tags' }, p.city ? h('span', { class: 'pill' }, p.city) : null, p.category ? h('span', { class: 'pill' }, p.category) : null),
  p.address ? h('div', { class: 'muted' }, p.address) : null, p.note ? h('div', {}, p.note) : null,
  h('div', { class: 'row' },
    h('a', { class: 'btn small ghost', href: mapsLink(p), target: '_blank', rel: 'noopener noreferrer' }, '📍 Open in Maps'),
    admin ? h('button', { class: 'danger small', onclick: async () => { await api('DELETE', '/places/' + p.id); state.refresh(); } }, 'Remove') : null));

const haversine = (a, b, c, d) => {
  const r = (x) => x * Math.PI / 180, dl = r(c - a), dg = r(d - b);
  const q = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dg / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(q));
};
const daysTo = (iso) => Math.ceil((Date.parse(iso) - Date.now()) / 86400000);

/* ---------------- guest ---------------- */
const guestViews = {
  async home() {
    const [events, notifs, me] = await Promise.all([api('GET', '/events'), api('GET', '/notifications'), api('GET', '/me')]);
    state.me = me;
    const st = state.settings, meals = notifs.filter((n) => n.kind === 'meal').slice(0, 2);
    const d = daysTo(st.event_start);
    const go = (tab) => () => { state.tab = tab; render(); };
    const tile = (ico, label, fn) => h('button', { class: 'tile', onclick: fn }, h('span', {}, ico), label);
    const count = h('input', { type: 'number', min: 1, max: 20, value: me.rsvp_count || 1, 'aria-label': 'How many people are coming' });
    const sendRsvp = (attending) => async () => { await api('POST', '/rsvp', { attending, count: Number(count.value) }); toast(attending ? 'Thank you! See you there 🎉' : 'Thank you for letting us know'); state.refresh(); };
    return [
      h('div', { class: 'hero banner' }, h('div', { class: 'te' }, 'శుభ వివాహం'), h('h1', { class: 'script' }, st.couple),
        h('p', {}, `${st.date} · ${st.time_text}`), h('p', { class: 'muted' }, st.venue),
        Number.isFinite(d) && d > 0 ? h('div', { class: 'daysleft' }, h('b', {}, d), d === 1 ? ' day to go' : ' days to go') : null),
      h('div', { class: 'tiles' }, tile('🚖', 'Book a cab', go('cabs')), tile('🍽️', 'Eat & explore', go('eat')), tile('🔔', 'Alerts', go('alerts')),
        h('a', { class: 'tile', href: st.maps_url, target: '_blank', rel: 'noopener noreferrer' }, h('span', {}, '📍'), 'Directions')),
      meals.map((n) => h('div', { class: 'card meal' }, h('b', {}, '🍛 ' + n.title), n.body ? h('div', {}, n.body) : null, h('div', { class: 'muted' }, when(n.created_at)))),
      h('div', { class: 'card' }, h('h3', {}, 'Will you join us?'),
        me.rsvp ? h('p', {}, me.rsvp === 'yes' ? `✅ You are coming (${me.rsvp_count} ${me.rsvp_count > 1 ? 'people' : 'person'}). You can change this any time.` : '💌 You told us you cannot make it. You can change this any time.') : h('p', { class: 'muted' }, 'Please let the family know so we can plan for you.'),
        h('label', {}, 'Number of people'), count,
        h('div', { class: 'row rsvp' }, h('button', { onclick: sendRsvp(true) }, "Yes, we'll be there"), h('button', { class: 'ghost', onclick: sendRsvp(false) }, "Can't make it"))),
      h('div', { class: 'card' }, h('h3', {}, 'Venue'), h('b', {}, st.venue), h('div', { class: 'muted' }, st.venue_address),
        h('div', { class: 'row' }, h('a', { class: 'btn small', href: st.maps_url, target: '_blank', rel: 'noopener noreferrer' }, '📍 Directions'),
          h('a', { class: 'btn small ghost', href: '/invite.ics' }, '📅 Add to calendar'), h('a', { class: 'btn small ghost', href: '/' }, '💌 Invitation'))),
      h('h2', {}, 'Schedule'),
      list(events, 'The schedule will appear here soon.', (e) => h('div', { class: 'card' }, h('b', {}, e.title), h('div', {}, when(e.starts_at), e.venue ? ' · ' + e.venue : ''),
        e.details ? h('div', { class: 'muted' }, e.details) : null)),
      h('p', { class: 'muted center' }, st.welcome)];
  },
  async cabs() {
    const rides = await api('GET', '/rides');
    const soon = toLocalInput(Date.now() + 3600000);
    const f = form([
      field('Pickup point', 'pickup', { attrs: { required: true, placeholder: 'Hotel, station, airport…' } }),
      field('Drop-off', 'dropoff', { attrs: { required: true, placeholder: 'Venue, hotel…' } }),
      h('div', { class: 'grid2' },
        field('Pickup time', 'when', { type: 'datetime-local', attrs: { required: true, value: soon } }),
        field('Passengers', 'passengers', { type: 'number', attrs: { min: 1, max: 20, value: 1 } })),
      field('Note for driver (optional)', 'notes', { attrs: { placeholder: 'Luggage, flight number…' } })],
    'Book my cab', async (fd) => {
      const ride = await api('POST', '/rides', { pickup: fd.get('pickup'), dropoff: fd.get('dropoff'), pickup_at: new Date(fd.get('when')).getTime(), passengers: fd.get('passengers'), notes: fd.get('notes') });
      if (ride.status !== 'assigned') toast('Request received', 'All drivers are busy at that time. We will assign one as soon as possible.');
      state.refresh();
    }, { reset: false });
    return [h('h2', {}, 'Book a cab'), h('div', { class: 'card' }, f), h('h3', {}, 'My rides'),
      list(rides, 'No rides yet.', (r) => rideCard(r, ['requested', 'assigned'].includes(r.status)
        ? [h('button', { class: 'danger small', onclick: async () => { if (confirm('Cancel this ride?')) { await api('POST', `/rides/${r.id}/cancel`); state.refresh(); } } }, 'Cancel')] : []))];
  },
  async eat() {
    const places = await api('GET', '/places');
    const f = { city: 'all', kind: 'eat' };
    const box = h('div'), ctl = h('div'), status = h('p', { class: 'muted' });
    const chips = (key, opts) => h('div', { class: 'seg', role: 'group' }, opts.map(([v, t]) =>
      h('button', { type: 'button', 'aria-pressed': f[key] === v, onclick: () => { f[key] = v; paint(); } }, t)));
    const nearUrl = () => geo ? `https://www.google.com/maps/search/restaurants/@${geo.lat},${geo.lng},15z` : 'https://www.google.com/maps/search/restaurants+near+me';
    function paint() {
      ctl.replaceChildren(chips('kind', [['eat', '🍽️ Eat'], ['visit', '🏛️ See & do'], ['all', 'All']]),
        chips('city', [['all', 'Everywhere'], ['Vizianagaram', 'Vizianagaram'], ['Visakhapatnam', 'Vizag']]));
      let rows = places.filter((p) => (f.kind === 'all' || p.kind === f.kind) && (f.city === 'all' || p.city === f.city));
      if (geo) rows = rows.map((p) => ({ p, d: p.lat != null ? haversine(geo.lat, geo.lng, p.lat, p.lng) : null })).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
      else rows = rows.map((p) => ({ p, d: null }));
      box.replaceChildren(...[list(rows, 'Nothing here yet. The family will add more soon.', ({ p, d }) => placeCard(p, false, d))].flat());
      status.textContent = geo ? 'Sorted by distance from you. Distances are straight-line and approximate.' : 'Tap "Near me" to sort by distance from where you are.';
    }
    const near = h('button', { onclick: (e) => {
      if (!navigator.geolocation) return toast('Location not available', 'Your browser does not support it.');
      e.target.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => { geo = { lat: pos.coords.latitude, lng: pos.coords.longitude }; e.target.disabled = false; e.target.textContent = '📍 Near me ✓'; paint(); mapsBtn.href = nearUrl(); },
        () => { e.target.disabled = false; toast('Could not get your location', 'Allow location access in your browser and try again.'); },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    } }, geo ? '📍 Near me ✓' : '📍 Near me');
    const mapsBtn = h('a', { class: 'btn ghost', href: nearUrl(), target: '_blank', rel: 'noopener noreferrer' }, '🔎 Restaurants near me (Google Maps)');
    paint();
    return [h('h2', {}, 'Eat & explore'), h('div', { class: 'row' }, near, mapsBtn), status, ctl, box,
      h('p', { class: 'muted center' }, 'Vizag is about 50 km from Vizianagaram. Locations are approximate; tap Open in Maps for exact directions.')];
  },
  alerts: alertsView,
};

/* ---------------- driver ---------------- */
const driverViews = {
  async trips() {
    const rides = await api('GET', '/rides');
    const live = rides.filter((r) => ['assigned', 'enroute'].includes(r.status)).sort((a, b) => a.pickup_at - b.pickup_at);
    const past = rides.filter((r) => !live.includes(r));
    const set = (r, status) => async () => { await api('POST', `/rides/${r.id}/status`, { status }); state.refresh(); };
    const duty = h('label', { class: 'card row between' }, h('b', {}, 'On duty (accepting trips)'),
      h('input', { type: 'checkbox', checked: !!state.me.available, onchange: async (e) => {
        await api('POST', '/drivers/me/available', { available: e.target.checked }); state.me.available = e.target.checked ? 1 : 0; toast(e.target.checked ? 'You are on duty' : 'You are off duty'); } }));
    duty.querySelector('input').setAttribute('aria-label', 'On duty');
    return [h('h2', {}, 'My trips'), duty,
      list(live, 'No trips assigned right now.', (r) => rideCard(r, [
        r.status === 'assigned' ? h('button', { class: 'small', onclick: set(r, 'enroute') }, 'Start trip') : null,
        h('button', { class: 'ghost small', onclick: set(r, 'completed') }, 'Mark completed')])),
      past.length ? h('h3', {}, 'History') : null, past.map((r) => rideCard(r))];
  },
  alerts: alertsView,
};

/* ---------------- admin ---------------- */
const adminViews = {
  async send() {
    const meal = (name) => h('button', { class: 'small', onclick: async (e) => {
      const where = document.getElementById('mealwhere').value.trim();
      if (!confirm(`Notify ALL guests: "${name} is ready"?`)) return;
      e.target.disabled = true;
      try { const r = await api('POST', '/announce', { kind: 'meal', title: `${name} is ready 🍛`, body: where ? `Please head to ${where}.` : '' }); toast('Sent', `${r.sent} guests notified`); }
      finally { e.target.disabled = false; }
    } }, name);
    return [h('h2', {}, 'Send a notification'),
      h('div', { class: 'card' }, h('h3', {}, 'Meal is ready'), h('p', { class: 'muted' }, 'One tap tells every guest that food is served.'),
        field('Where? (optional)', 'where', { attrs: { id: 'mealwhere', placeholder: 'Main dining hall' } }),
        h('div', { class: 'row' }, ['Breakfast', 'Lunch', 'Snacks', 'Dinner'].map(meal))),
      h('div', { class: 'card' }, h('h3', {}, 'Custom message'), form([
        field('Title', 'title', { attrs: { required: true, maxlength: 120 } }), field('Message', 'body', { type: 'textarea' })],
      'Send to all guests', async (fd) => { const r = await api('POST', '/announce', { title: fd.get('title'), body: fd.get('body') }); toast('Sent', `${r.sent} guests notified`); }))];
  },
  async rides() {
    const [rides, drivers] = await Promise.all([api('GET', '/rides'), api('GET', '/drivers')]);
    const waiting = rides.filter((r) => r.status === 'requested').length;
    return [h('h2', {}, 'Cab bookings'), waiting ? h('div', { class: 'card', role: 'alert' }, `⚠️ ${waiting} request${waiting > 1 ? 's' : ''} waiting for a driver`) : null,
      list(rides, 'No bookings yet.', (r) => {
        const sel = h('select', { 'aria-label': 'Choose driver' }, drivers.map((d) => h('option', { value: d.id, selected: d.id === r.driver_id }, `${d.name} (${d.seats} seats)${d.available ? '' : ' – off duty'}`)));
        const open = ['requested', 'assigned'].includes(r.status);
        return rideCard(r, open ? [drivers.length ? sel : null,
          drivers.length ? h('button', { class: 'small', onclick: async () => { await api('POST', `/rides/${r.id}/assign`, { driver_id: Number(sel.value) }); state.refresh(); } }, r.driver_id ? 'Reassign' : 'Assign') : null,
          h('button', { class: 'danger small', onclick: async () => { if (confirm('Cancel this ride?')) { await api('POST', `/rides/${r.id}/cancel`); state.refresh(); } } }, 'Cancel')] : []);
      })];
  },
  async guests() {
    const [guests, sum] = await Promise.all([api('GET', '/guests'), api('GET', '/rsvp/summary')]);
    const share = (g) => `Hi ${g.name}! You're invited to ${state.settings.couple}'s wedding. Open ${location.origin} and use invite code ${g.code} to see the schedule, book cabs and get meal alerts.`;
    return [h('h2', {}, `Guests (${guests.length})`),
    h('div', { class: 'card tiles stats' }, h('div', {}, h('b', {}, sum.people), 'people coming'), h('div', {}, h('b', {}, sum.declined), 'declined'), h('div', {}, h('b', {}, sum.pending), 'not replied')),
    h('div', { class: 'card' }, form([
      field('Add guests: one name per line', 'names', { type: 'textarea', attrs: { required: true, placeholder: 'Asha Rao\nBala Kumar' } })],
    'Create invite codes', async (fd) => {
      const names = String(fd.get('names')).split('\n').map((s) => s.trim()).filter(Boolean);
      await api('POST', '/guests', { names }); state.refresh();
    })),
    list(guests, 'No guests yet.', (g) => h('div', { class: 'card row between' },
      h('div', {}, h('b', {}, g.name), h('div', { class: 'code' }, g.code), h('span', { class: `pill ${g.rsvp === 'yes' ? 'assigned' : g.rsvp === 'no' ? 'cancelled' : 'requested'}` }, g.rsvp === 'yes' ? `Coming (${g.rsvp_count})` : g.rsvp === 'no' ? 'Declined' : 'No reply')),
      h('div', { class: 'row' },
        h('a', { class: 'btn small ghost', href: 'https://wa.me/?text=' + encodeURIComponent(share(g)), target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'),
        h('button', { class: 'danger small', onclick: async () => { if (confirm(`Remove ${g.name}?`)) { await api('DELETE', '/people/' + g.id); state.refresh(); } } }, 'Remove'))))];
  },
  async places() {
    const places = await api('GET', '/places');
    return [h('h2', {}, 'Places to eat'), h('div', { class: 'card' }, form([
      field('Name', 'name', { attrs: { required: true } }),
      h('div', { class: 'grid2' }, field('Type', 'category', { attrs: { placeholder: 'Veg, Biryani, Café…' } }), field('Address', 'address')),
      h('div', { class: 'grid2' },
        field('Type', 'kind', { options: [['eat', '🍽️ Place to eat'], ['visit', '🏛️ Place to visit']] }),
        field('City', 'city', { options: [['Vizianagaram', 'Vizianagaram'], ['Visakhapatnam', 'Visakhapatnam'], ['', 'Other']] })),
      field('Google Maps link (optional)', 'maps_url', { attrs: { placeholder: 'https://maps.app.goo.gl/…' } }),
      h('div', { class: 'grid2' }, field('Latitude (for "near me")', 'lat', { attrs: { inputmode: 'decimal' } }), field('Longitude', 'lng', { attrs: { inputmode: 'decimal' } })),
      h('button', { type: 'button', class: 'ghost small', onclick: (e) => navigator.geolocation?.getCurrentPosition((pos) => {
        const f = e.target.closest('form'); f.lat.value = pos.coords.latitude.toFixed(5); f.lng.value = pos.coords.longitude.toFixed(5); }, () => toast('Could not get location')) }, '📍 Use my current location'),
      field('Note', 'note', { attrs: { placeholder: 'Try the dosa!' } }),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', name: 'notify', checked: true }), 'Notify all guests')],
    'Add place', async (fd) => {
      await api('POST', '/places', { ...Object.fromEntries(fd), notify: fd.get('notify') === 'on' });
      state.refresh();
    })), places.map((p) => placeCard(p, true))];
  },
  async drivers() {
    const drivers = await api('GET', '/drivers');
    return [h('h2', {}, 'Drivers'), h('div', { class: 'card' }, form([
      h('div', { class: 'grid2' }, field('Name', 'name', { attrs: { required: true } }), field('Phone', 'phone', { type: 'tel' })),
      h('div', { class: 'grid2' }, field('Vehicle', 'vehicle', { attrs: { placeholder: 'White Innova KA01…' } }), field('Seats', 'seats', { type: 'number', attrs: { min: 1, max: 20, value: 4 } })),
      h('div', { class: 'grid2' }, field('Login username', 'login', { attrs: { autocapitalize: 'none', required: true } }), field('Password (6+)', 'password', { attrs: { required: true, autocomplete: 'off' } }))],
    'Add driver', async (fd) => {
      await api('POST', '/drivers', Object.fromEntries(fd)); state.refresh();
    })),
    list(drivers, 'No drivers yet. Add your drivers so guests can book.', (d) => h('div', { class: 'card row between' },
      h('div', {}, h('b', {}, d.name), h('div', { class: 'muted' }, `${d.vehicle || 'Vehicle n/a'} · ${d.seats} seats · @${d.login}`), h('span', { class: `pill ${d.available ? 'assigned' : 'cancelled'}` }, d.available ? 'On duty' : 'Off duty')),
      h('button', { class: 'danger small', onclick: async () => { if (confirm(`Remove ${d.name}? Their trips become unassigned.`)) { await api('DELETE', '/people/' + d.id); state.refresh(); } } }, 'Remove')))];
  },
  async setup() {
    const [events, s] = await Promise.all([api('GET', '/events'), api('GET', '/settings')]);
    const text = [['couple', 'Couple (short, e.g. Bhuvaneswari & Akhil)'], ['bride', 'Bride name'], ['bride_info', 'Bride details'], ['groom', 'Groom name'], ['groom_info', 'Groom details'],
      ['groom_parents', 'Parents line'], ['date', 'Date as printed'], ['time_text', 'Time as printed'], ['venue', 'Venue'], ['venue_address', 'Venue address'], ['maps_url', 'Venue Google Maps link']];
    return [h('h2', {}, 'Wedding details'), h('p', { class: 'muted' }, 'These appear on the public invitation and in the guest app.'), h('div', { class: 'card' }, form([
      text.map(([k, label]) => field(label, k, { attrs: { value: s[k] || '' } })),
      field('Muhurtham starts (used for countdown and calendar)', 'event_start', { type: 'datetime-local', attrs: { value: s.event_start ? toLocalInput(Date.parse(s.event_start)) : '' } }),
      field('Muhurtham ends', 'event_end', { type: 'datetime-local', attrs: { value: s.event_end ? toLocalInput(Date.parse(s.event_end)) : '' } }),
      field('Welcome message', 'welcome', { type: 'textarea', attrs: { value: s.welcome || '' } })],
    'Save', async (fd) => {
      const body = Object.fromEntries(fd);
      for (const k of ['event_start', 'event_end']) if (body[k]) body[k] = new Date(body[k]).toISOString();
      await api('PUT', '/settings', body); state.settings = await api('GET', '/settings'); toast('Saved');
    }, { reset: false })),
    h('h2', {}, 'Schedule'), h('div', { class: 'card' }, form([
      field('Event', 'title', { attrs: { required: true, placeholder: 'Haldi, Sangeet, Muhurtham…' } }),
      h('div', { class: 'grid2' }, field('When', 'when', { type: 'datetime-local', attrs: { required: true } }), field('Venue', 'venue')),
      field('Details', 'details')],
    'Add event', async (fd) => {
      await api('POST', '/events', { title: fd.get('title'), starts_at: new Date(fd.get('when')).getTime(), venue: fd.get('venue'), details: fd.get('details') }); state.refresh();
    })),
    events.map((e) => h('div', { class: 'card row between' }, h('div', {}, h('b', {}, e.title), h('div', { class: 'muted' }, when(e.starts_at) + (e.venue ? ' · ' + e.venue : ''))),
      h('button', { class: 'danger small', onclick: async () => { await api('DELETE', '/events/' + e.id); state.refresh(); } }, 'Remove')))];
  },
};
adminViews.alerts = alertsView;

const VIEWS = { guest: guestViews, driver: driverViews, admin: adminViews };

/* ---------------- boot ---------------- */
(async () => {
  try { state.settings = await api('GET', '/settings'); } catch { state.settings = { couple: 'Our Wedding', date: '', venue: '' }; }
  document.title = state.settings.couple + ' · Wedding Hub';
  try { await start(); } catch { showLogin(); }
})();
