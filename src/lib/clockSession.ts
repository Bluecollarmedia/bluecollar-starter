// One definition of what state a clock session is in, for EVERY clock in the app (the workday clock for landscaping and maintenance, and the
// Snow clock), so no screen can disagree with another about "am I clocked in?". Pure functions; no database, no screens.
//
//   current  = open, and recent enough that it can be today's work.
//   closed   = has an end time.
//   stale    = open for a very long time: almost certainly a clock-out that was forgotten. It never counts as "clocked in", never gates
//              today's Clock In or route, never feeds today's timer. The database flags it (needs review) and counts it as zero hours
//              until a person decides the real end time; the original clock-in is never changed and no end time is ever invented.
//   review   = the database already flagged it (needs review). Same treatment as stale, plus the worker's answer is shown.
import { getLanguage, tr } from '@/i18n';

export type SessionState = 'current' | 'closed' | 'stale' | 'review';

/** The workday clock's default (the owner's "open workday hours" setting can say otherwise). Storm shifts run through the night, so Snow waits longer. */
export const WORKDAY_STALE_HOURS = 14;
export const SNOW_STALE_HOURS = 20;

export interface SessionLike {
  clockInAt: string;
  clockOutAt?: string;
  /** Set by the database when it flagged this session (workday status "needs_review", or a Snow shift's flagged_at). */
  flagged?: boolean;
}

export function sessionState(s: SessionLike, nowMs: number, staleAfterHours: number = WORKDAY_STALE_HOURS): SessionState {
  if (s.flagged) return 'review';
  if (s.clockOutAt) return 'closed';
  const inMs = Date.parse(s.clockInAt);
  if (!Number.isFinite(inMs)) return 'current';
  return nowMs - inMs >= staleAfterHours * 3_600_000 ? 'stale' : 'current';
}

/** Open and not stale and not flagged: the only kind that means "clocked in right now". */
export const isCurrent = (s: SessionLike, nowMs: number, staleAfterHours?: number) => sessionState(s, nowMs, staleAfterHours) === 'current';
/** Stale or flagged: needs the one "you didn't clock out" card. */
export const needsAnswer = (s: SessionLike, nowMs: number, staleAfterHours?: number) => {
  const st = sessionState(s, nowMs, staleAfterHours);
  return st === 'stale' || st === 'review';
};

const locale = () => (getLanguage() === 'es' ? 'es-US' : 'en-US');
const dayAndTime = (iso: string) => new Date(iso).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The one sentence shown for a forgotten clock-out, the same on every clock. */
export function staleHeadline(clockInAt: string): string {
  return tr("You didn't clock out on {day}", { day: new Date(clockInAt).toLocaleDateString(locale(), { weekday: 'long' }) });
}
export function staleDetail(clockInAt: string): string {
  return tr("You clocked in {when} and never clocked out. It counts as zero hours until your boss sets the real end time. Tell them when you stopped; today's work is not affected.", { when: dayAndTime(clockInAt) });
}

/** What the card says once the worker has answered. */
export function answeredText(claimedOutAt?: string | null, note?: string | null): string {
  const when = claimedOutAt ? tr('You said you stopped {when}.', { when: dayAndTime(claimedOutAt) }) : tr('You said you are not sure when you stopped.');
  return `${when}${note ? ` "${note}"` : ''} ${tr('Your boss will set the real end time.')}`;
}

/** The time choices offered for "I stopped at ...": from the clock-in to now, every 30 minutes, newest last. At most 49 choices. */
export function stopTimeChoices(clockInAt: string, nowMs: number): { iso: string; label: string }[] {
  const start = Date.parse(clockInAt);
  if (!Number.isFinite(start) || nowMs <= start) return [];
  const step = 30 * 60_000;
  const out: { iso: string; label: string }[] = [];
  const first = Math.ceil(start / step) * step;
  for (let t = first; t < nowMs && out.length < 49; t += step) out.push({ iso: new Date(t).toISOString(), label: dayAndTime(new Date(t).toISOString()) });
  return out;
}
