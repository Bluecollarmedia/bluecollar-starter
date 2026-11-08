// Run: node scripts/checks/snowShiftsCompat.check.cjs <path to typescript package>
// How the app reads shifts and their storm tag (src/data/snowShifts.ts) with a FAKE database:
// it must read tags after update 42 AND keep loading shifts before update 42 (no storm_id column).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/data/snowShifts.ts'), 'utf8');

let hasColumn, selects;
const rows = [
  { id: 's1', person_id: 'p1', storm_id: 'stormA', clock_in_at: '2026-02-09T10:00:00Z', clock_out_at: '2026-02-09T12:00:00Z', snow_shift_corrections: [] },
  { id: 's2', person_id: 'p2', storm_id: null, clock_in_at: '2026-02-09T11:00:00Z', clock_out_at: null, snow_shift_corrections: [{ clock_in_at: '2026-02-09T11:30:00Z', clock_out_at: '2026-02-09T13:00:00Z', reason: 'fixed', created_at: '2026-02-09T14:00:00Z' }] },
];
const fake = {
  from: () => {
    const state = {};
    const api = {
      select: (cols) => { state.cols = cols; return api; },
      gte: () => api, lt: () => api, order: () => api,
      then: (res) => {
        selects.push(state.cols);
        if (!hasColumn && /storm_id/.test(state.cols)) return res({ data: null, error: { message: 'column snow_shifts.storm_id does not exist' } });
        return res({ data: rows.map((r) => { const c = { ...r }; if (!hasColumn || !/storm_id/.test(state.cols)) delete c.storm_id; return c; }), error: null });
      },
    };
    return api;
  },
  rpc: async () => ({ data: null, error: null }),
};
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (name) => {
  if (name === '@/lib/supabase') return { supabase: fake, isSupabaseConfigured: true };
  if (name === '@/lib/ids') return { uuid: () => 'u' };
  return {};
});
const { loadShifts } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

(async () => {
  hasColumn = true; selects = [];
  let r = await loadShifts('2026-02-01T00:00:00Z');
  check('1 with update 42: one query, and each shift carries its storm tag (or none)', r.ok && selects.length === 1 && r.data[0].stormId === 'stormA' && r.data[1].stormId === undefined, JSON.stringify(r));
  check('2 corrected times still win (the tag does not change how times are read)', r.data[1].corrected && r.data[1].clockInAt === '2026-02-09T11:30:00Z' && r.data[1].originalIn === '2026-02-09T11:00:00Z');
  hasColumn = false; selects = [];
  r = await loadShifts('2026-02-01T00:00:00Z');
  check('3 before update 42: loads anyway (second query without the tag column), every shift untagged', r.ok && selects.length === 2 && !/storm_id/.test(selects[1]) && r.data.every((s) => s.stormId === undefined), JSON.stringify(r));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
