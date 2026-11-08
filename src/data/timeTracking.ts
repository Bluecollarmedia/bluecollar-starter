/**
 * Workday and property-visit time tracking (supabase/updates/063 and 064).
 *
 * Workers use the time_* functions (the database checks who they are, route order, photos, one-open-property and so on).
 * Owners read the time tables and make corrections through the time_staff_* functions. Nothing here saves a time locally:
 * an action is shown as done only after the database confirms it. There is no offline queue.
 */
import { tr } from '@/i18n';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uuid } from '@/lib/ids';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; notInstalled?: boolean; offline?: boolean };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });

const NOT_INSTALLED = /could not find the function|schema cache|does not exist|relation .* does not exist/i;
const OFFLINE = /network request failed|failed to fetch|fetch failed|networkerror|load failed|timeout|internet/i;

/** Plain words for whatever went wrong; the database's own sentences (route order, photos, ...) pass straight through. */
export type Failure = { ok: false; error: string; notInstalled?: boolean; offline?: boolean };
export function explainError(e: { message?: string } | null | undefined, fallback: string): Failure {
  const m = e?.message?.trim() ?? '';
  if (OFFLINE.test(m)) return { ok: false, offline: true, error: tr('No connection. This was not saved. Try again when you are back online.') };
  if (NOT_INSTALLED.test(m)) return { ok: false, notInstalled: true, error: tr('Time tracking is not switched on yet (the database update has not been installed).') };
  if (!m || /^(permission denied|new row violates|JWT)/i.test(m)) return { ok: false, error: tr(fallback) };
  return { ok: false, error: m };
}

// ── What a worker's phone gets ──────────────────────────────────────────────

export interface MyBreak { id: string; startedAt: string; endedAt?: string; paid: boolean }
export interface MyWorkday {
  id: string;
  workDate: string;
  clockInAt: string;
  clockOutAt?: string;
  status: 'active' | 'closed' | 'approved' | 'reopened' | 'needs_review';
  /** Set when the database flagged this day (never clocked out): it counts as zero hours until the owner sets the real end time. */
  flaggedAt?: string;
  /** What the worker said when they really stopped (saved only; the owner decides). Empty = not answered, or "not sure". */
  claimedOutAt?: string;
  claimNote?: string;
  /** When the worker answered (a time, or "not sure"). Empty = not answered yet. */
  claimedAt?: string;
  truck?: { id: string; name: string; source: 'owner' | 'worker' };
  breaks: MyBreak[];
}
export interface MyCurrentVisit {
  intervalId: string;
  visitId: string;
  workdayId: string;
  startedAt: string;
  source: 'maintenance_stop' | 'project_day';
  stopId?: string;
  projectId?: string;
  label?: string;
}
export interface MyDay {
  /** The server's clock when this answered: timers run from server time so a wrong phone clock can't skew them. */
  serverNow: string;
  /** serverNow − this phone's clock, in ms. Add it to Date.now() to get server time. */
  clockOffsetMs: number;
  workDate: string;
  /** False when the worker has no route or job today: the phone shows "No work scheduled today" instead of Clock In. (The database refuses it either way.) */
  canClockIn: boolean;
  settings: { breaksEnabled: boolean; requireStartPhoto: boolean; requireCompletePhoto: boolean; /** Open this long = stale (the owner's "open workday hours"). */ staleAfterHours: number };
  /** Today's workdays (usually one), any still open, and any flagged "needs review". */
  days: MyWorkday[];
  current?: MyCurrentVisit;
  alreadyActive?: boolean;
  alreadyClosed?: boolean;
}

// What the rest of the app needs to know without a screen: is time tracking installed, what is this worker doing right now, and
// "something changed" so open screens refresh.
let installedFlag: boolean | null = null;
let lastDay: MyDay | null = null;
const changeListeners = new Set<() => void>();
export const isTimeTrackingOn = () => installedFlag === true;
export const lastMyDay = () => lastDay;
export function onTimeChanged(cb: () => void) { changeListeners.add(cb); return () => { changeListeners.delete(cb); }; }
export function emitTimeChanged() { for (const cb of changeListeners) cb(); }

