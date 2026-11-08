// Run: node scripts/checks/snowDashboardLeadsPhotos.check.cjs <path to typescript package>
// The Snow dashboard names EVERY lead on a route (not just the first) and judges photos by each stop's own rule and number.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};
const dash = compile(read('src/data/snowDashboard.ts'), () => ({}));
const view = compile(read('src/lib/snowDashboardView.ts'), (n) => (n === '@/data/snowDashboard' ? dash : {}));
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const names = { p1: 'Ann', p2: 'Bo', p3: 'Cy', p4: 'Di', p5: 'Ed', p6: 'Flo', p7: 'Gus' };
const storm = { id: 's', name: 'S', service: 'plowing', status: 'dispatched', reopenedCount: 0, createdAt: '2026-10-27T00:00:00Z' };
const route = (id, lead, extra = {}) => ({ id, stormId: 's', service: 'plowing', name: id, position: 0, leadPersonId: lead, mediaRequired: false, minMedia: 0, ...extra });
const visit = (id, routeId, status, extra = {}) => ({ id, stormId: 's', routeId, propertyId: id, propertyName: `P ${id}`, position: 0, status, ...extra });
const build = (routes, visits, more = {}) => dash.buildSnowDashboard({ storms: [storm], routes, visits, mediaCountByVisit: {}, pendingSkips: [], mediaToReview: null, openShifts: null, nameOf: (id) => names[id], now: new Date('2026-10-27T14:00:00Z'), ...more });

const seven = build([route('r1', 'p1')], [visit('v1', 'r1', 'pending')], { extraLeadsByRoute: { r1: ['p2', 'p3', 'p4', 'p5', 'p6', 'p7'] } });
const r = seven.storms[0].routes[0];
check('1 a route with seven leads lists all seven names', r.leadNames.join() === 'Ann,Bo,Cy,Di,Ed,Flo,Gus' && r.leadName === 'Ann, Bo, Cy, Di, Ed, Flo, Gus', r.leadName);
check('2 the crew row says "Leads:" with every name', view.crewRows(seven.storms[0])[0].leadLabel === 'Leads: Ann, Bo, Cy, Di, Ed, Flo, Gus', view.crewRows(seven.storms[0])[0].leadLabel);
const one = build([route('r1', 'p1')], [visit('v1', 'r1', 'pending')]);
check('3 one lead still reads "Lead: Ann"', view.crewRows(one.storms[0])[0].leadLabel === 'Lead: Ann');
const noMain = build([route('r1', undefined)], [visit('v1', 'r1', 'pending')], { extraLeadsByRoute: { r1: ['p2'] } });
check('4 a route with only an extra lead is not flagged "no crew lead"', !noMain.needsAttention.some((i) => i.kind === 'route_without_lead') && noMain.storms[0].routes[0].leadName === 'Bo');
const nobody = build([route('r1', undefined)], [visit('v1', 'r1', 'pending')]);
check('5 a route with nobody on it is still flagged', nobody.needsAttention.some((i) => i.kind === 'route_without_lead'));

const media = build([route('r1', 'p1', { mediaRequired: true, minMedia: 2 })], [visit('v1', 'r1', 'arrived', { minMedia: 5 }), visit('v2', 'r1', 'arrived', { photosRequired: false }), visit('v3', 'r1', 'arrived')], { mediaCountByVisit: { v1: 3, v3: 2 } });
const miss = media.needsAttention.filter((i) => i.kind === 'missing_media');
check('6 a stop with its own number (5) is short at 3 photos, even though the route says 2', miss.some((i) => i.visitId === 'v1' && /3 of 5/.test(i.detail)), JSON.stringify(miss.map((i) => i.detail)));
check('7 a stop with photos turned off is never short', !miss.some((i) => i.visitId === 'v2'));
check('8 a stop with no rule of its own follows the route (2 of 2 is fine)', !miss.some((i) => i.visitId === 'v3'));
const own = build([route('r1', 'p1', { mediaRequired: false })], [visit('v1', 'r1', 'arrived', { photosRequired: true, minMedia: 1 })]);
check('9 a stop can require photos even when the route does not', own.needsAttention.some((i) => i.kind === 'missing_media' && /0 of 1/.test(i.detail)));

const hook = read('src/hooks/useSnowDashboard.ts');
check('10 the dashboard loads extra leads and each stop\'s own photo columns (falling back on an older database)', /snow_route_extra_leads/.test(hook) && /photos_required, min_media/.test(hook) && /photos_required\|min_media/.test(hook));
const sug = read('src/components/ui/StreetSuggestions.tsx');
check('11 address suggestions say what is happening: looking, nothing found, not turned on, or Google\'s reason', /Looking up addresses/.test(sug) && /No matching address found/.test(sug) && /not turned on in this version/.test(sug) && /not working right now/.test(sug));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
