/**
 * Repeating schedules: which days a weekly / every-2-weeks / monthly repeat
 * lands on. Mirrors extend_schedule_series() in supabase/updates/012 (used
 * directly in demo mode and for the preview on Schedule Work).
 */
import type { RepeatFrequency } from '@/types/schedule';

/** How far ahead a repeat's days are filled in unless the owner picks
 * otherwise. Matches the database default. */
export const SERIES_HORIZON_DAYS = 56;

/** Schedule-ahead choices on Schedule Work. */
export const HORIZON_OPTIONS = [
  { label: '2 Wks', days: 14 },
  { label: '1 Mo', days: 28 },
  { label: '2 Mo', days: 56 },
  { label: '3 Mo', days: 91 },
  { label: '6 Mo', days: 182 },
];

type RepeatRule = { frequency: RepeatFrequency; intervalDays?: number };

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDaysKey(key: string, days: number): string {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return toKey(d);
}

/** Same day of the month `months` later; the 31st becomes the last day of a
 * shorter month (like Postgres date + interval). */
export function addMonthsKey(key: string, months: number): string {
  const d = parseKey(key);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toKey(target);
}

function nthDate(rule: RepeatRule, startDate: string, n: number): string {
  if (rule.frequency === 'weekly') return addDaysKey(startDate, 7 * n);
  if (rule.frequency === 'biweekly') return addDaysKey(startDate, 14 * n);
  if (rule.frequency === 'custom') return addDaysKey(startDate, Math.max(1, rule.intervalDays ?? 7) * n);
  return addMonthsKey(startDate, n);
}

/** Days the repeat lands on from `from` through `to` (inclusive), never past
 * its end date. At most `limit` days. */
export function occurrenceDates(
  s: RepeatRule & { startDate: string; endDate?: string },
  from: string,
  to: string,
  limit = 500,
): string[] {
  const last = s.endDate && s.endDate < to ? s.endDate : to;
  const out: string[] = [];
  for (let n = 0; out.length < limit; n++) {
    const d = nthDate(s, s.startDate, n);
    if (d > last) break;
    if (d >= from) out.push(d);
  }
  return out;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Every 10 days", "Every 3 weeks", "Every week". */
function everyDays(days: number): string {
  if (days % 7 === 0) return days === 7 ? 'Every week' : `Every ${days / 7} weeks`;
  return `Every ${days} days`;
}

/** "Every 2 weeks on Monday", "Every week on Friday", "Monthly on the 12th",
 * "Every 10 days". */
export function describeRepeat(rule: RepeatRule, startDate: string): string {
  const d = parseKey(startDate);
  const weekday = WEEKDAYS[d.getUTCDay()];
  if (rule.frequency === 'weekly') return `Every week on ${weekday}`;
  if (rule.frequency === 'biweekly') return `Every 2 weeks on ${weekday}`;
  if (rule.frequency === 'custom') {
    const days = rule.intervalDays ?? 7;
    return days % 7 === 0 ? `${everyDays(days)} on ${weekday}` : everyDays(days);
  }
  return `Monthly on the ${ordinal(d.getUTCDate())}`;
}

/** Short form for badges: "Weekly", "Every 2 weeks", "Monthly", "Every 10 days". */
export function repeatShortLabel(rule: RepeatRule): string {
  if (rule.frequency === 'custom') return everyDays(rule.intervalDays ?? 7);
  return rule.frequency === 'weekly' ? 'Weekly' : rule.frequency === 'biweekly' ? 'Every 2 weeks' : 'Monthly';
}

/** "2 months", "6 weeks" — how far ahead a repeat is scheduled. */
export function describeHorizon(days: number): string {
  const opt = HORIZON_OPTIONS.find(o => o.days === days);
  if (opt) {
    const [n, unit] = opt.label.split(' ');
    const word = unit === 'Wks' ? 'week' : 'month';
    return `${n} ${word}${n === '1' ? '' : 's'}`;
  }
  return `${Math.round(days / 7)} weeks`;
}