type Raw = Record<string, any>;
function parseDay(r: Raw): MyDay {
  const now = Date.parse(r.server_now);
  return {
    serverNow: r.server_now,
    clockOffsetMs: Number.isFinite(now) ? now - Date.now() : 0,
    workDate: r.work_date,
    // An older database (before update 67) doesn't say; keep the old behaviour then.
    canClockIn: r.can_clock_in !== false,
    settings: {
      breaksEnabled: !!r.settings?.breaks_enabled,
      requireStartPhoto: !!r.settings?.require_start_photo,
      requireCompletePhoto: !!r.settings?.require_complete_photo,
      staleAfterHours: Number(r.settings?.stale_after_hours) > 0 ? Number(r.settings.stale_after_hours) : 14,
    },
    days: ((r.days ?? []) as Raw[]).map((d) => ({
      id: d.id, workDate: d.work_date, clockInAt: d.clock_in_at, clockOutAt: d.clock_out_at ?? undefined, status: d.status,
      flaggedAt: d.flagged_at ?? undefined, claimedOutAt: d.claimed_out_at ?? undefined, claimNote: d.claim_note ?? undefined, claimedAt: d.claimed_at ?? undefined,
      truck: d.truck ? { id: d.truck.id, name: d.truck.name ?? 'Truck', source: d.truck.source } : undefined,
      breaks: ((d.breaks ?? []) as Raw[]).map((b) => ({ id: b.id, startedAt: b.started_at, endedAt: b.ended_at ?? undefined, paid: !!b.paid })),
    })),
    current: r.current ? {
      intervalId: r.current.interval_id, visitId: r.current.visit_id, workdayId: r.current.workday_id, startedAt: r.current.started_at,
      source: r.current.source, stopId: r.current.stop_id ?? undefined, projectId: r.current.project_id ?? undefined, label: r.current.label ?? undefined,
    } : undefined,
    alreadyActive: !!r.already_active,
    alreadyClosed: !!r.already_closed,
  };
}

/** Calls one of the worker functions that answer with the worker's day. `announce` tells open screens to refresh (actions do; plain reads don't). */
export async function timeRpc(fn: string, args: Record<string, unknown>, fallback: string, announce = true): Promise<Result<MyDay>> {
  if (!isSupabaseConfigured) return { ok: false, error: tr('Time tracking needs the live database.'), notInstalled: true };
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      const e = explainError(error, fallback);
      if (e.notInstalled) installedFlag = false;
      return e;
    }
    const day = parseDay(data as Raw);
    installedFlag = true;
    lastDay = day;
    if (announce) emitTimeChanged();
    return ok(day);
  } catch (e) {
    return explainError(e as Error, fallback);
  }
}
const callDay = timeRpc;

export const loadMyDay = (date: string) => timeRpc('time_my_day', { p_date: date }, "Couldn't load your workday.", false);
export const clockIn = (date: string, truckId?: string, requestId: string = uuid()) =>
  callDay('time_clock_in', { p_work_date: date, p_truck_id: truckId ?? null, p_request_id: requestId }, "Couldn't clock you in.");
export const clockOut = (requestId: string = uuid()) => callDay('time_clock_out', { p_request_id: requestId }, "Couldn't clock you out.");
/** The worker says when they really stopped a day they never clocked out of (null = not sure). Saved for the owner; no hours change. */
export const claimStaleEnd = (workdayId: string, stoppedAtIso: string | null, note?: string) =>
  callDay('time_claim_stale_end', { p_workday: workdayId, p_stopped_at: stoppedAtIso, p_note: note ?? null }, "Couldn't save your answer.");
export const startBreak = () => callDay('time_break_start', {}, "Couldn't start the break.");
export const endBreak = () => callDay('time_break_end', {}, "Couldn't end the break.");

export interface Gps { lat?: number; lng?: number; accuracy?: number; state?: string; /** The phone's full reading, saved with the older check-in record. */ raw?: Record<string, unknown> | null }
export const startVisit = (source: 'maintenance_stop' | 'assignment', refId: string, gps: Gps = {}) =>
  callDay('time_start_visit', { p_source: source, p_ref: refId, p_lat: gps.lat ?? null, p_lng: gps.lng ?? null, p_accuracy: gps.accuracy ?? null, p_location_state: gps.state ?? 'ok', p_gps: gps.raw ?? (gps.lat != null ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null) }, "Couldn't start this property.");
export const completeVisit = (visitId: string, note?: string, gps: Gps = {}) =>
  callDay('time_complete_visit', { p_visit_id: visitId, p_note: note ?? null, p_lat: gps.lat ?? null, p_lng: gps.lng ?? null, p_accuracy: gps.accuracy ?? null, p_location_state: gps.state ?? 'ok', p_gps: gps.raw ?? (gps.lat != null ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null) }, "Couldn't complete this property.");

