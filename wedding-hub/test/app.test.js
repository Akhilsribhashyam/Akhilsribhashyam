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
  assert.match(txt, /SUMMARY:Reception[^\r]*\r\n/);
  assert.match(txt, /DTSTART:20270212T133000Z/);   // reception: 7:00 PM IST on Fri 12 Feb
  assert.match(txt, /DTSTART:20270212T202800Z/);   // muhurtham: 1:58 AM IST on Sat 13 Feb = 20:28 UTC on 12 Feb
  assert.equal(txt.match(/BEGIN:VEVENT/g).length, 2);
  assert.equal(st.muhurtham_text, 'Saturday, 13th February 2027 · 1:58 AM');

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

test('meal alert at a chosen place, and new place types', async () => {
  const admin = await client(); await admin('POST', '/api/login', { login: 'admin', password: 'adminpass1' });
  const { body: { guests } } = await admin('POST', '/api/guests', { names: ['Hari'] });
  const hari = await client(); await hari('POST', '/api/login', { code: guests[0].code });
  for (const [name, kind] of [['Vizag Airport', 'airport'], ['Our House', 'home'], ['Farm House', 'home'], ['Hotel Grand', 'stay'], ['Bogus', 'nonsense']])
    assert.equal((await admin('POST', '/api/places', { name, kind, city: 'Vizianagaram' })).status, 200);
  const places = (await hari('GET', '/api/places')).body;
  assert.equal(places.find((p) => p.name === 'Farm House').kind, 'home');
  assert.equal(places.find((p) => p.name === 'Vizag Airport').kind, 'airport');
  assert.equal(places.find((p) => p.name === 'Bogus').kind, 'eat');   // unknown kinds fall back safely

  const farm = places.find((p) => p.name === 'Farm House');
  assert.equal((await admin('POST', '/api/announce', { meal: 'Lunch', place_id: farm.id, note: 'Till 3 pm' })).status, 200);
  const n = (await hari('GET', '/api/notifications')).body.find((x) => x.title.startsWith('Lunch is ready at Farm House'));
  assert.equal(n.kind, 'meal'); assert.match(n.body, /Till 3 pm/); assert.match(n.url, /^https:\/\/www\.google\.com\/maps\/search/);
  assert.equal((await admin('POST', '/api/announce', { meal: 'Brunch', place_id: farm.id })).status, 400);
  assert.equal((await admin('POST', '/api/announce', { meal: 'Dinner', place_id: 99999 })).status, 400);
  assert.equal((await hari('POST', '/api/announce', { meal: 'Lunch', place_id: farm.id })).status, 403);
});

test('guest stay: hotel + room, new house, old house', async () => {
  const admin = await client(); await admin('POST', '/api/login', { login: 'admin', password: 'adminpass1' });
  const { body: { guests } } = await admin('POST', '/api/guests', { names: ['Ira', 'Jay'] });
  const [ira, jay] = await Promise.all(guests.map(async (g) => { const c = await client(); await c('POST', '/api/login', { code: g.code }); return c; }));
  await admin('POST', '/api/places', { name: 'Hotel Sai Grand', kind: 'stay', city: 'Vizianagaram', address: 'MG Road' });
  const hotel = (await admin('GET', '/api/places')).body.find((p) => p.name === 'Hotel Sai Grand');
  const [g1, g2] = (await admin('GET', '/api/guests')).body.filter((g) => ['Ira', 'Jay'].includes(g.name));

  assert.equal((await admin('PUT', `/api/guests/${g1.id}/stay`, { type: 'hotel', room: '204' })).status, 400);       // hotel needed
  assert.equal((await admin('PUT', `/api/guests/${g1.id}/stay`, { type: 'castle' })).status, 400);
  assert.equal((await admin('PUT', `/api/guests/${g1.id}/stay`, { type: 'hotel', place_id: hotel.id, room: '204' })).status, 200);
  const me = (await ira('GET', '/api/me')).body;
  assert.equal(me.stay_type, 'hotel'); assert.equal(me.stay_room, '204'); assert.equal(me.stay_place, 'Hotel Sai Grand'); assert.match(me.stay_url, /google\.com\/maps/);
  assert.ok((await ira('GET', '/api/notifications')).body.some((n) => n.title === 'Your stay is confirmed' && /Room 204/.test(n.body)));

  assert.equal((await admin('PUT', `/api/guests/${g2.id}/stay`, { type: 'old_house', room: '99' })).status, 200);
  const me2 = (await jay('GET', '/api/me')).body;
  assert.equal(me2.stay_type, 'old_house'); assert.ok(!me2.stay_room);        // no room numbers for houses
  assert.equal((await admin('PUT', `/api/guests/${g2.id}/stay`, { type: '' })).status, 200);
  assert.equal((await jay('GET', '/api/me')).body.stay_type, null);
  assert.equal((await ira('PUT', `/api/guests/${g2.id}/stay`, { type: 'new_house' })).status, 403);
});

