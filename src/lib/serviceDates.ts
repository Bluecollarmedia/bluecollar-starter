// "N visits this season" for a maintenance service: spreading the visits evenly across the contract, or using exact dates.
// Pure functions on 'YYYY-MM-DD' keys (no time zones, no phone clock).

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function keyOf(dayNum: number): string {
  const d = new Date(dayNum * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export const isDateKey = (v: unknown): v is string => {
  if (typeof v !== 'string' || !KEY_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

export const MAX_VISITS = 365;

/**
 * `count` visit dates spread evenly from `start` to `end`, both included: the first visit is on the start date and the last on the
 * end date, with the rest evenly between (to the nearest day). One visit lands on the start date. Returns [] when it can't be done
 * (bad dates, end before start, or no count), never a guess.
 */
export function spreadDates(start: string | undefined, end: string | undefined, count: number): string[] {
  if (!start || !end || !isDateKey(start) || !isDateKey(end) || !Number.isInteger(count) || count < 1 || count > MAX_VISITS) return [];
  const a = dayNumber(start);
  const b = dayNumber(end);
  if (b < a) return [];
  if (count === 1) return [start];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(keyOf(a + Math.round(((b - a) * i) / (count - 1))));
  // A short season can't hold more visits than it has days: drop repeats rather than book two on one day.
  return out.filter((k, i) => i === 0 || k !== out[i - 1]);
}

/** Valid dates only, no repeats, oldest first. */
export function cleanDates(dates: unknown): string[] {
  const list = Array.isArray(dates) ? dates : [];
  return Array.from(new Set(list.filter(isDateKey))).sort().slice(0, MAX_VISITS);
}

/** A readable list for a label, e.g. "Jul 19, Aug 6, Aug 24 +3 more". */
export function datesSummary(dates: string[], show = 3): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = (k: string) => { const [, m, d] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };
  const head = dates.slice(0, show).map(fmt).join(', ');
  return dates.length > show ? `${head} +${dates.length - show} more` : head;
}