export interface TruckChoice { id: string; name: string; inUse: boolean }
export interface TruckOptions { assignedTruckId?: string; assignedTruckName?: string; trucks: TruckChoice[] }
export async function loadTruckOptions(date: string): Promise<Result<TruckOptions>> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.', notInstalled: true };
  const { data, error } = await supabase.rpc('time_trucks_for_clock_in', { p_date: date });
  if (error) return explainError(error, "Couldn't load the trucks.");
  const r = data as Raw;
  return ok({ assignedTruckId: r.assigned_truck_id ?? undefined, assignedTruckName: r.assigned_truck_name ?? undefined, trucks: ((r.trucks ?? []) as Raw[]).map((t) => ({ id: t.id, name: t.name, inUse: !!t.in_use })) });
}

export interface MySkipRequest { id: string; source: string; refId: string; status: 'pending' | 'approved' | 'denied' | 'withdrawn'; reason: string; createdAt: string; decisionNote?: string }
export async function loadMySkipRequests(): Promise<Result<MySkipRequest[]>> {
  if (!isSupabaseConfigured) return ok([]);
  const { data, error } = await supabase.rpc('time_my_skip_requests');
  if (error) return explainError(error, "Couldn't load your skip requests.");
  return ok(((data ?? []) as Raw[]).map((r) => ({ id: r.id, source: r.source, refId: r.ref_id, status: r.status, reason: r.reason, createdAt: r.created_at, decisionNote: r.decision_note ?? undefined })));
}
export async function requestSkip(source: 'maintenance_stop' | 'assignment', refId: string, reason: string): Promise<Result> {
  const { error } = await supabase.rpc('time_request_skip', { p_source: source, p_ref: refId, p_reason: reason });
  return error ? explainError(error, "Couldn't send the skip request.") : ok(undefined);
}
export async function withdrawSkip(id: string): Promise<Result> {
  const { error } = await supabase.rpc('time_withdraw_skip', { p_request_id: id });
  return error ? explainError(error, "Couldn't withdraw the request.") : ok(undefined);
}

export interface CrewClockOut { closed: string[]; stillWorking: { name: string; why: string }[] }
/** The crew leader (or the owner) clocks out everyone on the route after the last stop. Anyone on a property timer or a break is left alone and reported. */
export async function clockOutCrew(routeId: string): Promise<Result<CrewClockOut>> {
  const { data, error } = await supabase.rpc('maintenance_clock_out_crew', { p_route: routeId });
  if (error) {
    const failed = explainError(error, "Couldn't clock the crew out.");
    return failed.notInstalled ? { ...failed, error: "Clocking the whole crew out isn't switched on yet." } : failed;
  }
  emitTimeChanged();
  const d = (data ?? {}) as { closed?: Raw[]; still_working?: Raw[] };
  return ok({
    closed: (d.closed ?? []).map((x) => String(x.first_name)),
    stillWorking: (d.still_working ?? []).map((x) => ({ name: String(x.first_name), why: String(x.why) })),
  });
}

// ── Owner: reading ──────────────────────────────────────────────────────────

export interface LaborWorkday {
  id: string; personId: string; workDate: string; clockInAt: string; clockOutAt?: string; status: 'active' | 'closed' | 'approved' | 'reopened' | 'needs_review';
  truckId?: string; truckSource?: string; approvedBy?: string; approvedAt?: string; approvalVersion: number; hourlyRate?: number | null;
  /** Update 90: a day never clocked out of is flagged (zero hours); the worker's answer, if any, is here. */
  flaggedAt?: string; claimedOutAt?: string; claimNote?: string; claimedAt?: string;
}
export interface LaborBreak { id: string; workdayId: string; personId: string; startedAt: string; endedAt?: string; paid: boolean }
export interface LaborVisit {
  id: string; source: 'maintenance_stop' | 'project_day'; maintenanceStopId?: string; maintenancePropertyId?: string; routeId?: string; projectId?: string;
  visitDate: string; label?: string; status: 'in_progress' | 'completed' | 'void'; startedAt?: string; endedAt?: string; billable: boolean; targetMinutes?: number;
}
export interface LaborInterval {
  id: string; visitId: string; workdayId: string; personId: string; startedAt: string; endedAt?: string; status: 'active' | 'completed' | 'void'; billable: boolean; hourlyRate?: number | null;
}
export interface LaborAudit {
  id: string; entity: string; entityId?: string; personId?: string; workdayId?: string; visitId?: string; action: string; field?: string;
  oldValue?: unknown; newValue?: unknown; reason?: string; actorId?: string; wasApproved: boolean; createdAt: string;
}
export interface LaborAlert {
  id: string; kind: string; personId?: string; workdayId?: string; visitId?: string; skipRequestId?: string; title: string; detail: string; status: 'open' | 'resolved'; createdAt: string;
}
export interface LaborSkip {
  id: string; source: string; maintenanceStopId?: string; assignmentId?: string; requestedBy: string; reason: string; status: string; decidedBy?: string; decidedAt?: string; decisionNote?: string; createdAt: string;
}
export interface LaborSnapshot {
  workdays: LaborWorkday[]; breaks: LaborBreak[]; visits: LaborVisit[]; intervals: LaborInterval[]; skips: LaborSkip[];
  /** Workdays that started BEFORE the range and are still open (someone forgot to clock out). Never part of the range's totals. */
  staleOpen: LaborWorkday[];
  names: Record<string, string>;
}

