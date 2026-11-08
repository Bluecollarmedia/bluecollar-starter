// Run: node scripts/checks/wordingNoProjectProperty.check.cjs [<path to typescript package>] [--list]
// The app never SHOWS the words "Project(s)" or "Property / Properties". People see the client's own words from the settings file
// (src/config/brand.js wording: job / jobs / place / places, "Job" and "Job site" by default), through w() in src/config/brand.ts
// (and t() / tr(), which run w() on every sentence).
//
// This reads every .ts / .tsx file under app/ and src/ and looks at the text a person can see: JSX text, and string / template
// literals. It skips what is not shown: comments, imports, type names, object keys, routes and file paths, database names
// (one word with no spaces, like 'projects' or 'property_id'), console messages and the Spanish dictionary keys of the OLD text
// (there are none: the keys are the English sentences, which follow the same rule). Code names (projectId, useProject) are never
// literals, so they are not looked at.
const ts = require(process.argv.slice(2).find((a) => !a.startsWith('--')) || 'typescript');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const LIST = process.argv.includes('--list');
const WORD = /\bprojects?\b|\bpropert(?:y|ies)\b/i;
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

/** Texts that may keep the word, each with the reason. Key: "<file>|<exact literal text>". Keep this list tiny. */
const ALLOWED = new Map([
  // (empty on purpose: every shown text says the client's words)
]);

/** Attributes that never show text. */
const HIDDEN_ATTRS = new Set(['testID', 'key', 'name', 'href', 'pathname', 'nativeID', 'source', 'style', 'icon', 'route', 'type', 'id']);

