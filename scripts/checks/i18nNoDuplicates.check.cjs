// Run: node scripts/checks/i18nNoDuplicates.check.cjs <path to typescript package>
// Every English phrase has exactly ONE Spanish translation. The Spanish files (src/i18n/es*.ts) are merged into one dictionary
// (src/i18n/dictionary.ts) and the later file wins, so a phrase written in two files (or twice in one) silently shows the wrong
// words somewhere (it once turned "Upcoming" on My Jobs into "Próxima"). This fails on any phrase defined more than once.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '../../src/i18n');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const files = fs.readdirSync(dir).filter((f) => /^es(\..+)?\.ts$/.test(f)).sort();
const seen = new Map(); // English key -> ['es.ts:12', ...]
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.parent)) {
      const k = n.name;
      const key = ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k) || ts.isIdentifier(k) ? k.text : null;
      if (key != null) {
        const where = `${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
        seen.set(key, [...(seen.get(key) ?? []), where]);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const dups = [...seen].filter(([, where]) => where.length > 1);
check(`1 the Spanish files were found and read (${files.join(', ')})`, files.includes('es.ts') && seen.size > 100, `${files.length} files, ${seen.size} phrases`);
check('2 no English phrase is translated in two Spanish files, or twice in one file', dups.length === 0,
  dups.slice(0, 15).map(([k, where]) => `${JSON.stringify(k)} in ${where.join(' and ')}`).join('; ') + (dups.length > 15 ? ` (+${dups.length - 15} more)` : ''));
const dict = fs.readFileSync(path.join(dir, 'dictionary.ts'), 'utf8');
const missing = files.filter((f) => !dict.includes(`'./${f.replace(/\.ts$/, '')}'`));
check('3 every Spanish file is merged into the dictionary (no file is left out)', missing.length === 0, missing.join(', '));
const worker = fs.readFileSync(path.join(dir, 'es.worker.ts'), 'utf8');
check('4 "Upcoming" on My Jobs reads "Próximos"', /'Upcoming': 'Próximos'/.test(worker));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
