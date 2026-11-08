// Run: node scripts/checks/customerPortalAccess.check.cjs
// On a customer's page the owner decides whether the customer can use the app: a switch (not just a label), with a plain explanation of
// "Invite pending", a confirmation before turning access off, and the database function behind it (set_customer_portal_access in setup.sql).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
const sqlHelper = require('./_sql.cjs');   // supabase/setup.sql, the one file that builds the database
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

(async () => {
  // Compiled with the settings words (w from src/config/brand.ts), the way the app reads it.
  const ts = require(process.argv[2] || 'typescript');
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/customerAccess.ts'), { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m, m.exports, require('./_brand.cjs').withBrand(require, ts));
  Object.assign(m, m.exports);
  void pathToFileURL;
  const act = m.portalAccessView('active'), inv = m.portalAccessView('invited'), off = m.portalAccessView('inactive');
  check('1 active = On, with a plain note', act.on && act.label === 'On' && /sign in and see their jobs/.test(act.note));
  check('2 "Invite pending" is explained: added, no login yet, send the link; and the switch is on (they are allowed in)', inv.on && inv.label === 'Invite pending' && /haven't made their login yet/.test(inv.note) && /link/.test(inv.note));
  check('3 turned off: switch off, "can\'t sign in", records kept', !off.on && off.label === 'Off' && /can't sign in/.test(off.note) && /kept/.test(off.note));
  const t = m.turnOffText('Test');
  check('4 turning off asks first and says what happens (records kept, unused link stops, can turn back on)', /Turn off Test's access\?/.test(t.title) && /kept/.test(t.message) && /link/.test(t.message) && /turn it back on/.test(t.message));
  check('5 errors are plain sentences (not allowed, no connection, update not installed)', /Only the owner/.test(m.accessErrorText('Only the owner x')) && /connection/.test(m.accessErrorText('Network request failed')) && /supabase\/setup\.sql/.test(m.accessErrorText('Could not find the function in the schema cache')));

  const page = read('app/(owner)/customers/[id].tsx');
  check('6 the page has a real Switch for Portal access (not just a status label)', /<Switch value=\{portal\.on\}/.test(page) && /onValueChange=\{changeAccess\}/.test(page));
  check('7 turning ON applies at once; turning OFF asks first', /if \(next\) \{ await apply\(\); return; \}/.test(page) && /confirmAction\(t\.title, t\.message, 'Turn Off'/.test(page));
  check('8 it calls the database function and refreshes the customer', /rpc\('set_customer_portal_access', \{ p_person_id: p\.id, p_enabled: next \}/.test(page) && /refresh\('people', 'company_members'\)/.test(page));
  const sql = sqlHelper.fn('set_customer_portal_access');
  check('9 the database function: owner/admin only, customers only, off cancels an unused link and keeps records, on restores', /_invite_staff_company\(\)/.test(sql) && /role = 'customer'/.test(sql) && /status = 'revoked'/.test(sql) && /'invited'/.test(sql) && !/delete from/.test(sql));
  check('10 Message customers skips customers whose access is off', /x\.status = 'inactive'/.test(sqlHelper.fn('_customer_audience')));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
