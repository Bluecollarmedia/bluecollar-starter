// Run: node scripts/checks/contentReports.check.cjs <path to typescript package>
// Logic checks for "Report content": the helpers, and how the app talks to the database (FAKE supabase),
// including a database that does not have content reports yet (setup.sql not run).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};

const { withBrand } = require('./_brand.cjs');
const legal = compile(read('src/legal/legalContent.ts'), withBrand(() => ({}), ts));
const lib = compile(read('src/lib/contentReports.ts'), (n) => (n === '@/legal/legalContent' ? legal : {}));

let calls = [];
let handler = () => ({ data: null, error: null });
function builder(table) {
  const op = { table, steps: [] };
  const b = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => { calls.push(op); return Promise.resolve(handler(op)).then(res, rej); };
      return (...args) => { op.steps.push([String(prop), args]); return b; };
    },
  });
  return b;
}
const fakeSupabase = { from: (t) => builder(t) };
const data = compile(read('src/data/contentReports.ts'), (n) => {
  if (n === 'react') return { useCallback: (f) => f, useEffect: () => {}, useState: (v) => [v, () => {}] };
  if (n === '@/lib/supabase') return { supabase: fakeSupabase, isSupabaseConfigured: true };
  if (n === '@/lib/contentReports') return lib;
  return {};
});
const { submitReport, loadReports, handleReport } = data;
const stepArgs = (op, name) => (op.steps.find((s) => s[0] === name) || [])[1];

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

