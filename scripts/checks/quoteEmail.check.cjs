// Run: node scripts/checks/quoteEmail.check.cjs <path to typescript package>
// Emailing a quote to the customer, and the approval page: drawn signature, Request changes, PDF.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const load = (p) => { const m = { exports: {} }; new Function('module', 'exports', ts.transpileModule(read(p), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports); return m.exports; };
const email = load('src/lib/documentEmail.ts');
const sig = load('src/lib/signature.ts');
let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (d || ''))); };

const m = email.buildDocumentEmailMessage({ customerName: 'David Cohen', kind: 'quote', totalText: '$0.00', dateText: 'October 19, 2026', contactEmail: 'info@brightonlawn.com', company: 'Brighton Lawn + Landscape' });
check('1 the email says what the owner asked for, word for word',
  m.hello === 'Hi David Cohen,'
  && m.body === 'Thank you for asking us to quote your project. The quote total is $0.00 as of October 19, 2026.'
  && m.closing === "If you have any questions or concerns regarding this quote, please don't hesitate to get in touch with info@brightonlawn.com."
  && m.sign === 'Sincerely,\nBrighton Lawn + Landscape' && m.button === 'View quote');

const fn = read('supabase/functions/send-document-email/index.ts');
check('2 the server function says exactly the same words and has the View button linking to the approval page',
  fn.includes("Thank you for asking us to quote your project. The quote total is ${o.totalText} as of ${o.dateText}.")
  && fn.includes("If you have any questions or concerns regarding this ${what}, please don't hesitate to get in touch with ${o.contactEmail}.")
  && fn.includes("Sincerely,\\n${o.company}") && fn.includes('View ${esc(m.what)}') && fn.includes('/approve/${doc.share_token}'));
check('3 it is only for the owner or an admin, never for drafts, and replies go to the company address',
  /\['owner', 'admin'\]\.includes\(member\.role\)/.test(fn) && /doc\.status === 'draft' \|\| !doc\.share_token/.test(fn) && /reply_to: contact/.test(fn));
check('4 the recipient is the customer on file, or an address the owner types; a bad address is refused',
  email.recipientFor('a@b.co', undefined) === 'a@b.co' && email.recipientFor(undefined, undefined) === null && email.recipientFor('a@b.co', 'x@y.org') === 'x@y.org' && email.recipientFor('a@b.co', 'nope') === null);
check('5 errors are explained in plain words (not set up, no address, function missing)',
  /Resend key is missing/.test(email.describeEmailError('email_not_configured')) && /no email address/i.test(email.describeEmailError('no_email')) && /isn't deployed/.test(email.describeEmailError('Failed to send a request to the Edge Function')));

const doc = read('app/(owner)/document.tsx');
check('6 the Send menu offers Email to Customer first, then Text Approval Link, and asks for an address when none is on file',
  doc.indexOf("label: 'Email to Customer'") > 0 && doc.indexOf("label: 'Email to Customer'") < doc.indexOf("'Text Approval Link'") && /menu === 'email'/.test(doc) && /recipientFor\(doc\.customer\?\.email, typed\)/.test(doc));
check('7 an email is only sent after the owner confirms, and the result is shown', /confirmAction\(\s*`Email \$\{label\.toLowerCase\(\)\} \$\{doc\.number\}\?`/.test(doc) && /Email sent/.test(doc));

const inv = email.buildDocumentEmailMessage({ customerName: 'David Cohen', kind: 'invoice', totalText: '$250.00', dateText: 'October 21, 2026', contactEmail: 'info@brightonlawn.com', company: 'Brighton Lawn + Landscape', dueText: 'November 4, 2026' });
check('9 an invoice email says invoice, the total and the due date, and the same words live in the server function',
  inv.body === 'Here is your invoice. The invoice total is $250.00 as of October 21, 2026. Payment is due by November 4, 2026.'
  && inv.button === 'View invoice'
  && fn.includes('Here is your invoice. The invoice total is ${o.totalText} as of ${o.dateText}.')
  && /'invoice' \? 'invoices'/.test(fn));
check('10 invoices are no longer refused by the app, the link works for them, and the invoice send menu says Invoice Link',
  !/Invoices are not emailed from here yet/.test(read('src/data/financials.ts'))
  && !/doc\.kind === 'invoice' \|\| doc\.status === 'draft'/.test(read('src/data/financials.ts'))
  && /'Text Invoice Link'/.test(doc) && /doc\.status === 'issued'/.test(doc));
check('11 the database update gives invoices a token and the public page shows them read-only (test 081 proves the behavior)',
  fs.existsSync(path.join(__dirname, '../../supabase/updates/081_invoice_links.sql')) && fs.existsSync(path.join(__dirname, '../../supabase/tests/081_invoice_links.pglite.mjs')));

const strokes = [[{ x: 1, y: 2 }, { x: 3.14, y: 4 }, { x: 5, y: 6 }, { x: 7, y: 8 }, { x: 9, y: 10 }], [{ x: 20, y: 20 }, { x: 25, y: 22 }, { x: 30, y: 21 }, { x: 35, y: 25 }]];
const path1 = sig.strokesToPath(strokes);
check('8 strokes become plain path text the database accepts; a stray tap is not a signature',
  path1.startsWith('M 1 2 L 3.1 4') && sig.isValidSignaturePath(path1) && sig.hasSigned(strokes) && !sig.hasSigned([[{ x: 1, y: 1 }]]) && !sig.isValidSignaturePath('M 0 0"><script>') && !sig.isValidSignaturePath(''));
const long = [Array.from({ length: 6000 }, (_, i) => ({ x: i % 300, y: (i * 7) % 120 }))];
check('9 a very long scribble is thinned to fit the size limit', sig.fitSignature(long).length <= sig.SIG_MAX_CHARS && sig.isValidSignaturePath(sig.fitSignature(long)));

const page = read('app/approve/[token].tsx');
check('10 the approval page needs name + signature + agreement to approve, and sends the signature',
  /disabled=\{!nameOk \|\| !signed \|\| !agreed \|\| !!saving\}/.test(page) && /<SignaturePad onChange=\{setSignature\}/.test(page) && /p_signature: approve \? signature \|\| null : null/.test(page));
check('11 the customer can Request Changes (with what to change) and Download PDF before answering',
  /title=\{t\('Request Changes'\)\}/.test(page) && /What would you like changed\?/.test(page) && /title=\{t\('Send Request'\)\}/.test(page) && /title=\{t\('Download PDF'\)\}/.test(page));
const html = read('src/lib/documentHtml.ts');
check('12 the approved PDF prints the signature, re-checked as plain path text first', /isValidSignaturePath\(doc\.approvedSignature\)/.test(html) && /<path d=/.test(html));
const sql = read('supabase/updates/054_quote_signature.sql');
check('13 the database saves it with the approval, only as path text, and never lets it change after', /approved_signature text/.test(sql) && /\^\[ML0-9\.,\[:space:\]-\]\+\$/.test(sql) && /The approval signature can''t be changed/.test(sql));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
