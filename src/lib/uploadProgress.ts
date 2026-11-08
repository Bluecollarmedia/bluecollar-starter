/**
 * One progress bar for a save that sends several files one after the other (a post with 10 pictures, a reel, a story):
 * every file is one equal step, and the file being sent moves the bar through its own step as its bytes go up. Pure: no phone, no network.
 */

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Overall progress (0 to 1): `done` steps finished out of `total`, and the current step `fraction` of the way through. */
export function overallProgress(done: number, total: number, fraction: number): number {
  if (!(total > 0)) return 0;
  return clamp01((Math.max(0, Math.min(done, total)) + clamp01(fraction)) / total);
}

/** The percent shown beside the bar. */
export const percentOf = (progress: number): number => Math.round(clamp01(progress) * 100);

/** "Uploading 2 of 10" (or "Uploading" when there is a single file). */
export function uploadLabel(n: number, total: number, what = 'Uploading'): string {
  return total > 1 ? `${what} ${n} of ${total}` : what;
}
