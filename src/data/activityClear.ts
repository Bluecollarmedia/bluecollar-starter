/**
 * Clearing activity logs (supabase/updates/051): archive, restore or delete a period of the Snow activity log, and delete a
 * project's activity for a period. Owner/admin only (the database checks). A count is asked first ("dry run") so the
 * confirmation shows the real number.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { NEEDS_UPDATE_51, isMissingFunction, type ClearMode, type ClearRange } from '@/lib/logClear';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): Result<never> => ({ ok: false, error });
const NOT_CONNECTED = 'Clearing the log needs the live database.';

function why(error: { message?: string }): string {
  return isMissingFunction(error.message) ? NEEDS_UPDATE_51 : error.message || 'Something went wrong.';
}

/** How many entries the Snow log action would affect. Changes nothing. */
export async function previewSnowClear(range: ClearRange, mode: ClearMode): Promise<Result<number>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_clear_activity', { p_from: range.from, p_to: range.to, p_mode: mode, p_dry_run: true });
  if (error) return fail(why(error));
  return { ok: true, data: Number((data as { count?: number } | null)?.count ?? 0) };
}

export async function runSnowClear(range: ClearRange, mode: ClearMode): Promise<Result<number>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_clear_activity', { p_from: range.from, p_to: range.to, p_mode: mode });
  if (error) return fail(why(error));
  return { ok: true, data: Number((data as { count?: number } | null)?.count ?? 0) };
}

/** Years that have Snow log entries, newest first. Empty when the update isn't installed. */
export async function loadSnowLogYears(): Promise<number[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('snow_activity_years');
  if (error) return [];
  return ((data ?? []) as { year: number }[]).map((r) => Number(r.year));
}

export async function previewProjectClear(projectId: string, range: ClearRange): Promise<Result<number>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('clear_project_activity', { p_project_id: projectId, p_from: range.from, p_to: range.to, p_dry_run: true });
  if (error) return fail(why(error));
  return { ok: true, data: Number((data as { count?: number } | null)?.count ?? 0) };
}

export async function runProjectClear(projectId: string, range: ClearRange): Promise<Result<number>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('clear_project_activity', { p_project_id: projectId, p_from: range.from, p_to: range.to });
  if (error) return fail(why(error));
  return { ok: true, data: Number((data as { count?: number } | null)?.count ?? 0) };
}