/** Reads every page of a query (the API returns at most 1000 rows at a time). */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ rows: T[]; error?: { message: string } }> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return { rows };
  }
}

const chunks = <T,>(list: T[], n = 150) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** Everything for a date range (and optionally one employee), for the owner's reports. Owner/admin only: the database returns nothing to anyone else. */
export async function loadLabor(fromDate: string, toDate: string, personId?: string): Promise<Result<LaborSnapshot>> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.', notInstalled: true };
  try {
    const wd = await readAll<Raw>((a, b) => {
      let q = supabase.from('time_workdays').select('*, time_workday_rates(hourly_rate)').gte('work_date', fromDate).lte('work_date', toDate).order('clock_in_at');
      if (personId) q = q.eq('person_id', personId);
      return q.range(a, b);
    });
    if (wd.error) return explainError(wd.error, "Couldn't load the workdays.");
    // Still clocked in from an earlier day: shown as a warning, but kept out of the range's totals (they belong to the day they started).
    let staleQ = supabase.from('time_workdays').select('*, time_workday_rates(hourly_rate)').is('clock_out_at', null).lt('work_date', fromDate).order('clock_in_at').limit(200);
    if (personId) staleQ = staleQ.eq('person_id', personId);
    const stale = await staleQ;
    if (stale.error) return explainError(stale.error, "Couldn't load the open workdays.");
    const wdIds = wd.rows.map((w) => w.id as string);
    const breaks: Raw[] = [];
    const intervals: Raw[] = [];
    for (const part of chunks(wdIds)) {
      const bk = await supabase.from('time_breaks').select('*').in('workday_id', part);
      if (bk.error) return explainError(bk.error, "Couldn't load the breaks.");
      breaks.push(...(bk.data ?? []));
      const iv = await readAll<Raw>((a, b) => supabase.from('time_intervals').select('*, time_interval_rates(hourly_rate)').in('workday_id', part).range(a, b));
      if (iv.error) return explainError(iv.error, "Couldn't load the property times.");
      intervals.push(...iv.rows);
    }
    const visitIds = [...new Set(intervals.map((i) => i.visit_id as string))];
    const visits: Raw[] = [];
    for (const part of chunks(visitIds)) {
      const v = await supabase.from('time_visits').select('*').in('id', part);
      if (v.error) return explainError(v.error, "Couldn't load the visits.");
      visits.push(...(v.data ?? []));
    }
    // Visits in the range that nobody has an interval on yet (a visit date in range counts too).
    const extra = await supabase.from('time_visits').select('*').gte('visit_date', fromDate).lte('visit_date', toDate).limit(2000);
    for (const v of extra.data ?? []) if (!visitIds.includes(v.id)) visits.push(v);
    const skips = await supabase.from('time_skip_requests').select('*').gte('created_at', `${fromDate}T00:00:00`).order('created_at', { ascending: false }).limit(500);

    const people = [...new Set([...wd.rows.map((w) => w.person_id as string), ...(stale.data ?? []).map((w: Raw) => w.person_id as string), ...(skips.data ?? []).map((s: Raw) => s.requested_by as string)])];
    const names: Record<string, string> = {};
    for (const part of chunks(people)) {
      const p = await supabase.from('people').select('id, first_name, last_name').in('id', part);
      for (const r of p.data ?? []) names[r.id] = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Unnamed';
    }
    return ok({
      workdays: wd.rows.map(toWorkday),
      staleOpen: (stale.data ?? []).map(toWorkday),
      breaks: breaks.map((b): LaborBreak => ({ id: b.id, workdayId: b.workday_id, personId: b.person_id, startedAt: b.started_at, endedAt: b.ended_at ?? undefined, paid: !!b.paid })),
      visits: visits.map(toVisit),
      intervals: intervals.map((i): LaborInterval => ({
        id: i.id, visitId: i.visit_id, workdayId: i.workday_id, personId: i.person_id, startedAt: i.started_at, endedAt: i.ended_at ?? undefined, status: i.status, billable: !!i.billable, hourlyRate: rateOf(i.time_interval_rates),
      })),
      skips: (skips.data ?? []).map((s: Raw): LaborSkip => ({
        id: s.id, source: s.source, maintenanceStopId: s.maintenance_stop_id ?? undefined, assignmentId: s.assignment_id ?? undefined, requestedBy: s.requested_by, reason: s.reason,
        status: s.status, decidedBy: s.decided_by ?? undefined, decidedAt: s.decided_at ?? undefined, decisionNote: s.decision_note ?? undefined, createdAt: s.created_at,
      })),
      names,
    });
  } catch (e) {
    return explainError(e as Error, "Couldn't load the hours.");
  }
}