/** One word with no spaces that looks like a code / database / route name, not a sentence ('projects', 'property_id', '/(owner)/projects'). */
const looksLikeName = (s) => {
  const tokens = s.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && /^[a-z0-9_\-./[\]()$:{}*?=&,%|!<>"']+$/.test(tokens[0])) return true; // 'projects', 'property_id'
  // Every token holding the word is a path / select / route piece ("/(owner)/projects", "projects!inner(name)", "properties.name").
  return tokens.filter((t) => WORD.test(t)).every((t) => /[/()[\]:=!]|\w\.\w/.test(t));
};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(root, 'app'), []), ...walk(path.join(root, 'src'), [])];
const found = [];

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  if (!WORD.test(src)) continue;
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const hidden = (n) => {
    for (let p = n.parent, c = n; p; c = p, p = p.parent) {
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportTypeNode?.(p) || ts.isLiteralTypeNode(p) || ts.isTypeNode(p)) return true;
      if (ts.isCallExpression(p) && c !== p.expression) {
        const callee = p.expression.getText(sf);
        if (/^(require|import|console\.\w+|router\.(push|replace|navigate)|\w+\.from|\w+\.rpc|\w+\.eq|\w+\.channel|\w+\.select|\w+\.in|\w+\.on|Linking\.\w+)$/.test(callee)) return true;
      }
      if (ts.isPropertyAssignment(p) && p.name === c) return true;
      if (ts.isElementAccessExpression(p) && p.argumentExpression === c) return true;
      if (ts.isJsxAttribute(p) && HIDDEN_ATTRS.has(p.name.getText(sf))) return true;
      if (ts.isCaseClause(p) && p.expression === c) return true;
      if (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText(sf))) return true;
      if (ts.isStatement(p) || ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) return false;
    }
    return false;
  };

  // A lone lowercase word is usually a code name ('projects'), but not as a shown fallback: `${v.label ?? 'property'}`.
  const shownFallback = (n) => n.parent && ((ts.isBinaryExpression(n.parent) && n.parent.right === n && /^(\?\?|\|\|)$/.test(n.parent.operatorToken.getText(sf)))
    || (ts.isConditionalExpression(n.parent) && n.parent.condition !== n && (ts.isTemplateSpan(n.parent.parent) || ts.isJsxExpression(n.parent.parent))));
  const add = (n, text) => {
    if (!WORD.test(text) || (looksLikeName(text) && !shownFallback(n))) return;
    if (ALLOWED.has(`${rel}|${text}`)) return;
    found.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}  ${JSON.stringify(text.trim().slice(0, 120))}`);
  };

  const visit = (n) => {
    if (ts.isJsxText(n)) { if (WORD.test(n.text)) found.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}  ${JSON.stringify(n.text.trim().slice(0, 120))}`); } // JSX text is always shown
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (!hidden(n)) add(n, n.text); }
    else if (ts.isTemplateExpression(n)) {
      if (!hidden(n)) {
        // The fixed parts joined with a space where each value goes ("{x} projects").
        const whole = n.head.text + n.templateSpans.map((s) => ' {} ' + s.literal.text).join('');
        if (WORD.test(n.head.text) || n.templateSpans.some((s) => WORD.test(s.literal.text))) add(n, whole);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// ── Step 4 follow-up: every shown "Job(s)" / "Job site(s)" / "Crew(s)" goes through w() / t() / tr() ─────────────────────────────
// Text written with the default words only follows a changed setting (wording.job: 'Project', wording.crew: 'Team' ...) when it is
// passed through w() (src/config/brand.ts) or t() / tr() (src/i18n, which run w() on every sentence). Same reading rules as above:
// shown text only (JSX text, string and template literals), never code names, routes, database names or object keys.
const NOUN = /\b(?:jobs?|crews?)\b/i;
/** Calls that put a text through the wording swap. `settingsWords` is w() imported under another name where `w` is a local.
 *  explainError / rpcDone / callDay / timeRpc (src/data/timeTracking.ts) hand their fallback message to tr(). */
const WRAPPERS = /^(?:t|tr|w|wEs|settingsWords|explainError|rpcDone|callDay|timeRpc)$/;
/** Shown texts that are put through w() / t() where they are SHOWN (wrapping them again here would break the Spanish lookup
 *  when the wording changes), each with the place. Key: "<file>|<exact literal text>". */
const NOUN_ALLOWED = new Map([
  ['src/lib/customerMessage.ts|Active job', 'MessageCustomersScreen shows it as w(a.label) / w(audienceLabel(...))'],
  ['src/lib/customerMessage.ts|Customers with an active job.', 'MessageCustomersScreen shows it as w(help)'],
  ['src/lib/customerPortal.ts|Your jobs appear here once your contractor links them to your account.', 'the customer home shows it as t(emptyPortalText().description)'],
  ['src/lib/serviceRequest.ts|Enter the town or ZIP code of the job site.', 'the Request screen shows it as t(problem)'],
  ['app/(worker)/(tabs)/index.tsx|Job Cancelled', 'shown as t(weatherMeta.label)'],
  ['src/data/store.ts|Crew A', 'the demo crew\'s saved name (data, like a name the owner typed)'],
]);
/** Sample data (demo records stand for saved data, which keeps the words it was typed with). */
const SAMPLE_DATA = /^src\/data\/mock/;
const looksLikeNounName = (s) => {
  const tokens = s.trim().split(/\s+/).filter((t) => t && t !== '{}'); // '{}' marks where a template value goes
  if (tokens.length === 1 && /^[a-z0-9_\-./[\]()$:{}*?=&,%|!<>"']+$/.test(tokens[0])) return true;
  return tokens.filter((t) => NOUN.test(t)).every((t) => /[/()[\]:=!]|\w\.\w/.test(t));
};
const unwrapped = [];
for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (/^src\/i18n\//.test(rel) || /^src\/config\//.test(rel) || SAMPLE_DATA.test(rel)) continue; // the dictionaries, the settings, sample data
  const src = fs.readFileSync(file, 'utf8');
  if (!NOUN.test(src)) continue;
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hidden = (n) => {
    for (let p = n.parent, c = n; p; c = p, p = p.parent) {
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isTypeNode(p)) return true;
      if (ts.isCallExpression(p) && c !== p.expression) {
        const callee = p.expression.getText(sf);
        if (WRAPPERS.test(callee)) return true; // already goes through the wording swap
        if (/^(require|import|console\.\w+|router\.(push|replace|navigate)|\w+\.from|\w+\.rpc|\w+\.eq|\w+\.channel|\w+\.select|\w+\.in|\w+\.on|\w+\.invoke|Linking\.\w+|logError|reportError|captureError)$/.test(callee)) return true;
      }
      if (ts.isPropertyAssignment(p) && p.name === c) return true;
      if (ts.isElementAccessExpression(p) && p.argumentExpression === c) return true;
      if (ts.isJsxAttribute(p) && HIDDEN_ATTRS.has(p.name.getText(sf))) return true;
      if (ts.isCaseClause(p) && p.expression === c) return true;
      if (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText(sf))) return true;
      if (ts.isSourceFile(p)) return false;
    }
    return false;
  };
  const add = (n, text) => {
    if (!NOUN.test(text) || looksLikeNounName(text)) return;
    if (NOUN_ALLOWED.has(`${rel}|${text}`)) return;
    unwrapped.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}  ${JSON.stringify(text.trim().slice(0, 120))}`);
  };
  const visit = (n) => {
    if (ts.isJsxText(n)) { if (NOUN.test(n.text)) add(n, n.text); }
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (!hidden(n)) add(n, n.text); }
    else if (ts.isTemplateExpression(n)) {
      if (!hidden(n)) {
        const whole = n.head.text + n.templateSpans.map((s) => ' {} ' + s.literal.text).join('');
        if (NOUN.test(n.head.text) || n.templateSpans.some((s) => NOUN.test(s.literal.text))) add(n, whole);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

check(`1 the app and src folders were read (${files.length} files)`, files.length > 200, `${files.length} files`);
check('2 no text a person sees says "Project(s)" or "Property / Properties" (use Job / Job site through w() / t())', found.length === 0,
  `${found.length} found:\n    ${found.slice(0, LIST ? found.length : 40).join('\n    ')}${!LIST && found.length > 40 ? `\n    (+${found.length - 40} more; run with --list)` : ''}`);
check('3 every shown "Job(s)" / "Job site(s)" / "Crew(s)" text goes through w() / t() / tr(), so it follows the wording settings', unwrapped.length === 0,
  `${unwrapped.length} found:\n    ${unwrapped.slice(0, LIST ? unwrapped.length : 40).join('\n    ')}${!LIST && unwrapped.length > 40 ? `\n    (+${unwrapped.length - 40} more; run with --list)` : ''}`);

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
