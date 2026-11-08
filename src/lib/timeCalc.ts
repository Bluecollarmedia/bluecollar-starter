// Time tracking: the ONE place the hour, labor and cost definitions live, so every screen and export agrees. Pure functions.
//
// Conventions
//  • Every time is a real timestamp (ISO string). Durations are milliseconds; nothing is rounded until it is shown (hours to 2 places,
//    money to cents), so repeated rounding never drifts the totals.
//  • "Local date" fields (workDate) come from the employee's phone and are plain YYYY-MM-DD strings; they are never re-derived from UTC.
//  • Weeks run Monday to Sunday (like the rest of the app).
//
// Definitions (used on every screen and in every export)
//  • Gross workday time   = clock-out − clock-in (or now − clock-in while the day is open).
//  • Recorded break time  = the union of the day's breaks (overlaps counted once), clipped to the workday.
//  • Deducted break time  = the UNPAID part of the recorded breaks. Paid breaks are never deducted. Nothing is deducted for a break that was not recorded.
//  • Net payable time     = gross − deducted break time.
//  • Property labor       = one employee's own start→end at a visit. Crew labor = the SUM of those intervals (never the visit's elapsed time).
//  • Property elapsed     = earliest interval start → latest interval end of a visit.
//  • Labor cost           = interval hours × the hourly rate saved with that interval (the rate in force when the work happened).
//  • Payable cost         = net payable hours × the workday's saved rate, with the overtime premium on the hours past the weekly threshold.
//  • Voided intervals count for nothing. An approved skip is never work: it has no interval and is not counted as completed.

export interface TimeBreak { id?: string; startedAt: string; endedAt?: string | null; paid: boolean }
export interface TimeWorkday { id: string; personId: string; workDate: string; clockInAt: string; clockOutAt?: string | null; status: string }
export interface TimeInterval { id: string; visitId: string; workdayId: string; personId: string; startedAt: string; endedAt?: string | null; status: string; billable: boolean; hourlyRate?: number | null }
export interface TimeVisitLite { id: string; status: string; billable: boolean; startedAt?: string | null; endedAt?: string | null; targetMinutes?: number | null }

const ms = (iso: string) => new Date(iso).getTime();
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

