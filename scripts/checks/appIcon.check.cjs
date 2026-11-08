// Run: node scripts/checks/appIcon.check.cjs
// The App Store needs a 1024 x 1024 square PNG icon with no transparency. Checks the real files and app.json.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

function png(rel) {
  const d = fs.readFileSync(path.join(root, rel));
  const isPng = d.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { isPng, w: d.readUInt32BE(16), h: d.readUInt32BE(20), colorType: d[25], hasTrns: d.includes(Buffer.from('tRNS')) };
}

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

const icon = png(app.icon.replace('./', ''));
check('1 the app icon is a real PNG file', icon.isPng);
check('2 the app icon is exactly 1024 x 1024 (square)', icon.w === 1024 && icon.h === 1024, `${icon.w}x${icon.h}`);
check('3 the app icon has no transparency (color type 2 = RGB, no tRNS)', icon.colorType === 2 && !icon.hasTrns, `colorType ${icon.colorType}`);
const fg = png(app.android.adaptiveIcon.foregroundImage.replace('./', ''));
check('4 the Android icon foreground is a 1024 x 1024 PNG', fg.isPng && fg.w === 1024 && fg.h === 1024);
check('5 iPhone only for the first release (no iPad screenshots or iPad review needed)', app.ios.supportsTablet === false);
check('6 bundle id, version and encryption answer are set', app.ios.bundleIdentifier === 'com.brightonlawn.app' && !!app.version && app.ios.infoPlist.ITSAppUsesNonExemptEncryption === false);
check('7 camera, photo, microphone and location texts explain why', ['photosPermission', 'cameraPermission', 'microphonePermission'].every((k) => JSON.stringify(app.plugins).includes(k)) && JSON.stringify(app.plugins).includes('locationWhenInUsePermission'));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
