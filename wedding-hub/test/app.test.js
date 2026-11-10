import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seedAdmin, seedContent } from '../server/db.js';
import { createApp } from '../server/app.js';

let server, base;
before(async () => {
  process.env.ADMIN_PASS = 'adminpass1';
  const db = openDb(':memory:');
  seedAdmin(db);
  seedContent(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body && JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return call;
}
const when = (mins) => Date.now() + mins * 60000;

test('cab flow: auto-assign, no double booking, waiting list, notifications', async () => {
  const admin = await client();
  assert.equal((await admin('POST', '/api/login', { login: 'admin', password: 'nope' })).status, 401);
  assert.equal((await admin('POST', '/api/login', { login: 'admin', password: 'adminpass1' })).status, 200);

  assert.equal((await admin('POST', '/api/drivers', { name: 'Ravi', login: 'ravi', password: 'secret12', seats: 4, vehicle: 'Dzire' })).status, 200);
  assert.equal((await admin('POST', '/api/drivers', { name: 'Big', login: 'big', password: 'secret12', seats: 7, vehicle: 'Innova' })).status, 200);
  const { body: { guests } } = await admin('POST', '/api/guests', { names: ['Asha', 'Bala', 'Chitra', 'Dev'] });
  const [asha, bala, chitra, dev] = await Promise.all(guests.map(async (g) => {
    const c = await client(); assert.equal((await c('POST', '/api/login', { code: g.code.toLowerCase() })).status, 200); return c;
  }));

  const trip = (n, mins) => ({ pickup: 'Hotel', dropoff: 'Venue', pickup_at: when(mins), passengers: n });
  const r1 = (await asha('POST', '/api/rides', trip(2, 60))).body;
  assert.equal(r1.status, 'assigned');
  const r2 = (await bala('POST', '/api/rides', trip(2, 70))).body;          // overlaps -> other driver
  assert.equal(r2.status, 'assigned'); assert.notEqual(r2.driver_id, r1.driver_id);
  const r3 = (await chitra('POST', '/api/rides', trip(2, 80))).body;         // everyone busy
  assert.equal(r3.status, 'requested');
  const r4 = (await dev('POST', '/api/rides', trip(6, 600))).body;           // only the 7-seater fits
  assert.equal(r4.driver_name, 'Big');

  // cancel frees a driver, waiting request gets picked up automatically
  assert.equal((await asha('POST', `/api/rides/${r1.id}/cancel`)).status, 200);
  const mine = (await chitra('GET', '/api/rides')).body;
  assert.equal(mine[0].status, 'assigned');
  assert.equal(mine[0].driver_id, r1.driver_id);

  const n = (await chitra('GET', '/api/notifications')).body;
  assert.ok(n.some((x) => x.title === 'Your cab is booked'));

  // guest cannot touch others' rides; guests can't use admin APIs
  assert.equal((await bala('POST', `/api/rides/${r1.id}/cancel`)).status, 404);
  assert.equal((await bala('POST', '/api/announce', { title: 'x' })).status, 403);
  assert.equal((await bala('GET', '/api/guests')).status, 403);
});

test('driver status updates and availability', async () => {
  const admin = await client(); await admin('POST', '/api/login', { login: 'admin', password: 'adminpass1' });
  await admin('POST', '/api/drivers', { name: 'Solo', login: 'solo', password: 'secret12', seats: 20 });
  const { body: { guests } } = await admin('POST', '/api/guests', { names: ['Eve'] });
  const eve = await client(); await eve('POST', '/api/login', { code: guests[0].code });
  const solo = await client(); await solo('POST', '/api/login', { login: 'solo', password: 'secret12' });
  const ride = (await eve('POST', '/api/rides', { pickup: 'A', dropoff: 'B', pickup_at: when(5000), passengers: 15 })).body;
  assert.equal(ride.driver_name, 'Solo');
  assert.equal((await solo('POST', `/api/rides/${ride.id}/status`, { status: 'completed' })).status, 200);
  assert.equal((await solo('POST', `/api/rides/${ride.id}/status`, { status: 'enroute' })).status, 409);
  assert.equal((await eve('POST', `/api/rides/${ride.id}/status`, { status: 'enroute' })).status, 403);
});

test('meal announcement reaches every guest; places notify', async () => {
  const admin = await client(); await admin('POST', '/api/login', { login: 'admin', password: 'adminpass1' });
  const { body: { guests } } = await admin('POST', '/api/guests', { names: ['Fay'] });
  const fay = await client(); await fay('POST', '/api/login', { code: guests[0].code });
  assert.equal((await admin('POST', '/api/announce', { kind: 'meal', title: 'Lunch is ready', body: 'Main hall' })).status, 200);
  await admin('POST', '/api/places', { name: 'Udupi Cafe', category: 'Veg', maps_url: 'javascript:alert(1)', notify: true });
  const n = (await fay('GET', '/api/notifications')).body;
  assert.ok(n.find((x) => x.kind === 'meal' && x.title === 'Lunch is ready'));
  assert.ok(n.find((x) => x.kind === 'place'));
  const p = (await fay('GET', '/api/places')).body.find((x) => x.name === 'Udupi Cafe');
  assert.equal(p.maps_url, '');   // unsafe URL scheme dropped
  assert.equal((await (await client())('GET', '/api/places')).status, 401);
});

test('invitation, calendar file, seeded places, RSVP, settings', async () => {
  const anon = await client();
  const home = await fetch(base + '/'); assert.match(await home.text(), /Wedding Invitation/);
  const app = await fetch(base + '/app'); assert.match(await app.text(), /Guest App/);
  const st = (await anon('GET', '/api/settings')).body;
  assert.equal(st.venue, 'Sri Sai Balaji Function Hall');
  const ics = await fetch(base + '/invite.ics');
  const txt = await ics.text();
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(txt, /DTSTART:20270212T184500Z/);   // 00:15 IST on 13 Feb = 18:45 UTC on 12 Feb
  assert.match(txt, /DTEND:20270212T200000Z/);

  const admin = await client(); await admin('POST', '/api/login', { login: 'admin', password: 'adminpass1' });
  const { body: { guests } } = await admin('POST', '/api/guests', { names: ['Gita'] });
  const gita = await client(); await gita('POST', '/api/login', { code: guests[0].code });

  const places = (await gita('GET', '/api/places')).body;
  assert.ok(places.some((p) => p.city === 'Vizianagaram' && p.kind === 'eat'));
  assert.ok(places.some((p) => p.city === 'Visakhapatnam' && p.kind === 'visit' && p.lat > 17 && p.lat < 18));

  assert.equal((await admin('POST', '/api/places', { name: 'Bad', lat: 999, lng: 0 })).status, 400);
  assert.equal((await admin('POST', '/api/places', { name: 'Cafe X', kind: 'visit', city: 'Vizianagaram', lat: '18.11', lng: '83.4' })).status, 200);

  assert.equal((await gita('POST', '/api/rsvp', { attending: true, count: 3 })).status, 200);
  assert.equal((await gita('GET', '/api/me')).body.rsvp_count, 3);
  assert.equal((await admin('GET', '/api/rsvp/summary')).body.people, 3);
  assert.equal((await admin('POST', '/api/rsvp', { attending: true })).status, 403);
  assert.ok((await admin('GET', '/api/notifications')).body.some((n) => n.kind === 'rsvp'));

  assert.equal((await admin('PUT', '/api/settings', { venue: 'New Hall', maps_url: 'javascript:x' })).status, 400);
  assert.equal((await admin('PUT', '/api/settings', { venue: 'New Hall', evil: 'x' })).status, 200);
  const st2 = (await anon('GET', '/api/settings')).body;
  assert.equal(st2.venue, 'New Hall'); assert.equal(st2.evil, undefined);
  assert.equal((await gita('PUT', '/api/settings', { venue: 'Hacked' })).status, 403);
});