function toWorkday(w: Raw): LaborWorkday {
  return {
    id: w.id, personId: w.person_id, workDate: w.work_date, clockInAt: w.clock_in_at, clockOutAt: w.clock_out_at ?? undefined, status: w.status,
    truckId: w.truck_id ?? undefined, truckSource: w.truck_source ?? undefined, approvedBy: w.approved_by ?? undefined, approvedAt: w.approved_at ?? undefined,
    approvalVersion: w.approval_version ?? 0, hourlyRate: rateOf(w.time_workday_rates),
    flaggedAt: w.flagged_at ?? undefined, claimedOutAt: w.claimed_out_at ?? undefined, claimNote: w.claim_note ?? undefined, claimedAt: w.claimed_at ?? undefined,
  };
}
function rateOf(v: unknown): number | null {
  const row = Array.isArray(v) ? v[0] : v;
  const n = row && typeof row === 'object' ? (row as Raw).hourly_rate : null;
  return n == null ? null : Number(n);
}
function toVisit(v: Raw): LaborVisit {
  return {
    id: v.id, source: v.source, maintenanceStopId: v.maintenance_stop_id ?? undefined, maintenancePropertyId: v.maintenance_property_id ?? undefined, routeId: v.route_id ?? undefined,
    projectId: v.project_id ?? undefined, visitDate: v.visit_date, label: v.label ?? undefined, status: v.status, startedAt: v.started_at ?? undefined, endedAt: v.ended_at ?? undefined,
    billable: !!v.billable, targetMinutes: v.target_minutes ?? undefined,
  };
}

/** Visits (with their intervals) for one maintenance property or project, across any dates: the history behind "Chase Bank, 20 visits". */
export async function loadVisitHistory(kind: 'maintenance_property' | 'project', id: string, fromDate?: string, toDate?: string): Promise<Result<{ visits: LaborVisit[]; intervals: LaborInterval[]; names: Record<string, string> }>> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.', notInstalled: true };
  let q = supabase.from('time_visits').select('*').eq(kind === 'project' ? 'project_id' : 'maintenance_property_id', id).order('visit_date', { ascending: false }).limit(500);
  if (fromDate) q = q.gte('visit_date', fromDate);
  if (toDate) q = q.lte('visit_date', toDate);
  const v = await q;
  if (v.error) return explainError(v.error, "Couldn't load the visit history.");
  const visits = (v.data ?? []).map(toVisit);
  const intervals: LaborInterval[] = [];
  for (const part of chunks(visits.map((x) => x.id))) {
    const iv = await readAll<Raw>((a, b) => supabase.from('time_intervals').select('*, time_interval_rates(hourly_rate)').in('visit_id', part).range(a, b));
    if (iv.error) return explainError(iv.error, "Couldn't load the property times.");
    intervals.push(...iv.rows.map((i): LaborInterval => ({ id: i.id, visitId: i.visit_id, workdayId: i.workday_id, personId: i.person_id, startedAt: i.started_at, endedAt: i.ended_at ?? undefined, status: i.status, billable: !!i.billable, hourlyRate: rateOf(i.time_interval_rates) })));
  }
  const names: Record<string, string> = {};
  for (const part of chunks([...new Set(intervals.map((i) => i.personId))])) {
    const p = await supabase.from('people').select('id, first_name, last_name').in('id', part);
    for (const r of p.data ?? []) names[r.id] = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Unnamed';
  }
  return ok({ visits, intervals, names });
}

