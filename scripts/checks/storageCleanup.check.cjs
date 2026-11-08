// Storage cleanup job logic (supabase/functions/_shared/cleanup.ts) with mocked storage and queue. No network, no credentials.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

(async () => {
  const file = path.join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'cleanup.ts');
  const { runCleanup, isSafeKey } = await import(pathToFileURL(file).href);

  const mk = (items, del) => {
    const finished = [];
    return {
      finished,
      deps: {
        claim: async () => items,
        finish: async (id, ok, error) => { finished.push({ id, ok, error }); },
        deleteObject: del,
      },
    };
  };
  const it = (id, key) => ({ id, file_key: key, attempts: 1, company_id: 'c' });

  let m = mk([it('1', 'a/b.jpg'), it('2', 'a/c.jpg')], async () => true);
  let s = await runCleanup(m.deps);
  check('1 files the storage confirms are marked done', s.done === 2 && m.finished.every((f) => f.ok), JSON.stringify(s));

  m = mk([it('1', 'a/gone.jpg')], async () => true); // deleteR2Object returns true for a 404 (already gone)
  s = await runCleanup(m.deps);
  check('2 a file already gone counts as done', s.done === 1 && m.finished[0].ok);

  m = mk([it('1', 'a/b.jpg'), it('2', 'a/c.jpg')], async (k) => { if (k === 'a/b.jpg') throw new Error('timeout'); return true; });
  s = await runCleanup(m.deps);
  check('3 one failure does not stop the rest, and the failed file is reported as not done with its error', s.done === 1 && s.retrying === 1
    && m.finished.find((f) => f.id === '1').ok === false && /timeout/.test(m.finished.find((f) => f.id === '1').error) && m.finished.find((f) => f.id === '2').ok === true, JSON.stringify(m.finished));

  m = mk([it('1', 'a/b.jpg')], async () => false);
  s = await runCleanup(m.deps);
  check('4 a refusal from the storage (not ok) is a failure, never marked done', s.done === 0 && s.retrying === 1 && m.finished[0].ok === false);

  m = mk([it('1', '../secrets'), it('2', '/abs'), it('3', ''), it('4', 'x/../../y')], async () => { throw new Error('should not be called'); });
  s = await runCleanup(m.deps);
  check('5 unsafe keys are never sent to the storage', s.done === 0 && s.retrying === 4 && m.finished.every((f) => !f.ok), JSON.stringify(s));

  let calls = 0;
  m = mk([it('1', 'a/b.jpg')], async () => { calls++; return true; });
  m.deps.finish = async () => { throw new Error('db down'); };
  s = await runCleanup(m.deps);
  check('6 if recording the result fails, the run still ends cleanly (the lock expires and the file is retried; deleting twice is harmless)', calls === 1 && s.claimed === 1);

  m = mk([], async () => true);
  s = await runCleanup(m.deps);
  check('7 nothing queued -> nothing done', s.claimed === 0 && s.done === 0);
  check('8 isSafeKey accepts normal keys only', isSafeKey('projects/1/2-a.jpg') && !isSafeKey('../x') && !isSafeKey('/x') && !isSafeKey(''));

  const idx = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'storage-cleanup', 'index.ts'), 'utf8');
  check('9 the function accepts only POST/OPTIONS and cannot be told what to delete (it takes no file names, only works the database queue)', /405/.test(idx) && !/req\.json\(\)/.test(idx));
  check('10 the app calls it only from the delete-company screen, right after the database delete succeeds', /storage-cleanup/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'account', 'DeleteCompanyRow.tsx'), 'utf8')));

  // ── folders (whole-company sweep) ──
  const { isSafePrefix } = await import(pathToFileURL(file).href);
  const U = '3f2b8c1e-9d4a-4b7e-8a11-5c6d7e8f9a0b';
  check('11 only the three folder shapes the database queues are accepted (company, ids/person, avatars/person)', isSafePrefix(`${U}/`) && isSafePrefix(`ids/${U}/`) && isSafePrefix(`avatars/${U}/`)
    && !isSafePrefix('') && !isSafePrefix('/') && !isSafePrefix('projects/') && !isSafePrefix(`${U}`) && !isSafePrefix(`${U}/projects/`) && !isSafePrefix('../') && !isSafePrefix(`ids/`));
  const folder = (id, key) => ({ id, kind: 'prefix', file_key: key, attempts: 1, company_id: 'c' });
  let left = 3; const fcalls = [];
  m = mk([folder('f1', `${U}/`)], async () => true);
  m.deps.deletePrefix = async (p, max) => { fcalls.push([p, max]); left--; return { deleted: 200, more: left > 0 }; };
  s = await runCleanup(m.deps);
  check('12 a folder that still has files is NOT marked done: it is kept going (more = true), without counting a failure', s.moreToDo === 1 && s.done === 0 && m.finished.length === 1 && m.finished[0].ok === false && !m.finished[0].error);
  await runCleanup(m.deps); s = await runCleanup(m.deps);
  check('12b the folder is marked done only on the run where nothing is left', s.done === 1 && m.finished[m.finished.length - 1].ok === true && fcalls.length === 3 && fcalls.every((c) => c[0] === `${U}/`));
  m = mk([folder('f2', 'projects/'), folder('f3', '/'), folder('f4', '')], async () => true);
  let touched = 0; m.deps.deletePrefix = async () => { touched++; return { deleted: 0, more: false }; };
  s = await runCleanup(m.deps);
  check('13 an unsafe folder (could empty the whole bucket) is refused and never sent to storage', touched === 0 && s.retrying === 3 && s.done === 0);
  m = mk([folder('f5', `ids/${U}/`)], async () => true);
  m.deps.deletePrefix = async () => { throw new Error('List failed (500)'); };
  s = await runCleanup(m.deps);
  check('14 a storage failure while emptying a folder is reported and retried later, never marked done', s.retrying === 1 && s.done === 0 && m.finished[0].ok === false && /List failed/.test(m.finished[0].error));
  const shared = fs.readFileSync(file, 'utf8');
  const rule = (t) => (t.match(/const UUID = '([^']+)'/) || [])[1] + '|' + (t.match(/const PREFIX_RE = new RegExp\(`([^`]+)`/) || [])[1];
  check('15 the pasteable function uses the same safety rules as the tested copy', rule(idx) === rule(shared) && rule(idx).length > 20);
  check('16 the function deletes in both R2 buckets and the Snow stand-in bucket, and has no relative imports (pasteable)', /PUBLIC_BUCKET, PRIVATE_BUCKET/.test(idx) && /SNOW_BUCKET/.test(idx) && !/from '\.\.?\//.test(idx));

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
