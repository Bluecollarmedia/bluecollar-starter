// Owner reports built from the stored time records (src/data/timeTracking.ts LaborSnapshot). Pure functions on top of timeCalc.ts, so the
// screens and the CSV exports always show the same numbers.
import {
  summarizeDay, summarizeWeek, weekStartKey, dayProblems, reviewState, visitElapsedMs, crewLaborMs, intervalMs, costOf, weekPayCostByDay, toCsv, hoursText, round2, toHours,
  DEFAULT_TERMS, HOUR_MS,
  type CsvColumn, type DaySummary, type OvertimeTerms, type Problem, type ReviewState, type WeekSummary, type VisitRecord,
} from './timeCalc';

export interface RWorkday { id: string; personId: string; workDate: string; clockInAt: string; clockOutAt?: string; status: string; hourlyRate?: number | null; truckId?: string; approvedAt?: string; /** Update 90: the employee never clocked out; their answer, if any. */ flaggedAt?: string; claimedOutAt?: string; claimNote?: string; claimedAt?: string }
export interface RBreak { id: string; workdayId: string; startedAt: string; endedAt?: string; paid: boolean }
export interface RInterval { id: string; visitId: string; workdayId: string; personId: string; startedAt: string; endedAt?: string; status: string; billable: boolean; hourlyRate?: number | null }
export interface RVisit { id: string; label?: string; status: string; billable: boolean; visitDate: string; source: string; targetMinutes?: number; maintenancePropertyId?: string; projectId?: string }
export interface RSnapshot { workdays: RWorkday[]; breaks: RBreak[]; visits: RVisit[]; intervals: RInterval[]; names: Record<string, string> }

export interface DayRow {
  workday: RWorkday;
  personName: string;
  summary: DaySummary;
  problems: Problem[];
  state: ReviewState;
  intervals: (RInterval & { label?: string })[];
  breaks: RBreak[];
  /** The property this employee is working at right now (an open interval), if any. */
  currentLabel?: string;
  /** Interval labor on this day (hours at property visits), separate from the workday total. */
  propertyLaborMs: number;
  /** Payable cost of the day's net hours at the day's saved rate, straight time (overtime premium is added in the weekly view). */
  payableCost: number | null;
}

export function dayRows(s: RSnapshot, now: number = Date.now(), openHours = 14): DayRow[] {
  const visitById = new Map(s.visits.map((v) => [v.id, v]));
  return s.workdays.map((w): DayRow => {
    const rawBreaks = s.breaks.filter((b) => b.workdayId === w.id);
    const breaks = rawBreaks.map((b) => ({ id: b.id, startedAt: b.startedAt, endedAt: b.endedAt ?? null, paid: b.paid }));
    const intervals = s.intervals.filter((i) => i.workdayId === w.id).map((i) => ({ ...i, label: visitById.get(i.visitId)?.label }));
    const base = { id: w.id, personId: w.personId, workDate: w.workDate, clockInAt: w.clockInAt, clockOutAt: w.clockOutAt ?? null, status: w.status };
    const summary = summarizeDay(base, breaks, now);
    const problems = dayProblems(base, intervals.map((i) => ({ ...i, endedAt: i.endedAt ?? null })), now, openHours);
    const open = intervals.find((i) => i.status !== 'void' && !i.endedAt);
    return {
      workday: w, personName: s.names[w.personId] ?? 'Unnamed', summary, problems, state: reviewState(base, problems),
      intervals, breaks: rawBreaks, currentLabel: open?.label ?? undefined,
      propertyLaborMs: crewLaborMs(intervals.map((i) => ({ ...i, endedAt: i.endedAt ?? null })), now),
      payableCost: costOf(summary.netMs, w.hourlyRate),
    };
  }).sort((a, b) => a.personName.localeCompare(b.personName) || a.workday.clockInAt.localeCompare(b.workday.clockInAt));
}

