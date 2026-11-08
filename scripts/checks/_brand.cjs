// Shared helper for the checks (not a check itself: verify runs only *.check.cjs).
// - brand: the settings from src/config/brand.js
// - brandModule(): what `@/config/brand` gives the app, for checks that compile one file with a fake require()
// - expoConfig(): the final Expo config, the way the build tools see it (app.json put through app.config.js)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const brandPath = path.join(root, 'src/config/brand.js');

function freshBrand() {
  delete require.cache[require.resolve(brandPath)];
  return require(brandPath);
}

const brand = freshBrand();

let cached = null;
/** The compiled src/config/brand.ts (typed helpers included), reading src/config/brand.js. */
function brandModule(ts) {
  if (cached) return cached;
  const tsLib = ts || require(process.argv[2] || 'typescript');
  const src = fs.readFileSync(path.join(root, 'src/config/brand.ts'), 'utf8');
  const m = { exports: {} };
  const out = tsLib.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true } }).outputText;
  new Function('module', 'exports', 'require', out)(m, m.exports, (n) => (n === './brand.js' ? brand : require(n)));
  cached = m.exports;
  return cached;
}

/** The Expo config after app.config.js has filled in the brand values. */
function expoConfig() {
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  const fn = require(path.join(root, 'app.config.js'));
  return fn({ config: JSON.parse(JSON.stringify(appJson)) });
}

const themeCache = {};
/** A theme file (src/theme/<name>.ts, e.g. colors or weather) compiled for Node, reading the settings file. */
function themeModule(name, ts) {
  if (themeCache[name]) return themeCache[name];
  const tsLib = ts || require(process.argv[2] || 'typescript');
  const src = fs.readFileSync(path.join(root, `src/theme/${name}.ts`), 'utf8');
  const m = { exports: {} };
  const out = tsLib.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true } }).outputText;
  const req = (n) => (n === '@/config/brand' ? brandModule(tsLib) : n.startsWith('@/theme/') ? themeModule(n.slice('@/theme/'.length), tsLib) : require(n));
  new Function('module', 'exports', 'require', out)(m, m.exports, req);
  themeCache[name] = m.exports;
  return m.exports;
}

/** A require() for compiled files that answers '@/config/brand' and the theme files ('@/theme/colors', '@/theme/weather'),
 *  and falls back to `other` for everything else. */
const withBrand = (other, ts) => (n) => (n === '@/config/brand' ? brandModule(ts) : n.startsWith('@/theme/') ? themeModule(n.slice('@/theme/'.length), ts) : other(n));

module.exports = { brand, brandModule, themeModule, expoConfig, withBrand, freshBrand };
