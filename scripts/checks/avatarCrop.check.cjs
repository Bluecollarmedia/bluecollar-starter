// Run: node scripts/checks/avatarCrop.check.cjs <path to typescript package>
// The profile photo crop: the maths (which part of the picture is under the circle) and the wiring on every screen.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/lib/avatarCropMath.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const c = m.exports;
let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (d || ''))); };

const sq = { width: 1000, height: 1000, frame: 300 };
check('1 zoom 1 on a square picture crops the whole picture', JSON.stringify(c.cropBox({ ...sq, zoom: 1 }, 0, 0)) === JSON.stringify({ originX: 0, originY: 0, size: 1000 }));
check('2 zoom 2 crops the middle half', JSON.stringify(c.cropBox({ ...sq, zoom: 2 }, 0, 0)) === JSON.stringify({ originX: 250, originY: 250, size: 500 }));
const wide = { width: 2000, height: 1000, frame: 300 };
check('3 a wide picture centred shows its middle square; dragged left it shows the right edge; dragged right, the left edge',
  c.cropBox({ ...wide, zoom: 1 }, 0, 0).originX === 500
  && c.cropBox({ ...wide, zoom: 1 }, -150, 0).originX === 1000
  && c.cropBox({ ...wide, zoom: 1 }, 150, 0).originX === 0);
check('4 dragging past the edge is held at the edge (the crop never leaves the picture)',
  c.cropBox({ ...wide, zoom: 1 }, -9999, 9999).originX === 1000 && c.cropBox({ ...wide, zoom: 1 }, -9999, 9999).originY === 0
  && c.clampOffset({ ...sq, zoom: 1 }, 50, 50).tx === 0);
check('5 zoom is kept between 1 and 4', c.clampZoom(0.2) === 1 && c.clampZoom(9) === 4 && c.clampZoom(NaN) === 1 && c.fractionToZoom(0) === 1 && c.fractionToZoom(1) === 4 && Math.abs(c.zoomToFraction(2.5) - 0.5) < 1e-9);
const big = c.cropBox({ ...wide, zoom: 4 }, 0, 0);
check('6 the crop box is always inside the picture and square', big.originX >= 0 && big.originY >= 0 && big.originX + big.size <= 2000 && big.originY + big.size <= 1000 && big.size === 250);

const cropper = read('src/components/account/AvatarCropper.tsx');
check('7 the crop screen is a circle over the picture with a slider; the website also gets wheel zoom, the phone does not pinch',
  /borderRadius: frame \/ 2/.test(cropper) && /accessibilityLabel=\{t\('Zoom'\)\}/.test(cropper) && /Platform\.OS === 'web'\s*\? \{ onWheel/.test(cropper) && !/PinchGesture|onTouchMove|scale: .*gesture/i.test(cropper));
check('8 Done crops the chosen square; if the crop fails the caller still gets a picture (automatic square)', /cropAvatarToBox\(uri, box\)/.test(cropper) && /onPicked\(cropped \?\? p\.fallback\)/.test(read('src/hooks/useProfilePhoto.tsx')));
const hook = read('src/hooks/useProfilePhoto.tsx');
check('9 the crop screen opens after the picker (camera or library) has closed', /AFTER_PICKER_MS/.test(hook) && /await sleep\(AFTER_PICKER_MS\)/.test(hook));
const screens = ['src/components/account/EditProfileScreen.tsx', 'src/components/account/SignupPhotoPicker.tsx', 'app/invite/[token].tsx'];
check('10 every place that picks a profile photo uses the crop flow', screens.every((f) => /useProfilePhoto\(/.test(read(f)) && /\{photo\.cropper\}/.test(read(f)) && !/chooseProfilePhoto\(/.test(read(f))));
check('11 the account-creation screens get it through the shared picker', ['app/(auth)/create-company.tsx'].every((f) => /<SignupPhotoPicker /.test(read(f))));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