export interface WeekRow {
  personId: string; personName: string; week: WeekSummary;
  /** The rate saved with the employee's latest day this week. */
  rate: number | null;
  /** True when the days of the week were saved at different rates (a raise mid-week, or a day recorded before a rate existed). */
  rateChanged: boolean;
  /** Each day priced at the rate saved with that day; null when a day with time has no rate. */
  payCost: number | null;
  propertyLaborMs: number;
}

/** One row per employee for the week starting on `weekStart` (Monday). */
export function weekRows(s: RSnapshot, weekStart: string, termsOf: (personId: string) => OvertimeTerms = () => DEFAULT_TERMS, now: number = Date.now()): WeekRow[] {
  const rows = dayRows({ ...s, workdays: s.workdays.filter((w) => weekStartKey(w.workDate) === weekStart) }, now);
  const byPerson = new Map<string, DayRow[]>();
  for (const r of rows) byPerson.set(r.workday.personId, [...(byPerson.get(r.workday.personId) ?? []), r]);
  return [...byPerson.entries()].map(([personId, list]): WeekRow => {
    const terms = termsOf(personId);
    const week = summarizeWeek(weekStart, list.map((r) => r.summary), terms);
    const rate = list[list.length - 1].workday.hourlyRate ?? null;
    const rateChanged = new Set(list.filter((r) => r.summary.netMs > 0).map((r) => r.workday.hourlyRate ?? null)).size > 1;
    const payCost = weekPayCostByDay(list.map((r) => ({ workDate: r.workday.workDate, clockInAt: r.workday.clockInAt, netMs: r.summary.netMs, rate: r.workday.hourlyRate })), terms);
    return { personId, personName: list[0].personName, week, rate, rateChanged, payCost, propertyLaborMs: list.reduce((t, r) => t + r.propertyLaborMs, 0) };
  }).sort((a, b) => a.personName.localeCompare(b.personName));
}

export interface VisitRow extends VisitRecord {
  visit: RVisit;
  startedAt?: string;
  endedAt?: string;
  employees: { personId: string; name: string; ms: number; cost: number | null }[];
  laborCost: number | null;
  billableCost: number | null;
  nonBillableCost: number | null;
}

/** Visits with elapsed time (the visit itself) and crew labor (the sum of each employee's own time) kept apart. */
export function visitRows(visits: RVisit[], intervals: RInterval[], names: Record<string, string>, now: number = Date.now()): VisitRow[] {
  // A visit whose every time was removed (void) has nothing to show; its history stays in the audit log.
  return visits.filter((v) => v.status !== 'void').map((v): VisitRow => {
    const mine = intervals.filter((i) => i.visitId === v.id && i.status !== 'void').map((i) => ({ ...i, endedAt: i.endedAt ?? null }));
    const perPerson = new Map<string, { ms: number; cost: number }>();
    let unknownCost = false;
    for (const i of mine) {
      const cur = perPerson.get(i.personId) ?? { ms: 0, cost: 0 };
      cur.ms += intervalMs(i, now);
      const c = costOf(intervalMs(i, now), i.hourlyRate);
      if (c == null) unknownCost = true; else cur.cost += c;
      perPerson.set(i.personId, cur);
    }
    const laborMs = crewLaborMs(mine, now);
    const total = [...perPerson.values()].reduce((t, p) => t + p.cost, 0);
    const billableCost = round2(mine.filter((i) => i.billable).reduce((t, i) => t + (costOf(intervalMs(i, now), i.hourlyRate) ?? 0), 0));
    const nonBillableCost = round2(mine.filter((i) => !i.billable).reduce((t, i) => t + (costOf(intervalMs(i, now), i.hourlyRate) ?? 0), 0));
    return {
      visitId: v.id, status: v.status, billable: v.billable, elapsedMs: visitElapsedMs(mine, now), laborMs, targetMinutes: v.targetMinutes ?? null,
      visit: v,
      startedAt: mine.length ? new Date(Math.min(...mine.map((i) => Date.parse(i.startedAt)))).toISOString() : undefined,
      endedAt: mine.length && mine.every((i) => i.endedAt) ? new Date(Math.max(...mine.map((i) => Date.parse(i.endedAt as string)))).toISOString() : undefined,
      employees: [...perPerson.entries()].map(([personId, p]) => ({ personId, name: names[personId] ?? 'Unnamed', ms: p.ms, cost: unknownCost ? null : round2(p.cost) })).sort((a, b) => a.name.localeCompare(b.name)),
      laborCost: unknownCost ? null : round2(total),
      billableCost, nonBillableCost,
    };
  }).sort((a, b) => b.visit.visitDate.localeCompare(a.visit.visitDate));
}

