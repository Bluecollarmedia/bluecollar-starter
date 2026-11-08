/**
 * Snow clock in / clock out (supabase/updates/028). Separate from
 * landscaping Payroll. Original times never change; the owner adds
 * corrections and the latest correction is what counts.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uuid } from '@/lib/ids';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });
const NOT_CONNECTED = 'The snow time clock needs the live database, which isn\'t connected in this version of the app.';

function message(error: { message?: string } | null | undefined, fallback: string) {
  const m = error?.message?.trim();
  return m && !/^(permission denied|new row violates|JWT)/i.test(m) ? m : fallback;
}

export interface SnowShift {
  id: string;
  personId: string;
  personName?: string;
  /** Times that count: the latest correction's, else the original. */
  clockInAt: string;
  clockOutAt?: string;
  /** The times as tapped. */
  originalIn: string;
  originalOut?: string;
  /** The storm this shift was tagged with at clock-in (update 42). Missing when untagged or before update 42. */
  stormId?: string;
  corrected: boolean;
  correctionReason?: string;
  /** Set by the database when this shift was never clocked out of (update 90): it counts as zero hours until the owner corrects it. */
  flaggedAt?: string;
  /** What the worker said when they really stopped (saved only). */
  claimedOutAt?: string;
  claimNote?: string;
  /** When the worker answered (a time, or "not sure"). */
  claimedAt?: string;
}

/** Shifts the caller can see (own for workers, everyone's for owner/admin), newest first. */
export async function loadShifts(sinceIso: string, untilIso?: string): Promise<Result<SnowShift[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const run = (columns: string) => {
    let q = supabase.from('snow_shifts').select(columns).gte('clock_in_at', sinceIso);
    if (untilIso) q = q.lt('clock_in_at', untilIso);
    return q.order('clock_in_at', { ascending: false });
  };
  const corrections = 'snow_shift_corrections(clock_in_at, clock_out_at, reason, created_at)';
  let { data, error } = await run(`id, person_id, storm_id, clock_in_at, clock_out_at, flagged_at, claimed_out_at, claim_note, claimed_at, ${corrections}`);
  // Before update 90 there are no flag columns: load without them. Before update 42 there is no storm_id column either.
  if (error && /flagged_at|claimed_/i.test(error.message)) {
    ({ data, error } = await run(`id, person_id, storm_id, clock_in_at, clock_out_at, ${corrections}`));
  }
  if (error && /storm_id/i.test(error.message)) {
    ({ data, error } = await run(`id, person_id, clock_in_at, clock_out_at, ${corrections}`));
  }
  if (error) return fail(message(error, 'Couldn\'t load shifts.'));
  return ok(shiftsFromRows((data ?? []) as any[]));
}

function shiftsFromRows(rows: any[]): SnowShift[] {
  return (rows.map((s) => {
    const fixes = ((s.snow_shift_corrections ?? []) as { clock_in_at: string; clock_out_at: string | null; reason: string; created_at: string }[])
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = fixes[fixes.length - 1];
    return {
      id: s.id,
      personId: s.person_id,
      clockInAt: last?.clock_in_at ?? s.clock_in_at,
      clockOutAt: (last ? last.clock_out_at : s.clock_out_at) ?? undefined,
      originalIn: s.clock_in_at,
      originalOut: s.clock_out_at ?? undefined,
      stormId: s.storm_id ?? undefined,
      corrected: !!last,
      correctionReason: last?.reason,
      flaggedAt: s.flagged_at ?? undefined,
      claimedOutAt: s.claimed_out_at ?? undefined,
      claimNote: s.claim_note ?? undefined,
      claimedAt: s.claimed_at ?? undefined,
    };
  }));
}

/**
 * The caller's shifts that are not settled, from ANY week: still open, or flagged "never clocked out" and not yet corrected. The weekly
 * list above starts at this week's Monday, which would hide an old open shift (the app would offer Clock In while the database says "already clocked in").
 */
