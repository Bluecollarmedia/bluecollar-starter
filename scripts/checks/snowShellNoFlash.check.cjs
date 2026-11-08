// Run: node scripts/checks/snowShellNoFlash.check.cjs
// A worker opening the app while Snow Mode is on must never see the wrong screen first (the "Snow Mode is on" notice, or the
// landscaping shell) while their snow access is still being read. No screen is chosen until it is in.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const hook = read('src/hooks/useModeAccess.ts');
const layout = read('app/_layout.tsx');

check('1 the snow-access lookup says when it has an answer (and gives up waiting after a few seconds, so a slow network never traps a worker)',
  /ready: !!known/.test(hook) && /SNOW_ACCESS_WAIT_MS/.test(hook) && /setTimeout\(/.test(hook) && /clearTimeout\(giveUp\)/.test(hook));
check('2 the answer is remembered for the session, and forgotten when the person signs out or is not a worker', /snowAccessCache\.clear\(\)/.test(hook) && /new Map<string, Partial<ModeAccess>>/.test(hook));
check('3 a worker is "pending" while Snow Mode is on and the answer is still coming', /const pending = role === 'worker' && mode === 'snow' && !ready/.test(hook) && /shell: shellFor\(role, mode, access\), pending \}/.test(hook));
check('4 the root layout does not route anywhere while pending, and shows a plain blank screen (not the notice)', /if \(shellPending\) return;/.test(layout) && /shellPending && appState === 'active' && isAuthenticated\)/.test(layout) && /backgroundColor: colors\.background/.test(layout));
check('5 customers, owners and workers in Landscaping Mode are never held up (pending only for a worker in Snow Mode)', /role === 'worker' && mode === 'snow'/.test(hook));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
