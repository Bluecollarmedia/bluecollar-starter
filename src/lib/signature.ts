// A drawn signature, kept as plain SVG path text ("M x y L x y ..." inside a 300 x 120 box). Pure, no network.
// The database accepts only this alphabet (supabase/updates/054), so it can never carry anything but a line drawing.

export const SIG_WIDTH = 300;
export const SIG_HEIGHT = 120;
export const SIG_MAX_CHARS = 20000;
/** Fewer points than this is a tap, not a signature. */
export const SIG_MIN_POINTS = 8;

export interface Point { x: number; y: number }

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Strokes (lists of points in the 300 x 120 box) as one path string. A single tap becomes a tiny dot. */
export function strokesToPath(strokes: Point[][]): string {
  const parts: string[] = [];
  for (const s of strokes) {
    if (!s.length) continue;
    const pts = s.length === 1 ? [s[0], { x: s[0].x + 0.1, y: s[0].y }] : s;
    parts.push(`M ${r1(pts[0].x)} ${r1(pts[0].y)}`);
    for (let i = 1; i < pts.length; i++) parts.push(`L ${r1(pts[i].x)} ${r1(pts[i].y)}`);
  }
  return parts.join(' ');
}

/** Whether text is a signature path the database will accept. */
export function isValidSignaturePath(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.length > 0 && text.length <= SIG_MAX_CHARS && /^[ML0-9.,\s-]+$/.test(text);
}

/** Has the person drawn enough to count as signing? */
export function hasSigned(strokes: Point[][]): boolean {
  return strokes.reduce((n, s) => n + s.length, 0) >= SIG_MIN_POINTS;
}

/** Keeps the path under the size limit by dropping every other point of long strokes, so a very long scribble still saves. */
export function fitSignature(strokes: Point[][]): string {
  let path = strokesToPath(strokes);
  let current = strokes;
  while (path.length > SIG_MAX_CHARS - 200 && current.some((s) => s.length > 4)) {
    current = current.map((s) => (s.length > 4 ? s.filter((_, i) => i % 2 === 0 || i === s.length - 1) : s));
    path = strokesToPath(current);
  }
  return path;
}