export async function loadMyUnsettledShifts(): Promise<Result<SnowShift[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const corrections = 'snow_shift_corrections(clock_in_at, clock_out_at, reason, created_at)';
  const q = (cols: string, filter: string) => supabase.from('snow_shifts').select(cols).or(filter).order('clock_in_at', { ascending: false }).limit(20);
  let { data, error } = await q(`id, person_id, storm_id, clock_in_at, clock_out_at, flagged_at, claimed_out_at, claim_note, claimed_at, ${corrections}`, 'clock_out_at.is.null,flagged_at.not.is.null');
  if (error && /flagged_at|claimed_/i.test(error.message)) {
    ({ data, error } = await q(`id, person_id, storm_id, clock_in_at, clock_out_at, ${corrections}`, 'clock_out_at.is.null'));
  }
  if (error) return fail(message(error, 'Couldn\'t load your shifts.'));
  return ok(shiftsFromRows((data ?? []) as any[]));
}

/** Asks the database to flag a shift that was never clocked out of (older than 20 hours) before anything is shown. A failure changes nothing. */
export async function checkMyShift(): Promise<void> {
  if (!isSupabaseConfigured) return;
  try { await supabase.rpc('snow_check_my_shift'); } catch { /* an older database has no such function; the screens work out staleness themselves */ }
}

/** The worker says when they really stopped a shift they never clocked out of (null = not sure). Saved for the owner; no hours change. */
export async function claimStaleShift(shiftId: string, stoppedAtIso: string | null, note?: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_claim_stale_end', { p_shift: shiftId, p_stopped_at: stoppedAtIso, p_note: note ?? null });
  return error ? fail(message(error, 'Couldn\'t save your answer.')) : ok(undefined);
}

/**
 * Which of a person's shifts is really running, and which one needs the "you didn't clock out" answer. The same rule as the workday clock
 * (lib/clockSession), with the Snow threshold (storms run through the night). Merges the weekly list with the unsettled ones.
 */
export function splitShifts(shifts: SnowShift[], nowMs: number = Date.now()): { open?: SnowShift; stale?: SnowShift } {
  const { isCurrent, needsAnswer, SNOW_STALE_HOURS } = require('@/lib/clockSession') as typeof import('@/lib/clockSession');
  const asSession = (s: SnowShift) => ({ clockInAt: s.originalIn, clockOutAt: s.originalOut, flagged: !!s.flaggedAt && !s.corrected });
  const open = shifts.find((s) => !s.originalOut && !s.flaggedAt && isCurrent(asSession(s), nowMs, SNOW_STALE_HOURS));
  const stale = shifts.find((s) => needsAnswer(asSession(s), nowMs, SNOW_STALE_HOURS));
  return { open, stale };
}

/**
 * Is there a running storm route for me (update 67)? When not, the Time Clock shows "No active storm assignment" instead of a Clock In
 * button. The database refuses the clock-in either way. An older database (before update 67) has no such function: allow, as before.
 */
export async function canClockIn(): Promise<boolean> {
  if (!isSupabaseConfigured) return true;
  const { data, error } = await supabase.rpc('snow_can_clock_in');
  if (error) return true;
  return data !== false;
}

export async function clockIn(): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_clock_in', { p_client_request_id: uuid() });
  return error ? fail(message(error, 'Couldn\'t clock in.')) : ok(undefined);
}

export async function clockOut(): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_clock_out');
  return error ? fail(message(error, 'Couldn\'t clock out.')) : ok(undefined);
}

export async function correctShift(shiftId: string, clockInAt: string, clockOutAt: string | null, reason: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_correct_shift', {
    p_shift_id: shiftId, p_clock_in_at: clockInAt, p_clock_out_at: clockOutAt, p_reason: reason,
  });
  return error ? fail(message(error, 'Couldn\'t correct the shift.')) : ok(undefined);
}

/** Hours worked, counting an open shift up to now. */
export function shiftHours(s: Pick<SnowShift, 'clockInAt' | 'clockOutAt'>, now = Date.now()): number {
  const end = s.clockOutAt ? new Date(s.clockOutAt).getTime() : now;
  return Math.max(0, end - new Date(s.clockInAt).getTime()) / 3_600_000;
}

export const formatHours = (h: number) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;

export const formatClock = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Monday 00:00 of the current week, local time. */
export function startOfWeekIso(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
}
