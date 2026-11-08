// Run: node scripts/checks/customerOverview.check.cjs <path to typescript package>
// Customer project Overview: only meaningful updates, billing summary, section order, and nothing fabricated.
const ts = require(process.argv[2] || 'typescript'); const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} }; new Function('module', 'exports', ts.transpileModule(read('src/lib/customerOverview.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const f = m.exports; const screen = read('app/(customer)/project.tsx'); const billing = read('src/components/financials/CustomerBillingCard.tsx');
let bad = 0; const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); };
const ev = (id, eventType, title, ts2) => ({ id, eventType, title, timestamp: ts2 });
const events = [
  ev('1', 'project_started', 'Project started', '2026-10-01'), ev('2', 'update_shared', 'Lights installed', '2026-10-18T12:42'),
  ev('3', 'photo_shared', 'Exterior straw installation completed', '2026-10-17T10:15'), ev('4', 'progress_updated', 'Progress 80%', '2026-10-16'),
  ev('5', 'update_shared', 'Project updated', '2026-10-15'), ev('6', 'update_shared', 'Mulch done', '2026-10-14'), ev('7', 'update_shared', 'Edging done', '2026-10-13'),
  ev('8', 'request_responded', 'We replied', '2026-10-19'), ev('9', 'project_completed', 'Project completed', '2026-10-19'),
];
const r = f.meaningfulUpdates(events);
check('1 only the three newest meaningful updates, newest first', r.map((e) => e.id).join() === '2,3,6', r.map((e) => e.id).join());
check('2 no started / progress / reply / completed / generic entries', !r.some((e) => /started|Progress|replied|Project updated/i.test(e.title)));
check('3 no updates gives an empty list (screen shows an empty state, nothing invented)', f.meaningfulUpdates([]).length === 0 && /No updates yet/.test(screen));
check('4 billing status: needs review first, else issued, else none', f.billingStatus({ waiting: 2, issuedInvoices: 1 }).label === '2 need review' && f.billingStatus({ waiting: 1, issuedInvoices: 0 }).label === '1 needs review' && f.billingStatus({ waiting: 0, issuedInvoices: 1 }).label === '1 issued' && f.billingStatus({ waiting: 0, issuedInvoices: 0 }) === null);
check('5 document count wording', f.documentCountLabel(1) === '1 document' && f.documentCountLabel(4) === '4 documents');
const o = screen.slice(screen.indexOf('function renderOverview'), screen.indexOf('function renderTimeline'));
const pos = (s) => o.indexOf(s);
check('6 order: ring, Project Activity, Project Details, Billing last', pos('<ProgressRing') > 0 && pos('Project Activity') > pos('<ProgressRing') && pos('Project Details') > pos('Project Activity') && pos('<CustomerBillingCard') > pos('Project Details'));
check('7 View all opens the real timeline tab; no banner, stats, wrench or celebration', /setActiveSection\('timeline'\)/.test(o) && !/wrench|Thank you|completedBanner|statsRow/i.test(o));
check('8 billing reuses the existing visibility rule and document screen', /customerCanSee/.test(billing) && /\/\(customer\)\/document/.test(billing));
check('9 header and tabs untouched', /<SectionTabs tabs=\{activeSections\}/.test(screen) && /accessibilityLabel=\{t\('Go back'\)\}/.test(screen));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