export interface ProjectTotals {
  visits: number;
  laborMs: number;
  billableLaborMs: number;
  nonBillableLaborMs: number;
  cost: number;
  byEmployee: { personId: string; name: string; ms: number; cost: number }[];
  firstDate?: string;
  lastDate?: string;
}

/** A project's labor across every visit (no double counting: each interval belongs to exactly one visit). */
export function projectTotals(rows: VisitRow[], intervals: RInterval[], names: Record<string, string>, now: number = Date.now()): ProjectTotals {
  const ids = new Set(rows.filter((r) => r.visit.status !== 'void').map((r) => r.visit.id));
  const live = intervals.filter((i) => ids.has(i.visitId) && i.status !== 'void');
  const by = new Map<string, { ms: number; cost: number }>();
  let billable = 0, non = 0, cost = 0;
  for (const i of live) {
    const ms = intervalMs(i, now);
    if (i.billable) billable += ms; else non += ms;
    const c = costOf(ms, i.hourlyRate) ?? 0;
    cost += c;
    const cur = by.get(i.personId) ?? { ms: 0, cost: 0 };
    cur.ms += ms; cur.cost += c;
    by.set(i.personId, cur);
  }
  const dates = rows.filter((r) => r.visit.status !== 'void').map((r) => r.visit.visitDate).sort();
  return {
    visits: ids.size, laborMs: billable + non, billableLaborMs: billable, nonBillableLaborMs: non, cost: round2(cost),
    byEmployee: [...by.entries()].map(([personId, p]) => ({ personId, name: names[personId] ?? 'Unnamed', ms: p.ms, cost: round2(p.cost) })).sort((a, b) => b.ms - a.ms),
    firstDate: dates[0], lastDate: dates[dates.length - 1],
  };
}

/** Estimated vs actual labor, in the same unit (labor-hours vs labor-hours). null when there is no estimate. */
export function estimateComparison(actualLaborMs: number, estimateHours: number | null | undefined) {
  if (!estimateHours || estimateHours <= 0) return null;
  const diff = actualLaborMs - estimateHours * HOUR_MS;
  return { estimateHours, actualHours: round2(toHours(actualLaborMs)), diffHours: round2(toHours(diff)), over: diff > 0 };
}

// ── CSV ─────────────────────────────────────────────────────────────────────
const dt = (iso?: string | null) => (iso ? new Date(iso).toISOString() : '');
const money = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2));

export const dailyCsv = (rows: DayRow[]) => toCsv<DayRow>(rows, [
  { header: 'Employee', value: (r) => r.personName },
  { header: 'Work date', value: (r) => r.workday.workDate },
  { header: 'Clock in (UTC)', value: (r) => dt(r.workday.clockInAt) },
  { header: 'Clock out (UTC)', value: (r) => dt(r.workday.clockOutAt) },
  { header: 'Gross workday hours', value: (r) => hoursText(r.summary.grossMs) },
  { header: 'Recorded break hours', value: (r) => hoursText(r.summary.recordedBreakMs) },
  { header: 'Break hours deducted', value: (r) => hoursText(r.summary.deductedBreakMs) },
  { header: 'Net payable hours', value: (r) => hoursText(r.summary.netMs) },
  { header: 'Property labor hours', value: (r) => hoursText(r.propertyLaborMs) },
  { header: 'Hourly rate', value: (r) => money(r.workday.hourlyRate) },
  { header: 'Payable cost (straight time)', value: (r) => money(r.payableCost) },
  { header: 'Status', value: (r) => r.state },
  { header: 'Approved at (UTC)', value: (r) => dt(r.workday.approvedAt) },
  { header: 'Needs review', value: (r) => r.problems.map((p) => p.message).join(' | ') },
]);