export async function loadAudit(filter: { workdayId?: string; visitId?: string; limit?: number }): Promise<Result<LaborAudit[]>> {
  let q = supabase.from('time_audit').select('*').order('created_at', { ascending: false }).limit(filter.limit ?? 200);
  if (filter.workdayId) q = q.eq('workday_id', filter.workdayId);
  if (filter.visitId) q = q.eq('visit_id', filter.visitId);
  const { data, error } = await q;
  if (error) return explainError(error, "Couldn't load the history.");
  return ok((data ?? []).map((a: Raw): LaborAudit => ({
    id: a.id, entity: a.entity, entityId: a.entity_id ?? undefined, personId: a.person_id ?? undefined, workdayId: a.workday_id ?? undefined, visitId: a.visit_id ?? undefined,
    action: a.action, field: a.field ?? undefined, oldValue: a.old_value ?? undefined, newValue: a.new_value ?? undefined, reason: a.reason ?? undefined, actorId: a.actor_id ?? undefined,
    wasApproved: !!a.was_approved, createdAt: a.created_at,
  })));
}

/** Looks for new alerts (the database saves each one once), then lists the open ones. */
export async function loadAlerts(): Promise<Result<LaborAlert[]>> {
  if (!isSupabaseConfigured) return ok([]);
  const scan = await supabase.rpc('time_scan_alerts');
  if (scan.error && NOT_INSTALLED.test(scan.error.message)) return explainError(scan.error, '');
  const { data, error } = await supabase.from('time_alerts').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  if (error) return explainError(error, "Couldn't load the alerts.");
  return ok((data ?? []).map((a: Raw): LaborAlert => ({
    id: a.id, kind: a.kind, personId: a.person_id ?? undefined, workdayId: a.workday_id ?? undefined, visitId: a.visit_id ?? undefined, skipRequestId: a.skip_request_id ?? undefined,
    title: a.title, detail: a.detail, status: a.status, createdAt: a.created_at,
  })));
}

// ── Owner: settings, targets, alert hours ───────────────────────────────────

export interface TimeSettings {
  breaksEnabled: boolean; breaksPaid: boolean; requireStartPhoto: boolean; requireCompletePhoto: boolean;
  targetAlertsEnabled: boolean; targetNotifyCrew: boolean; overtimeAlertsEnabled: boolean; approachPercent: number; longVisitHours: number; openWorkdayHours: number;
}
export const DEFAULT_TIME_SETTINGS: TimeSettings = {
  breaksEnabled: false, breaksPaid: true, requireStartPhoto: false, requireCompletePhoto: false, targetAlertsEnabled: false, targetNotifyCrew: false,
  overtimeAlertsEnabled: false, approachPercent: 90, longVisitHours: 6, openWorkdayHours: 14,
};

export async function loadTimeSettings(companyId: string): Promise<Result<TimeSettings>> {
  const { data, error } = await supabase.from('time_settings').select('*').eq('company_id', companyId).maybeSingle();
  if (error) return explainError(error, "Couldn't load the time settings.");
  if (!data) return ok(DEFAULT_TIME_SETTINGS);
  return ok({
    breaksEnabled: !!data.breaks_enabled, breaksPaid: !!data.breaks_paid, requireStartPhoto: !!data.require_start_photo, requireCompletePhoto: !!data.require_complete_photo,
    targetAlertsEnabled: !!data.target_alerts_enabled, targetNotifyCrew: !!data.target_notify_crew, overtimeAlertsEnabled: !!data.overtime_alerts_enabled,
    approachPercent: data.approach_percent, longVisitHours: Number(data.long_visit_hours), openWorkdayHours: Number(data.open_workday_hours),
  });
}

export async function saveTimeSettings(companyId: string, s: TimeSettings, byPersonId?: string): Promise<Result> {
  const { error } = await supabase.from('time_settings').upsert({
    company_id: companyId, breaks_enabled: s.breaksEnabled, breaks_paid: s.breaksPaid, require_start_photo: s.requireStartPhoto, require_complete_photo: s.requireCompletePhoto,
    target_alerts_enabled: s.targetAlertsEnabled, target_notify_crew: s.targetNotifyCrew, overtime_alerts_enabled: s.overtimeAlertsEnabled, approach_percent: s.approachPercent,
    long_visit_hours: s.longVisitHours, open_workday_hours: s.openWorkdayHours, updated_by: byPersonId ?? null, updated_at: new Date().toISOString(),
  });
  return error ? explainError(error, "Couldn't save the time settings.") : ok(undefined);
}