/** Union of [start,end] spans in ms, overlaps merged (so nothing is counted twice). */
export function mergeSpans(spans: [number, number][]): [number, number][] {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
const spanMs = (spans: [number, number][]) => spans.reduce((t, [a, b]) => t + (b - a), 0);

export function grossMs(w: Pick<TimeWorkday, 'clockInAt' | 'clockOutAt'>, now: number = Date.now()): number {
  const end = w.clockOutAt ? ms(w.clockOutAt) : now;
  return Math.max(0, end - ms(w.clockInAt));
}

function breakSpans(w: Pick<TimeWorkday, 'clockInAt' | 'clockOutAt'>, breaks: TimeBreak[], now: number, only?: (b: TimeBreak) => boolean): [number, number][] {
  const lo = ms(w.clockInAt);
  const hi = w.clockOutAt ? ms(w.clockOutAt) : now;
  return mergeSpans(breaks.filter((b) => !only || only(b)).map((b): [number, number] => [Math.max(lo, ms(b.startedAt)), Math.min(hi, b.endedAt ? ms(b.endedAt) : now)]));
}

export const recordedBreakMs = (w: Pick<TimeWorkday, 'clockInAt' | 'clockOutAt'>, breaks: TimeBreak[], now: number = Date.now()) => spanMs(breakSpans(w, breaks, now));
export const deductedBreakMs = (w: Pick<TimeWorkday, 'clockInAt' | 'clockOutAt'>, breaks: TimeBreak[], now: number = Date.now()) => spanMs(breakSpans(w, breaks, now, (b) => !b.paid));
export const netMs = (w: Pick<TimeWorkday, 'clockInAt' | 'clockOutAt'>, breaks: TimeBreak[], now: number = Date.now()) => Math.max(0, grossMs(w, now) - deductedBreakMs(w, breaks, now));

export const intervalMs = (i: Pick<TimeInterval, 'startedAt' | 'endedAt' | 'status'>, now: number = Date.now()) =>
  i.status === 'void' ? 0 : Math.max(0, (i.endedAt ? ms(i.endedAt) : now) - ms(i.startedAt));

/** Total crew labor: the sum of each employee's own interval. */
export const crewLaborMs = (intervals: Pick<TimeInterval, 'startedAt' | 'endedAt' | 'status'>[], now: number = Date.now()) =>
  intervals.reduce((t, i) => t + intervalMs(i, now), 0);

/** How long the visit itself took: earliest start to latest end (null while someone is still working or nobody started). */
export function visitElapsedMs(intervals: Pick<TimeInterval, 'startedAt' | 'endedAt' | 'status'>[], now: number = Date.now(), allowOpen = false): number | null {
  const live = intervals.filter((i) => i.status !== 'void');
  if (!live.length) return null;
  if (!allowOpen && live.some((i) => !i.endedAt)) return null;
  const start = Math.min(...live.map((i) => ms(i.startedAt)));
  const end = Math.max(...live.map((i) => (i.endedAt ? ms(i.endedAt) : now)));
  return Math.max(0, end - start);
}

export const toHours = (msValue: number) => msValue / HOUR_MS;
export const round2 = (n: number) => Math.round(n * 100) / 100;
/** Hours to 2 places for display and exports ("3.50"). */
export const hoursText = (msValue: number) => round2(toHours(msValue)).toFixed(2);

/** "3h 05m" (or "45m"). */
export function durationText(msValue: number): string {
  const total = Math.max(0, Math.round(msValue / MINUTE_MS));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "1:05:09" for a running timer. */
export function clockText(msValue: number): string {
  const s = Math.max(0, Math.floor(msValue / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ── Money ───────────────────────────────────────────────────────────────────
export const costOf = (msValue: number, rate: number | null | undefined) => (rate == null ? null : Math.round(toHours(msValue) * rate * 100) / 100);

/** Cost of one interval at the rate saved with it. null when no rate was set (never guessed). */
export const intervalCost = (i: TimeInterval, now: number = Date.now()) => costOf(intervalMs(i, now), i.hourlyRate);

// ── Overtime ────────────────────────────────────────────────────────────────
export type AlertLevel = 'under' | 'approaching' | 'reached';

/** The owner's per-employee daily ALERT hours (not the formal overtime rule): where this day stands. */
export function dailyAlertStatus(netMsValue: number, alertHours: number | null | undefined, approachPercent = 90) {
  if (alertHours == null || alertHours <= 0) return { level: 'under' as AlertLevel, overMs: 0 };
  const thr = alertHours * HOUR_MS;
  if (netMsValue >= thr) return { level: 'reached' as AlertLevel, overMs: netMsValue - thr };
  if (netMsValue >= thr * (approachPercent / 100)) return { level: 'approaching' as AlertLevel, overMs: 0 };
  return { level: 'under' as AlertLevel, overMs: 0 };
}

export interface OvertimeTerms { enabled: boolean; weeklyThresholdHours: number; multiplier: number }
export const DEFAULT_TERMS: OvertimeTerms = { enabled: true, weeklyThresholdHours: 40, multiplier: 1.5 };

/** Monday of the week containing a YYYY-MM-DD date. */
export function weekStartKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

export interface DaySummary { workdayId: string; workDate: string; grossMs: number; recordedBreakMs: number; deductedBreakMs: number; netMs: number; status: string; open: boolean }

export function summarizeDay(w: TimeWorkday, breaks: TimeBreak[], now: number = Date.now()): DaySummary {
  return {
    workdayId: w.id, workDate: w.workDate, grossMs: grossMs(w, now), recordedBreakMs: recordedBreakMs(w, breaks, now),
    deductedBreakMs: deductedBreakMs(w, breaks, now), netMs: netMs(w, breaks, now), status: w.status, open: !w.clockOutAt,
  };
}

export interface WeekSummary {
  weekStart: string;
  days: DaySummary[];
  grossMs: number;
  recordedBreakMs: number;
  deductedBreakMs: number;
  netMs: number;
  regularMs: number;
  overtimeMs: number;
  /** How overtime was worked out, shown next to the number so nobody has to guess. */
  basis: string;
  approved: boolean;
}

/**
 * One employee's week. Overtime = net payable time past the configured weekly threshold (when overtime is switched on for them).
 * This is a calculation from the owner's own settings, not a legal payroll determination.
 */
export function summarizeWeek(weekStart: string, days: DaySummary[], terms: OvertimeTerms = DEFAULT_TERMS): WeekSummary {
  const net = days.reduce((t, d) => t + d.netMs, 0);
  const threshold = terms.weeklyThresholdHours * HOUR_MS;
  const overtime = terms.enabled ? Math.max(0, net - threshold) : 0;
  return {
    weekStart,
    days: days.slice().sort((a, b) => a.workDate.localeCompare(b.workDate)),
    grossMs: days.reduce((t, d) => t + d.grossMs, 0),
    recordedBreakMs: days.reduce((t, d) => t + d.recordedBreakMs, 0),
    deductedBreakMs: days.reduce((t, d) => t + d.deductedBreakMs, 0),
    netMs: net,
    regularMs: net - overtime,
    overtimeMs: overtime,
    basis: terms.enabled ? `Overtime = net payable hours over ${terms.weeklyThresholdHours} in the week, at ${terms.multiplier}x` : 'Overtime is off for this employee',
    approved: days.length > 0 && days.every((d) => d.status === 'approved'),
  };
}

/** Payable cost for a week: regular hours at the rate plus overtime hours at rate × multiplier. */
export function weekPayCost(w: Pick<WeekSummary, 'regularMs' | 'overtimeMs'>, rate: number | null | undefined, multiplier = 1.5): number | null {
  if (rate == null) return null;
  return Math.round((toHours(w.regularMs) * rate + toHours(w.overtimeMs) * rate * multiplier) * 100) / 100;
}

export interface PayDay { workDate: string; clockInAt: string; netMs: number; rate: number | null | undefined }

/**
 * The same week cost, but each day is paid at the rate saved with THAT day (so a raise in the middle of a week, or a day recorded before a
 * rate existed, is never priced at some other day's rate). Hours are taken in order; the ones past the weekly threshold are overtime and
 * earn the multiplier on top of the rate of the day they were worked. Returns null when any day with time has no rate (the cost is unknown).
 */
export function weekPayCostByDay(days: PayDay[], terms: OvertimeTerms = DEFAULT_TERMS): number | null {
  const threshold = terms.weeklyThresholdHours * HOUR_MS;
  let cumulative = 0;
  let cost = 0;
  const ordered = days.slice().sort((a, b) => a.workDate.localeCompare(b.workDate) || a.clockInAt.localeCompare(b.clockInAt));
  for (const d of ordered) {
    if (d.netMs <= 0) continue;
    if (d.rate == null) return null;
    const regular = terms.enabled ? Math.max(0, Math.min(d.netMs, threshold - cumulative)) : d.netMs;
    const overtime = d.netMs - regular;
    cost += toHours(regular) * d.rate + toHours(overtime) * d.rate * terms.multiplier;
    cumulative += d.netMs;
  }
  return Math.round(cost * 100) / 100;
}

// ── Timeline ────────────────────────────────────────────────────────────────
export type TimelineKind = 'clock_in' | 'clock_out' | 'visit' | 'break' | 'gap' | 'open';
export interface TimelineEntry { kind: TimelineKind; startedAt: string; endedAt?: string | null; label: string; refId?: string; ms: number }

/**
 * Chronological day: clock-in, each property visit and break, the time between them, and clock-out.
 * Gaps are labelled honestly: the app can't know whether a gap was driving, loading or waiting, so it says "Between visits"
 * (or "Before the first visit" / "After the last visit"), never "travel".
 */
export function buildTimeline(
  w: TimeWorkday, breaks: TimeBreak[], intervals: (TimeInterval & { label?: string })[], now: number = Date.now(),
): TimelineEntry[] {
  const out: TimelineEntry[] = [{ kind: 'clock_in', startedAt: w.clockInAt, label: 'Clocked in', ms: 0 }];
  const items: { s: number; e: number | null; entry: TimelineEntry }[] = [];
  for (const i of intervals) {
    if (i.status === 'void') continue;
    items.push({ s: ms(i.startedAt), e: i.endedAt ? ms(i.endedAt) : null, entry: { kind: i.endedAt ? 'visit' : 'open', startedAt: i.startedAt, endedAt: i.endedAt, label: i.label ?? 'Property visit', refId: i.id, ms: intervalMs(i, now) } });
  }
  for (const b of breaks) {
    items.push({ s: ms(b.startedAt), e: b.endedAt ? ms(b.endedAt) : null, entry: { kind: 'break', startedAt: b.startedAt, endedAt: b.endedAt, label: b.paid ? 'Break (paid)' : 'Break (unpaid)', refId: b.id, ms: Math.max(0, (b.endedAt ? ms(b.endedAt) : now) - ms(b.startedAt)) } });
  }
  items.sort((a, b) => a.s - b.s);
  const end = w.clockOutAt ? ms(w.clockOutAt) : now;
  let cursor = ms(w.clockInAt);
  let seenVisit = false;
  for (const it of items) {
    if (it.s - cursor > 30_000) {
      out.push({ kind: 'gap', startedAt: new Date(cursor).toISOString(), endedAt: new Date(it.s).toISOString(), label: seenVisit ? 'Between visits' : 'Before the first visit', ms: it.s - cursor });
    }
    out.push(it.entry);
    if (it.entry.kind === 'visit' || it.entry.kind === 'open') seenVisit = true;
    cursor = Math.max(cursor, it.e ?? now);
  }
  if (w.clockOutAt && end - cursor > 30_000) {
    out.push({ kind: 'gap', startedAt: new Date(cursor).toISOString(), endedAt: w.clockOutAt, label: seenVisit ? 'After the last visit' : 'Unallocated time', ms: end - cursor });
  }
  if (w.clockOutAt) out.push({ kind: 'clock_out', startedAt: w.clockOutAt, label: 'Clocked out', ms: 0 });
  return out;
}

// ── Problems the owner should look at ───────────────────────────────────────
export interface Problem { kind: 'no_clock_out' | 'never_clocked_out' | 'open_interval_after_close' | 'overlap' | 'visit_outside_day'; message: string; refId?: string }

/** Neutral "needs review" findings for one workday (nothing is changed or hidden). */
export function dayProblems(w: TimeWorkday, intervals: TimeInterval[], now: number = Date.now(), openHours = 14): Problem[] {
  const out: Problem[] = [];
  // Update 90: a day the employee never clocked out of is flagged by the database at zero hours. One clear line, not a pile of side effects.
  if (w.status === 'needs_review') return [{ kind: 'never_clocked_out', message: 'Never clocked out. It counts as zero hours until you set the real end time.', refId: w.id }];
  if (!w.clockOutAt && now - ms(w.clockInAt) > openHours * HOUR_MS) out.push({ kind: 'no_clock_out', message: `Still clocked in after more than ${openHours} hours. Needs review.`, refId: w.id });
  const live = intervals.filter((i) => i.status !== 'void').sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  for (const i of live) {
    if (w.clockOutAt && !i.endedAt) out.push({ kind: 'open_interval_after_close', message: 'A property visit is still running after the clock-out.', refId: i.id });
    if (ms(i.startedAt) < ms(w.clockInAt) || (w.clockOutAt && i.endedAt && ms(i.endedAt) > ms(w.clockOutAt))) out.push({ kind: 'visit_outside_day', message: 'A property visit falls outside the workday.', refId: i.id });
  }
  for (let k = 1; k < live.length; k++) {
    const prevEnd = live[k - 1].endedAt ? ms(live[k - 1].endedAt as string) : now;
    if (ms(live[k].startedAt) < prevEnd) out.push({ kind: 'overlap', message: 'Two property visits overlap for this employee.', refId: live[k].id });
  }
  return out;
}

/** Review state shown to the owner (derived; the database keeps active / closed / approved / reopened). */
export type ReviewState = 'in_progress' | 'needs_correction' | 'needs_end_time' | 'ready' | 'approved' | 'reapproval';
export function reviewState(w: TimeWorkday, problems: Problem[]): ReviewState {
  if (w.status === 'needs_review') return 'needs_end_time';
  if (w.status === 'approved') return 'approved';
  if (w.status === 'reopened') return 'reapproval';
  if (!w.clockOutAt) return problems.length ? 'needs_correction' : 'in_progress';
  return problems.length ? 'needs_correction' : 'ready';
}
export const REVIEW_LABEL: Record<ReviewState, string> = {
  in_progress: 'In progress', needs_correction: 'Needs correction', needs_end_time: 'Never clocked out', ready: 'Ready for review', approved: 'Approved', reapproval: 'Needs approval again',
};

// ── Visit history, averages, targets ────────────────────────────────────────
export interface VisitRecord { visitId: string; status: string; billable: boolean; elapsedMs: number | null; laborMs: number; targetMinutes?: number | null }

/**
 * Average elapsed time of a property's visits. Counts COMPLETED visits only (in-progress, voided and skipped visits are left out;
 * a skip has no time at all). Visits with owner corrections count with their corrected times. Non-billable visits are included
 * unless `billableOnly` is set.
 */
export function visitHistoryStats(records: VisitRecord[], billableOnly = false) {
  const valid = records.filter((r) => r.status === 'completed' && r.elapsedMs != null && (!billableOnly || r.billable));
  const n = valid.length;
  const avgElapsed = n ? valid.reduce((t, r) => t + (r.elapsedMs as number), 0) / n : null;
  const avgLabor = n ? valid.reduce((t, r) => t + r.laborMs, 0) / n : null;
  return { count: n, averageElapsedMs: avgElapsed, averageLaborMs: avgLabor, totalLaborMs: valid.reduce((t, r) => t + r.laborMs, 0) };
}

/** Actual vs target, in the same unit (elapsed visit time vs a target duration). Positive = over. */
export function compareToTarget(actualMs: number, targetMinutes: number | null | undefined) {
  if (!targetMinutes) return null;
  const diff = actualMs - targetMinutes * MINUTE_MS;
  return { targetMs: targetMinutes * MINUTE_MS, actualMs, diffMs: diff, over: diff > 0 };
}

// ── CSV (opens in Excel) ────────────────────────────────────────────────────
export interface CsvColumn<T> { header: string; value: (row: T) => string | number | boolean | null | undefined }

function cell(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  // A cell that starts with = + - @ would run as a formula in Excel: keep it as plain text.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text with a header row, CRLF line ends and a UTF-8 byte-order mark so Excel reads names and numbers correctly. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(','));
  return '\uFEFF' + [head, ...body].join('\r\n') + '\r\n';
}
