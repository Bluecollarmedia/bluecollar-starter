// Run: node scripts/checks/noPlatformSelfImport.check.cjs
// A platform file (Foo.ios.tsx / Foo.android.tsx / Foo.web.tsx) must never import './Foo'. On that platform './Foo' resolves
// to the file itself, so a fallback written that way renders itself forever: the screen freezes, then the app runs out of
// memory and closes. (This is exactly what crashed Check-in distance and the job maps on iPhone.)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');

/** True when `src` (the text of `<base>.<platform>.tsx`) imports './<base>'. */
function importsItself(src, base) {
  const re = new RegExp('from\\s+[\'"]\\./' + base + '[\'"]|require\\([\'"]\\./' + base + '[\'"]\\)');
  return re.test(src);
}

function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walk(rel, out); else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(rel);
  }
  return out;
}

let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (d || ''))); };

// The detector itself: it must flag the exact bug that crashed the app, and leave good imports alone.
check('0 the detector flags the old bug and not the fix',
  importsItself("import { RadiusMap as DrawnRadius } from './RadiusMap';", 'RadiusMap') === true
  && importsItself("import { JobMap as PinCard } from './JobMap';", 'JobMap') === true
  && importsItself("import { RadiusMapDrawn as DrawnRadius } from './RadiusMapDrawn';", 'RadiusMap') === false
  && importsItself("import { JobMapPin as PinCard } from './JobMapPin';", 'JobMap') === false);

const offenders = [];
for (const f of walk('app', []).concat(walk('src', []))) {
  const m = path.basename(f).match(/^(.*)\.(ios|android|web|native)\.(tsx?|jsx?)$/);
  if (!m) continue;
  if (importsItself(fs.readFileSync(path.join(root, f), 'utf8'), m[1])) offenders.push(f);
}
check('1 no platform file imports its own base name', offenders.length === 0, offenders.join(', '));

const jm = fs.readFileSync(path.join(root, 'src/components/maps/JobMap.ios.tsx'), 'utf8');
const rm = fs.readFileSync(path.join(root, 'src/components/maps/RadiusMap.ios.tsx'), 'utf8');
check('2 the iPhone maps fall back to drawn components that have no iPhone twin',
  /from '\.\/JobMapPin'/.test(jm) && /from '\.\/RadiusMapDrawn'/.test(rm)
  && fs.existsSync(path.join(root, 'src/components/maps/JobMapPin.tsx'))
  && fs.existsSync(path.join(root, 'src/components/maps/RadiusMapDrawn.tsx')));

console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