export interface PropertyTarget { id: string; maintenancePropertyId?: string; projectId?: string; targetMinutes: number }
export async function loadTargets(): Promise<Result<PropertyTarget[]>> {
  const { data, error } = await supabase.from('time_property_targets').select('*');
  if (error) return explainError(error, "Couldn't load the targets.");
  return ok((data ?? []).map((t: Raw) => ({ id: t.id, maintenancePropertyId: t.maintenance_property_id ?? undefined, projectId: t.project_id ?? undefined, targetMinutes: t.target_minutes })));
}
/** minutes = null removes the target. */
export async function saveTarget(companyId: string, kind: 'maintenance_property' | 'project', refId: string, minutes: number | null, byPersonId?: string): Promise<Result> {
  const col = kind === 'project' ? 'project_id' : 'maintenance_property_id';
  if (minutes == null) {
    const { error } = await supabase.from('time_property_targets').delete().eq(col, refId);
    return error ? explainError(error, "Couldn't remove the target.") : ok(undefined);
  }
  if (!(minutes >= 5 && minutes <= 1440)) return { ok: false, error: 'A target has to be between 5 minutes and 24 hours.' };
  const { error } = await supabase.from('time_property_targets').upsert({ company_id: companyId, [col]: refId, target_minutes: Math.round(minutes), updated_by: byPersonId ?? null, updated_at: new Date().toISOString() }, { onConflict: col });
  return error ? explainError(error, "Couldn't save the target.") : ok(undefined);
}

export async function loadAlertHours(): Promise<Result<Record<string, number>>> {
  const { data, error } = await supabase.from('time_person_settings').select('person_id, daily_alert_hours');
  if (error) return explainError(error, "Couldn't load the alert hours.");
  const out: Record<string, number> = {};
  for (const r of data ?? []) if (r.daily_alert_hours != null) out[r.person_id] = Number(r.daily_alert_hours);
  return ok(out);
}
export async function saveAlertHours(companyId: string, personId: string, hours: number | null): Promise<Result> {
  if (hours != null && !(hours > 0 && hours <= 24)) return { ok: false, error: 'Enter hours between 0 and 24.' };
  // Its own table: saving this must never create an overtime-terms row in worker_pay_settings (that would change the Payroll Estimate).
  const { error } = await supabase.from('time_person_settings').upsert({ person_id: personId, company_id: companyId, daily_alert_hours: hours, updated_at: new Date().toISOString() }, { onConflict: 'person_id' });
  return error ? explainError(error, "Couldn't save the alert hours.") : ok(undefined);
}

// ── Owner: corrections and approval (each needs a reason where it changes a time) ──

async function rpcDone(fn: string, args: Record<string, unknown>, fallback: string): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.', notInstalled: true };
  try {
    const { error } = await supabase.rpc(fn, args);
    return error ? explainError(error, fallback) : ok(undefined);
  } catch (e) {
    return explainError(e as Error, fallback);
  }
}
const iso = (d?: Date | string | null) => (d == null ? null : typeof d === 'string' ? d : d.toISOString());

export const editWorkday = (id: string, clockIn: Date | string | null, clockOut: Date | string | null, reason: string) =>
  rpcDone('time_staff_edit_workday', { p_workday: id, p_clock_in: iso(clockIn), p_clock_out: iso(clockOut), p_reason: reason }, "Couldn't correct the workday.");
export const addWorkday = (personId: string, workDate: string, clockIn: Date | string, clockOut: Date | string | null, reason: string, truckId?: string) =>
  rpcDone('time_staff_add_workday', { p_person: personId, p_work_date: workDate, p_clock_in: iso(clockIn), p_clock_out: iso(clockOut), p_reason: reason, p_truck: truckId ?? null }, "Couldn't add the workday.");
export const editInterval = (id: string, started: Date | string | null, ended: Date | string | null, reason: string) =>
  rpcDone('time_staff_edit_interval', { p_interval: id, p_started: iso(started), p_ended: iso(ended), p_reason: reason }, "Couldn't correct the property time.");
export const addInterval = (visitId: string, personId: string, started: Date | string, ended: Date | string | null, reason: string) =>
  rpcDone('time_staff_add_interval', { p_visit: visitId, p_person: personId, p_started: iso(started), p_ended: iso(ended), p_reason: reason }, "Couldn't add the property time.");
export const voidInterval = (id: string, reason: string) => rpcDone('time_staff_void_interval', { p_interval: id, p_reason: reason }, "Couldn't remove that time.");
export const editBreak = (id: string, started: Date | string | null, ended: Date | string | null, reason: string) =>
  rpcDone('time_staff_edit_break', { p_break: id, p_started: iso(started), p_ended: iso(ended), p_reason: reason }, "Couldn't correct the break.");
