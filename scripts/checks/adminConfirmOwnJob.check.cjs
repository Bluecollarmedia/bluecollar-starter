// Run: node scripts/checks/adminConfirmOwnJob.check.cjs
// An owner/admin who is put on a job can confirm it (the "hasn't confirmed" item turns into "You haven't confirmed" with a Confirm button);
// they are never asked to remind themselves.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const hook = read('src/hooks/useOwnerDashboard.ts');
const home = read('app/(owner)/(tabs)/index.tsx');
check('1 the item says "You haven\'t confirmed" when the job is the signed-in person\'s own', /const mine = personId === db\.personId/.test(hook) && /mine \? "You haven't confirmed"/.test(hook));
check('2 its button is Confirm (not Remind) and carries the job', /actionLabel: mine \? 'Confirm' : 'Remind'/.test(hook) && /confirmOwn: \{ assignmentId: unconfirmed\.id \}/.test(hook));
check('3 tapping Confirm marks the job confirmed', /updateRow\('assignments', item\.confirmOwn\.assignmentId, \{ confirmationState: 'confirmed' \}\)/.test(home));
check('4 someone else\'s job still gets the Remind push', /remind: \{ assignmentId: unconfirmed\.id, firstName:/.test(hook) && /remindWorker\(item\.remind\.assignmentId/.test(home));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
