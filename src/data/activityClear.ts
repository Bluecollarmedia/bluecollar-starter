/**
 * Clearing activity logs (supabase/setup.sql): delete a project's activity for a period. Owner/admin only (the database checks). A count is asked first ("dry run") so the
 * confirmation shows the real number.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { NEEDS_DATABASE_SETUP, isMissingFunction, type ClearMode, type ClearRange } from '@/lib/logClear';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): Result<never> => ({ ok: false, error });
const NOT_CONNECTED = 'Clearing the log needs the live database.';

function why(error: { message?: string }): string {
  return isMissingFunction(error.message) ? NEEDS_DATABASE_SETUP : error.message || 'Something went wrong.';
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