export const weeklyCsv = (rows: WeekRow[]) => toCsv<WeekRow>(rows, [
  { header: 'Employee', value: (r) => r.personName },
  { header: 'Week starting (Monday)', value: (r) => r.week.weekStart },
  { header: 'Gross workday hours', value: (r) => hoursText(r.week.grossMs) },
  { header: 'Recorded break hours', value: (r) => hoursText(r.week.recordedBreakMs) },
  { header: 'Break hours deducted', value: (r) => hoursText(r.week.deductedBreakMs) },
  { header: 'Net payable hours', value: (r) => hoursText(r.week.netMs) },
  { header: 'Regular hours', value: (r) => hoursText(r.week.regularMs) },
  { header: 'Overtime hours', value: (r) => hoursText(r.week.overtimeMs) },
  { header: 'Overtime basis', value: (r) => r.week.basis },
  { header: 'Hourly rate (latest day)', value: (r) => money(r.rate) },
  { header: 'Rate changed during the week', value: (r) => r.rateChanged },
  { header: 'Payable cost (each day at its own saved rate)', value: (r) => money(r.payCost) },
  { header: 'Property labor hours', value: (r) => hoursText(r.propertyLaborMs) },
  { header: 'All days approved', value: (r) => r.week.approved },
]);

export const visitsCsv = (rows: VisitRow[]) => toCsv<VisitRow>(rows, [
  { header: 'Property or project', value: (r) => r.visit.label },
  { header: 'Visit date', value: (r) => r.visit.visitDate },
  { header: 'Status', value: (r) => r.status },
  { header: 'Billable', value: (r) => r.billable },
  { header: 'Started (UTC)', value: (r) => dt(r.startedAt) },
  { header: 'Ended (UTC)', value: (r) => dt(r.endedAt) },
  { header: 'Elapsed visit hours', value: (r) => (r.elapsedMs == null ? '' : hoursText(r.elapsedMs)) },
  { header: 'Crew labor hours', value: (r) => hoursText(r.laborMs) },
  { header: 'Target minutes', value: (r) => r.targetMinutes ?? '' },
  { header: 'Employees', value: (r) => r.employees.map((e) => `${e.name} ${hoursText(e.ms)}h`).join('; ') },
  { header: 'Labor cost', value: (r) => money(r.laborCost) },
  { header: 'Billable labor cost', value: (r) => money(r.billableCost) },
  { header: 'Non-billable labor cost', value: (r) => money(r.nonBillableCost) },
]);

export interface AuditCsvRow { createdAt: string; entity: string; action: string; field?: string; oldValue?: unknown; newValue?: unknown; reason?: string; actor?: string; person?: string; wasApproved: boolean }
export const auditCsv = (rows: AuditCsvRow[]) => toCsv<AuditCsvRow>(rows, ([
  { header: 'When (UTC)', value: (r) => dt(r.createdAt) },
  { header: 'Employee', value: (r) => r.person },
  { header: 'What', value: (r) => `${r.entity}: ${r.action}` },
  { header: 'Field', value: (r) => r.field },
  { header: 'Old value', value: (r) => (r.oldValue == null ? '' : JSON.stringify(r.oldValue)) },
  { header: 'New value', value: (r) => (r.newValue == null ? '' : JSON.stringify(r.newValue)) },
  { header: 'Reason', value: (r) => r.reason },
  { header: 'Changed by', value: (r) => r.actor },
  { header: 'Day was approved', value: (r) => r.wasApproved },
] as CsvColumn<AuditCsvRow>[]));
