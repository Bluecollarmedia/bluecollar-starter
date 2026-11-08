// Run: node scripts/checks/adminJobCard.check.cjs
// An ADMIN who is put on a job works it like a worker: the dashboard card (job, Confirm, Clock In / Clock Out), and the full worker view
// (Today, Jobs, finishing the work) with a way back. The owner never gets any of it (the owner is not put on jobs).
// An admin's login role is 'owner' (it only decides which area they land in); their real role is db.role.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const card = read('src/components/admin/AdminJobCard.tsx');
const home = read('app/(owner)/(tabs)/index.tsx');
const root = read('app/_layout.tsx');
const wl = read('app/(worker)/_layout.tsx');
const landing = read('src/hooks/useWorkerLanding.ts');
const pill = read('src/components/admin/AdminBackPill.tsx');

check('1 only a real admin sees the card: it uses the real role (db.role), not the login role that calls an admin "owner"', /db\.role === 'admin'/.test(card) && !/user\?\.role === 'admin'/.test(card));
check('2 only today\'s open jobs of the signed-in person count, and with none it shows nothing', /a\.personId === user\?\.id && a\.scheduledDate === today && !\['completed', 'cancelled', 'reassigned'\]\.includes\(a\.status\)/.test(card) && /if \(!mine\.length\) return null/.test(card));
check('3 the admin can confirm the job and has Clock In / Clock Out', /confirmationState: 'confirmed'/.test(card) && /<WorkdayCard compact \/>/.test(card));
check('4 a button opens the full worker view', /router\.push\('\/\(worker\)\/\(tabs\)' as any\)/.test(card) && /Open my worker view/.test(card));
check('5 the app\'s routing lets an admin with work coming up stay in the worker area (and nobody else but workers)', /const adminWorks = db\.role === 'admin' && hasOpenProjectWork\(db\.assignments, db\.personId, todayKey\(\)\)/.test(root) && /\(adminWorks && currentGroup === '\(worker\)'\)/.test(root));
check('6 the worker area counts an admin as the worker (their jobs, their routes)', /\(m\.role === 'worker' \|\| m\.role === 'admin'\)/.test(landing));
check('7 the worker view has a way back to the admin view, shown to admins only', /<AdminBackPill \/>/.test(wl) && /db\.role !== 'admin'\) return null/.test(pill) && /to = '\/\(owner\)'/.test(pill) && /router\.replace\(to as any\)/.test(pill));
check('8 the card sits on the dashboard above Needs Attention', /<AdminJobCard \/>[\s\S]*?\{\/\* Needs Attention \*\/\}/.test(home));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