export const addBreak = (workdayId: string, started: Date | string, ended: Date | string, paid: boolean, reason: string) =>
  rpcDone('time_staff_add_break', { p_workday: workdayId, p_started: iso(started), p_ended: iso(ended), p_paid: paid, p_reason: reason }, "Couldn't add the break.");
export const setVisitBillable = (id: string, billable: boolean, reason: string) => rpcDone('time_set_visit_billable', { p_visit: id, p_billable: billable, p_reason: reason }, "Couldn't change billing.");
export const approveWorkday = (id: string) => rpcDone('time_approve_workday', { p_workday: id }, "Couldn't approve the day.");
export const reopenWorkday = (id: string, reason: string) => rpcDone('time_reopen_workday', { p_workday: id, p_reason: reason }, "Couldn't reopen the day.");
export const setHourlyRate = (personId: string, rate: number, effective: string, reason?: string) =>
  rpcDone('time_set_hourly_rate', { p_person: personId, p_rate: rate, p_effective: effective, p_reason: reason ?? null }, "Couldn't change the rate.");
export const decideSkip = (id: string, approve: boolean, note?: string) => rpcDone('time_decide_skip', { p_request_id: id, p_approve: approve, p_note: note ?? null }, "Couldn't save your decision.");
export const resolveAlert = (id: string) => rpcDone('time_alert_resolve', { p_alert: id }, "Couldn't close the alert.");

export async function findWorkday(id: string): Promise<Result<{ personId: string; workDate: string }>> {
  const { data, error } = await supabase.from('time_workdays').select('person_id, work_date').eq('id', id).maybeSingle();
  if (error) return explainError(error, "Couldn't open that day.");
  if (!data) return { ok: false, error: 'That workday could not be found.' };
  return ok({ personId: data.person_id, workDate: data.work_date });
}

export interface VisitDetail { visit: LaborVisit; intervals: LaborInterval[]; names: Record<string, string> }
export async function loadVisitDetail(id: string): Promise<Result<VisitDetail>> {
  const v = await supabase.from('time_visits').select('*').eq('id', id).maybeSingle();
  if (v.error) return explainError(v.error, "Couldn't load the visit.");
  if (!v.data) return { ok: false, error: 'That visit could not be found.' };
  const iv = await supabase.from('time_intervals').select('*, time_interval_rates(hourly_rate)').eq('visit_id', id).order('started_at');
  if (iv.error) return explainError(iv.error, "Couldn't load the property times.");
  const intervals = (iv.data ?? []).map((i: Raw): LaborInterval => ({ id: i.id, visitId: i.visit_id, workdayId: i.workday_id, personId: i.person_id, startedAt: i.started_at, endedAt: i.ended_at ?? undefined, status: i.status, billable: !!i.billable, hourlyRate: rateOf(i.time_interval_rates) }));
  const names: Record<string, string> = {};
  const ids = [...new Set(intervals.map((i) => i.personId))];
  if (ids.length) {
    const p = await supabase.from('people').select('id, first_name, last_name').in('id', ids);
    for (const r of p.data ?? []) names[r.id] = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Unnamed';
  }
  return ok({ visit: toVisit(v.data as Raw), intervals, names });
}

export interface ProjectEstimate { projectId: string; laborHours: number; laborCost?: number }
export async function loadProjectEstimate(projectId: string): Promise<Result<ProjectEstimate | null>> {
  const { data, error } = await supabase.from('time_project_estimates').select('*').eq('project_id', projectId).maybeSingle();
  if (error) return explainError(error, "Couldn't load the estimate.");
  return ok(data ? { projectId, laborHours: Number(data.labor_hours), laborCost: data.labor_cost == null ? undefined : Number(data.labor_cost) } : null);
}
/** laborHours = null removes the estimate. */
export async function saveProjectEstimate(companyId: string, projectId: string, laborHours: number | null, laborCost?: number | null, byPersonId?: string): Promise<Result> {
  if (laborHours == null) {
    const { error } = await supabase.from('time_project_estimates').delete().eq('project_id', projectId);
    return error ? explainError(error, "Couldn't remove the estimate.") : ok(undefined);
  }
  if (!(laborHours > 0)) return { ok: false, error: 'Enter the estimated labor-hours (more than zero).' };
  const { error } = await supabase.from('time_project_estimates').upsert({ project_id: projectId, company_id: companyId, labor_hours: laborHours, labor_cost: laborCost ?? null, updated_by: byPersonId ?? null, updated_at: new Date().toISOString() });
  return error ? explainError(error, "Couldn't save the estimate.") : ok(undefined);
}
