import { openDb, seedAdmin, seedContent } from './db.js';
import { createApp } from './app.js';

const db = openDb();
const admin = seedAdmin(db);
seedContent(db);
if (admin) {
  console.log('\n=== First run: admin account created ===');
  console.log(`  username: ${admin.login}\n  password: ${admin.pass}`);
  console.log('  (shown once. Set ADMIN_USER / ADMIN_PASS env vars to choose your own.)\n');
}
const port = Number(process.env.PORT) || 3000;
createApp(db).listen(port, () => console.log(`Wedding hub running on http://localhost:${port}`));
