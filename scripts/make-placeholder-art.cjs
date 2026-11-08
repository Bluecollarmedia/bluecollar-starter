// Makes the plain placeholder pictures of the starter kit (Step 4, the plain look). No extra packages: Node's own zlib writes the PNGs.
//
//   node scripts/make-placeholder-art.cjs
//
// What it draws (all in the brand color from src/config/brand.js, look.brandColor; charcoal #2B2B2B by default):
//   assets/images/icon.png              1024 x 1024 App Store / home-screen icon: brand-color square, white "S" (no see-through parts)
//   assets/images/icon-foreground.png   1024 x 1024 Android adaptive icon front layer: the white "S" (the back layer is look.androidIconBackground)
//   assets/images/logo-mark.png          512 x 512  the mark: a rounded brand-color square with the "S" cut out (tinted in places)
//   assets/images/logo-full.png        ~1200 x 350  the mark + the words "Starter App" (sign-in, welcome, splash, invite page, PDFs)
//   assets/images/weather-hero.png       585 x 820  the plain light-gray sky behind the top of the Weather screen
//   assets/icon.png, assets/favicon.png, assets/splash-icon.png, assets/android-icon-*.png   the Expo template files, made plain too
//   src/lib/brandLogo.ts                the logo as text (base64) for quote / invoice PDFs, rebuilt from logo-full.png
//
// A client with a real logo replaces the picture files (same names and sizes) and rebuilds brandLogo.ts from the new logo-full.png
// (see the note at the top of src/lib/brandLogo.ts). Run this script again only to go back to the plain placeholders.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const brand = require(path.join(root, 'src/config/brand.js'));

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  const n = parseInt(m ? m[1] : '2B2B2B', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const BRAND = hexRgb(brand.look.brandColor);
const WHITE = [255, 255, 255];

// ── PNG writer ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** pixels: Uint8Array of width*height*channels (3 = RGB, 4 = RGBA). Every row uses the "Sub" filter (small files for smooth art). */
function encodePng(width, height, channels, pixels) {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1;
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      raw[o + 1 + x] = (cur - left) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Shapes as distance fields (smooth edges at any size) ─────────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const coverage = (distPx) => clamp01(0.5 - distPx);
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** Distance to an arc (centre, radius, from a0 to a1 degrees counter-clockwise, y pointing up). */
function arcDist(px, py, cx, cy, r, a0, a1) {
  let a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
  while (a < a0) a += 360;
  if (a <= a1) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  const e = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const [x0, y0] = e(a0);
  const [x1, y1] = e(a1);
  return Math.min(Math.hypot(px - x0, py - y0), Math.hypot(px - x1, py - y1));
}
/** Signed distance to a rounded square (centre cx, cy; half size h; corner radius r). Negative inside. */
function roundRectDist(px, py, cx, cy, h, r) {
  const qx = Math.abs(px - cx) - (h - r);
  const qy = Math.abs(py - cy) - (h - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// ── A tiny stroke alphabet: just the letters of "Starter App" (cap height 1, baseline 0, y up) ───────────────────────────────
function glyphs(sw) {
  const h = sw / 2;
  const xh = 0.7;
  const R = (xh - sw) / 2;
  const by = xh / 2;
  const H = 1 - sw;
  const sr = H / 4;
  const scx = h + sr;
  return {
    S: { w: 2 * sr + sw, parts: [['arc', scx, h + (3 * H) / 4, sr, 25, 270], ['arc', scx, h + H / 4, sr, 205, 450]] },
    t: { w: 0.5, parts: [['seg', h, xh - h, 0.5 - h, xh - h], ['seg', 0.25, h, 0.25, 0.94]] },
    a: { w: 2 * R + sw, parts: [['arc', h + R, by, R, 0, 360], ['seg', h + 2 * R, h, h + 2 * R, xh - h]] },
    r: { w: 0.6, parts: [['seg', h, h, h, xh - h], ['arc', h + 0.26, xh - h - 0.26, 0.26, 40, 180]] },
    e: { w: 2 * R + sw, parts: [['arc', h + R, by, R, 0, 320], ['seg', h, by, h + 2 * R, by]] },
    A: { w: 0.82, parts: [['seg', h, h, 0.41, 1 - h], ['seg', 0.41, 1 - h, 0.82 - h, h], ['seg', 0.2, 0.33, 0.62, 0.33]] },
    p: { w: 2 * R + sw, parts: [['arc', h + R, by, R, 0, 360], ['seg', h, xh - h, h, -0.28]] },
    ' ': { w: 0.26, parts: [] },
  };
}
/** Lays out text: a list of strokes in text units, and the total width. */
function layout(text, sw, spacing = 0.075) {
  const g = glyphs(sw);
  const parts = [];
  let x = 0;
  for (const ch of text) {
    const gl = g[ch];
    if (!gl) throw new Error(`no glyph for "${ch}"`);
    for (const p of gl.parts) {
      if (p[0] === 'seg') parts.push(['seg', p[1] + x, p[2], p[3] + x, p[4]]);
      else parts.push(['arc', p[1] + x, p[2], p[3], p[4], p[5]]);
    }
    x += gl.w + spacing;
  }
  return { parts, width: x - spacing, sw };
}
/** Distance (in text units) from a point to the strokes' edge. */
function strokeDist(parts, sw, x, y) {
  let d = Infinity;
  for (const p of parts) {
    const v = p[0] === 'seg' ? segDist(x, y, p[1], p[2], p[3], p[4]) : arcDist(x, y, p[1], p[2], p[3], p[4], p[5]);
    if (v < d) d = v;
  }
  return d - sw / 2;
}

// ── Painting helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
function canvas(w, h, channels, fill) {
  const px = new Uint8Array(w * h * channels);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < channels; c++) px[i * channels + c] = fill[c] ?? 0;
  return { w, h, channels, px };
}
/** Paints `color` wherever cov(x, y) > 0 (x, y are pixel centres, y down), blending over what is there. */
function paint(cv, color, cov) {
  const { w, h, channels, px } = cv;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = cov(x + 0.5, y + 0.5);
      if (a <= 0) continue;
      const i = (y * w + x) * channels;
      if (channels === 4) {
        const da = px[i + 3] / 255;
        const oa = a + da * (1 - a);
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(oa ? (color[c] * a + px[i + c] * da * (1 - a)) / oa : 0);
        px[i + 3] = Math.round(oa * 255);
      } else {
        for (let c = 0; c < 3; c++) px[i + c] = Math.round(color[c] * a + px[i + c] * (1 - a));
      }
    }
  }
}
/** Coverage of the "S" (cap height `size` px, centred on cx, cy in pixels). */
function sCoverage(size, cx, cy, sw = 0.17) {
  const t = layout('S', sw, 0);
  const s = size;
  const ox = cx - (t.width * s) / 2;
  const oy = cy + s / 2;
  return (x, y) => coverage(strokeDist(t.parts, sw, (x - ox) / s, (oy - y) / s) * s);
}
/** Coverage of the mark: a rounded square with the "S" cut out. */
function markCoverage(size, cx, cy) {
  const half = size / 2;
  const s = sCoverage(size * 0.56, cx, cy);
  return (x, y) => coverage(roundRectDist(x, y, cx, cy, half, size * 0.225)) * (1 - s(x, y));
}

const out = (rel, buf) => {
  fs.writeFileSync(path.join(root, rel), buf);
  console.log(`wrote ${rel} (${buf.length} bytes)`);
};
const save = (rel, cv) => out(rel, encodePng(cv.w, cv.h, cv.channels, cv.px));

// ── The pictures ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// App icon: brand-color square, white S, no transparency (Apple rounds the corners itself).
const icon = canvas(1024, 1024, 3, BRAND);
paint(icon, WHITE, sCoverage(1024 * 0.5, 512, 512));
save('assets/images/icon.png', icon);
save('assets/icon.png', icon);

// Android adaptive icon front layer: the white S inside the safe middle area (the back layer is the brand color).
const fg = canvas(1024, 1024, 4, [0, 0, 0, 0]);
paint(fg, WHITE, sCoverage(1024 * 0.34, 512, 512));
save('assets/images/icon-foreground.png', fg);
const fg512 = canvas(512, 512, 4, [0, 0, 0, 0]);
paint(fg512, WHITE, sCoverage(512 * 0.34, 256, 256));
save('assets/android-icon-foreground.png', fg512);
save('assets/android-icon-background.png', canvas(512, 512, 4, [...BRAND, 255]));
const mono = canvas(432, 432, 4, [0, 0, 0, 0]);
paint(mono, WHITE, sCoverage(432 * 0.34, 216, 216));
save('assets/android-icon-monochrome.png', mono);

// The mark (transparent around it, so screens can tint it).
const mark = canvas(512, 512, 4, [0, 0, 0, 0]);
paint(mark, BRAND, markCoverage(496, 256, 256));
save('assets/images/logo-mark.png', mark);

// Splash and web icons from the Expo template, made plain.
const splash = canvas(1024, 1024, 4, [0, 0, 0, 0]);
paint(splash, BRAND, markCoverage(400, 512, 512));
save('assets/splash-icon.png', splash);
const fav = canvas(48, 48, 4, [0, 0, 0, 0]);
paint(fav, BRAND, (x, y) => coverage(roundRectDist(x, y, 24, 24, 23, 10)));
paint(fav, WHITE, sCoverage(24, 24, 24, 0.2));
save('assets/favicon.png', fav);

// The full logo: the mark, then "Starter App" in the brand color.
const LH = 350;
const markSize = 230;
const words = layout('Starter App', 0.13);
const cap = 124;
const tx = 20 + markSize + 56;
const LW = Math.ceil(tx + words.width * cap + 24);
const logo = canvas(LW, LH, 4, [0, 0, 0, 0]);
paint(logo, BRAND, markCoverage(markSize, 20 + markSize / 2, LH / 2));
const baseline = LH / 2 + cap / 2;
paint(logo, BRAND, (x, y) => {
  const ux = (x - tx) / cap;
  const uy = (baseline - y) / cap;
  if (ux < -0.2 || ux > words.width + 0.2 || uy < -0.45 || uy > 1.2) return 0;
  return coverage(strokeDist(words.parts, words.sw, ux, uy) * cap);
});
save('assets/images/logo-full.png', logo);

// Weather: a plain light-gray sky that fades into the white page.
const HW = 585;
const HH = 820;
const hero = canvas(HW, HH, 3, WHITE);
for (let y = 0; y < HH; y++) {
  const t = Math.min(1, y / (HH * 0.85));
  const v = Math.round(228 + (255 - 228) * (t * t * (3 - 2 * t)));
  for (let x = 0; x < HW; x++) {
    const i = (y * HW + x) * 3;
    hero.px[i] = v;
    hero.px[i + 1] = v;
    hero.px[i + 2] = v;
  }
}
save('assets/images/weather-hero.png', hero);

// The logo as text for the PDFs.
const b64 = fs.readFileSync(path.join(root, 'assets/images/logo-full.png')).toString('base64');
const ts = `/**
 * The company logo (assets/images/logo-full.png, ${LW}×${LH}) as a data URI, so quote/invoice PDFs can embed it directly:
 * the print renderer can't load bundled assets by path.
 *
 * Made by scripts/make-placeholder-art.cjs (the plain placeholder). With your own logo, replace assets/images/logo-full.png and
 * rebuild this file: set the width and height to the new picture's and paste the new text after "base64," from
 *   node -e "console.log(require('fs').readFileSync('assets/images/logo-full.png').toString('base64'))"
 * (scripts/checks/plainLook.check.cjs fails while the two differ.)
 */
export const BRAND_LOGO_WIDTH = ${LW};
export const BRAND_LOGO_HEIGHT = ${LH};
export const BRAND_LOGO_DATA_URI =
  'data:image/png;base64,${b64}';
`;
out('src/lib/brandLogo.ts', Buffer.from(ts, 'utf8'));