test('guest self-registration, sign-in, passcode and closing', async () => {
  const admin = await client(); await admin('POST', '/api/login', { login: 'admin', password: 'adminpass1' });
  const anon = await client();
  assert.equal((await anon('GET', '/api/settings')).body.reg_open, '1');

  // validation
  assert.equal((await anon('POST', '/api/register', { name: 'A', phone: '9876500001', password: 'secret1' })).status, 400);
  assert.equal((await anon('POST', '/api/register', { name: 'Asha', phone: '12345', password: 'secret1' })).status, 400);
  assert.equal((await anon('POST', '/api/register', { name: 'Asha', phone: '9876500001', password: 'abc' })).status, 400);

  // register -> signed in immediately as a guest
  const asha = await client();
  assert.equal((await asha('POST', '/api/register', { name: 'Asha K', phone: '+91 98765 00001', password: 'secret1' })).status, 200);
  const me = (await asha('GET', '/api/me')).body;
  assert.equal(me.role, 'guest'); assert.equal(me.name, 'Asha K');
  assert.ok((await admin('GET', '/api/notifications')).body.some((n) => n.title === 'New guest registered: Asha K'));

  // same number (any formatting) can't register twice; sign in works with any formatting; wrong password fails
  assert.equal((await anon('POST', '/api/register', { name: 'Imposter', phone: '9876500001', password: 'secret2' })).status, 409);
  const again = await client();
  assert.equal((await again('POST', '/api/login', { login: '098765 00001', password: 'wrong' })).status, 401);
  assert.equal((await again('POST', '/api/login', { login: '9876500001', password: 'secret1' })).status, 200);
  assert.equal((await again('GET', '/api/me')).body.name, 'Asha K');
  // registered guests can book cabs, but cannot reach admin APIs or pretend to be staff
  assert.equal((await again('GET', '/api/guests')).status, 403);

  // passcode: required, never exposed publicly, exposed to admin only
  assert.equal((await admin('PUT', '/api/settings', { reg_passcode: 'Bhuvi27' })).status, 200);
  const pub = (await anon('GET', '/api/settings')).body;
  assert.equal(pub.reg_passcode, undefined); assert.equal(pub.reg_needs_passcode, '1');
  assert.equal((await admin('GET', '/api/settings')).body.reg_passcode, 'Bhuvi27');
  assert.equal((await anon('POST', '/api/register', { name: 'Bala', phone: '9876500002', password: 'secret1' })).status, 403);
  assert.equal((await anon('POST', '/api/register', { name: 'Bala', phone: '9876500002', password: 'secret1', passcode: 'nope' })).status, 403);
  assert.equal((await anon('POST', '/api/register', { name: 'Bala', phone: '9876500002', password: 'secret1', passcode: 'bhuvi27' })).status, 200);

  // closing registration
  await admin('PUT', '/api/settings', { reg_open: '0' });
  assert.equal((await (await client())('POST', '/api/register', { name: 'Late', phone: '9876500003', password: 'secret1', passcode: 'Bhuvi27' })).status, 403);

  // admin password reset signs the guest out and the new password works
  const list = (await admin('GET', '/api/guests')).body;
  const a = list.find((g) => g.name === 'Asha K');
  const r = (await admin('POST', `/api/guests/${a.id}/reset-password`)).body;
  assert.equal((await asha('GET', '/api/me')).status, 401);
  assert.equal((await (await client())('POST', '/api/login', { login: '9876500001', password: 'secret1' })).status, 401);
  assert.equal((await (await client())('POST', '/api/login', { login: '9876500001', password: r.password })).status, 200);
  assert.equal((await asha('POST', `/api/guests/${a.id}/reset-password`)).status, 401);
});

test('many successful logins from one IP are fine; repeated failures get locked out', async () => {
  const admin = await client(); await admin('POST', '/api/login', { login: 'admin', password: 'adminpass1' });
  const { body: { guests } } = await admin('POST', '/api/guests', { names: Array.from({ length: 40 }, (_, i) => `Bulk ${i}`) });
  for (const g of guests) assert.equal((await (await client())('POST', '/api/login', { code: g.code })).status, 200);
  const c = await client();
  let last; for (let i = 0; i < 31; i++) last = (await c('POST', '/api/login', { code: 'WRONG1' })).status;
  assert.equal(last, 429);
});