(async () => {
  // helpers
  check('1 four reasons, each with a label', lib.REPORT_REASONS.length === 4 && lib.REPORT_REASONS.every((r) => r.label && r.hint));
  check('2 a reason is required; "something else" needs details; too long is refused', lib.reportProblem(null, '') !== '' && lib.reportProblem('other', '  ') !== '' && lib.reportProblem('other', 'rude') === '' && lib.reportProblem('spam', '') === '' && lib.reportProblem('spam', 'x'.repeat(501)) !== '');
  const mail = lib.reportMailto({ type: 'message', reason: 'harassment', details: 'He swore', where: 'Smith patio' });
  check('3 the fallback email goes to support with the reason and details', mail.startsWith('mailto:support@yourcompany.com?subject=') && decodeURIComponent(mail).includes('Harassment or abuse') && decodeURIComponent(mail).includes('He swore') && decodeURIComponent(mail).includes('Smith patio'), mail);
  const sorted = lib.sortReports([{ status: 'handled', created_at: '2026-10-03' }, { status: 'open', created_at: '2026-10-01' }, { status: 'open', created_at: '2026-10-02' }]);
  check('4 open reports first, newest first', sorted[0].created_at === '2026-10-02' && sorted[1].created_at === '2026-10-01' && sorted[2].status === 'handled');

  // submit
  calls = []; handler = () => ({ error: null });
  let r = await submitReport({ projectId: 'p1', type: 'message', contentId: 'm1', reason: 'spam', details: ' junk ' }, 'me');
  const row = stepArgs(calls[0], 'insert')[0];
  check('5 a report saves the project, reporter, item, reason and trimmed details', r.ok && calls[0].table === 'content_reports' && row.project_id === 'p1' && row.reported_by === 'me' && row.content_type === 'message' && row.content_id === 'm1' && row.reason === 'spam' && row.details === 'junk', JSON.stringify(row));
  calls = [];
  r = await submitReport({ projectId: 'p1', type: 'message', contentId: 'm1', reason: null }, 'me');
  check('6 no reason: refused before anything is sent', !r.ok && calls.length === 0 && /reason/i.test(r.error));
  handler = () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
  r = await submitReport({ projectId: 'p1', type: 'photo', contentId: 'x', reason: 'spam' }, 'me');
  check('7 reporting the same item again counts as sent (no scary error)', r.ok);
  handler = () => ({ error: { message: 'relation "public.content_reports" does not exist' } });
  r = await submitReport({ projectId: 'p1', type: 'message', contentId: 'm2', reason: 'harassment', details: 'abuse', where: 'Smith patio' }, 'me');
  check('8 without content reports in the database: a clear message and a ready email to support instead', !r.ok && r.needsUpdate && /email/i.test(r.error) && r.mailto.startsWith('mailto:'), JSON.stringify(r));
  handler = () => ({ error: { message: 'new row violates row-level security policy' } });
  r = await submitReport({ projectId: 'p1', type: 'message', contentId: 'm3', reason: 'spam' }, 'me');
  check('9 any other error is shown as it is, with the email fallback', !r.ok && /row-level security/.test(r.error) && !!r.mailto);

  // load
  calls = [];
  handler = (op) => {
    if (op.table === 'content_reports') return { data: [
      { id: 'r1', project_id: 'p1', reported_by: 'a', content_type: 'message', content_id: 'm1', reason: 'spam', details: null, status: 'handled', handled_note: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 'r2', project_id: 'p1', reported_by: 'a', content_type: 'photo', content_id: 'ph1', reason: 'inappropriate', details: 'bad', status: 'open', handled_note: null, created_at: '2026-10-02T00:00:00Z' },
      { id: 'r3', project_id: 'p1', reported_by: 'b', content_type: 'message', content_id: 'gone', reason: 'harassment', details: null, status: 'open', handled_note: null, created_at: '2026-10-03T00:00:00Z' },
    ], error: null };
    if (op.table === 'project_messages') return { data: [{ id: 'm1', body: 'hello' }], error: null };
    if (op.table === 'project_photos') return { data: [{ id: 'ph1', file_url: 'https://x/p.jpg', caption: 'cap' }], error: null };
    return { data: [], error: null };
  };
  r = await loadReports();
  check('10 reports load with the message text and the photo, open first', r.ok && r.data.map((x) => x.id).join() === 'r3,r2,r1' && r.data[2].body === 'hello' && r.data[1].photoUrl === 'https://x/p.jpg', JSON.stringify(r.data && r.data.map((x) => x.id)));
  check('11 a message that was already deleted is marked gone', r.ok && r.data[0].gone === true && r.data[1].gone === false);
  handler = () => ({ data: null, error: { message: 'relation "public.content_reports" does not exist' } });
  r = await loadReports();
  check('12 without content reports in the database the owner list is simply empty (no error)', r.ok && r.data.length === 0);

  // handle
  const item = { id: 'r1', content_type: 'message', content_id: 'm1', gone: false };
  calls = []; handler = () => ({ error: null });
  r = await handleReport(item, { removeContent: true });
  check('13 "Delete message and mark handled": deletes the message, then marks the report', r.ok && calls[0].table === 'project_messages' && calls[0].steps.some((s) => s[0] === 'delete') && calls[1].table === 'content_reports' && stepArgs(calls[1], 'update')[0].status === 'handled' && stepArgs(calls[1], 'update')[0].handled_note === 'Content removed', JSON.stringify(calls.map((c) => c.table)));
  calls = [];
  r = await handleReport({ id: 'r2', content_type: 'photo', content_id: 'ph1', gone: false }, { removeContent: true });
  const upd = stepArgs(calls[0], 'update')[0];
  check('14 for a photo: stops sharing it with the customer, then marks the report', r.ok && calls[0].table === 'project_photos' && upd.is_customer_visible === false && calls[1].table === 'content_reports');
  calls = [];
  r = await handleReport(item, { removeContent: false, note: ' looked fine ' });
  check('15 "Mark handled" alone touches only the report, with the note', r.ok && calls.length === 1 && stepArgs(calls[0], 'update')[0].handled_note === 'looked fine');
  calls = []; handler = (op) => (op.table === 'project_messages' ? { error: { message: 'permission denied' } } : { error: null });
  r = await handleReport(item, { removeContent: true });
  check('16 if the message cannot be deleted, the report stays open and the reason is shown', !r.ok && /permission denied/.test(r.error) && calls.length === 1);
  calls = []; handler = () => ({ error: null });
  r = await handleReport({ ...item, gone: true }, { removeContent: true });
  check('17 content already gone: just marks the report handled', r.ok && calls.length === 1 && calls[0].table === 'content_reports');

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
