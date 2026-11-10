# Wedding Hub

One place for your wedding guests: log in with an invite code, see the schedule, get **live notifications** (meal ready, new eating spots, cab updates), browse **places to eat nearby**, and **book a cab** that is automatically assigned to an available driver.

## Pages
- `/` is the public **digital invitation** (no login): opening reveal, countdown, couple, venue, directions, add-to-calendar (`/invite.ics`), WhatsApp share.
- `/app` is the **guest app** (guests, drivers and admin log in here).

All invitation text (names, date, venue, map link, muhurtham time) is editable in **Admin → Setup**.

## Run it

```bash
npm install
ADMIN_PASS='choose-a-password' npm start     # http://localhost:3000
```
Needs Node 22.13+. No external database: data lives in `data/wedding.db` (SQLite). If `ADMIN_PASS` is not set, a random admin password is printed once on first run. `ADMIN_USER` (default `admin`), `PORT` and `DB_FILE` are also configurable. Set `NODE_ENV=production` behind HTTPS so cookies are `Secure`.

## Who can do what

| Role | Logs in with | Can |
|------|-------------|-----|
| **Guest** | 6-character invite code | See schedule, book/cancel cabs, see places, receive alerts |
| **Driver** | username + password (created by admin) | See assigned trips, start/complete them, toggle on/off duty |
| **Admin** (you) | username + password | Add guests (bulk, with WhatsApp share link), add drivers, post places, send meal/custom notifications, manage cabs, edit schedule & details |

## How cab booking works
1. Guest enters pickup, drop-off, time, passengers.
2. The server picks an **on-duty driver with enough seats and no other trip within ±90 minutes**, preferring the driver with the fewest trips, inside one DB transaction (no double booking).
3. Guest and driver are notified instantly. If everyone is busy the request waits, admin is alerted, and it is auto-assigned when a driver frees up (trip completed/cancelled, or goes on duty). Admin can also assign or reassign manually.

## Notifications
Delivered live over Server-Sent Events (in-app toast + alerts inbox + browser notification if allowed). They work while the app is open or in a background tab. True push to a closed phone app needs Web Push + a service worker (not included yet).

## Places & "near me"
First run seeds real, named places in **Vizianagaram** and **Visakhapatnam (Vizag)** (restaurants plus sights). Guests can filter by city/type and tap **Near me** to sort by distance (uses their phone location, never stored). Seeded coordinates are area-level approximations (marked `~`); "Open in Maps" searches by name for the exact spot. Admin can add/remove places and notify guests. Set `SEED_PLACES=0` to skip seeding.

## Tests
`npm test` covers login, cab assignment/overlap/capacity/waiting list, permissions and URL sanitising.
