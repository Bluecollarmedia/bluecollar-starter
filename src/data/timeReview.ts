/**
 * Days that closed on their own and wait for the owner (supabase/updates/090 and 098).
 * A day nobody clocked out of is closed at zero hours; the database suggests the real end (the last finished stop, visit or break)
 * and the owner accepts it in one tap. Accepting is the owner's existing audited edit, so nothing counts until then.
 * Owner/admin only: the database refuses anyone else.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { explainError, type Result } from '@/data/timeTracking';

export type SuggestionSource = 'last_stop' | 'last_visit' | 'last_break' | 'worker_said';

export interface ReviewDay {
  workdayId: string;
  personId: string;
  name: string;
  workDate: string;
  clockInAt: string;
  /** When the database worked out they probably stopped. Absent when it can't tell: the owner sets the time. */
  suggestedEndAt?: string;
  suggestionSource?: SuggestionSource;
  claimedOutAt?: string;
  claimNote?: string;
}

type Raw = Record<string, any>;
const NOT_INSTALLED = /could not find the function|schema cache|does not exist/i;

function failure(e: { message?: string } | null | undefined, fallback: string): Result<never> {
  const f = explainError(e, fallback);
  return NOT_INSTALLED.test(e?.message ?? '') ? { ...f, notInstalled: true } : f;
}

export async function loadReviewList(): Promise<Result<ReviewDay[]>> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.', notInstalled: true };
  try {
    const { data, error } = await supabase.rpc('time_review_list');
    if (error) return failure(error, "Couldn't load the days waiting for you.");
    const rows = ((data ?? []) as Raw[]).map((r): ReviewDay => ({
      workdayId: r.workday_id, personId: r.person_id, name: r.name ?? 'An employee', workDate: r.work_date, clockInAt: r.clock_in_at,
      suggestedEndAt: r.suggested_end_at ?? undefined, suggestionSource: r.suggestion_source ?? undefined,
      claimedOutAt: r.claimed_out_at ?? undefined, claimNote: r.claim_note ?? undefined,
    }));
    return { ok: true, data: rows };
  } catch (e) {
    return failure(e as Error, "Couldn't load the days waiting for you.");
  }
}

export async function acceptSuggestedEnd(workdayId: string): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.', notInstalled: true };
  try {
    const { error } = await supabase.rpc('time_accept_suggested_end', { p_workday: workdayId });
    return error ? failure(error, "Couldn't accept that time.") : { ok: true, data: undefined };
  } catch (e) {
    return failure(e as Error, "Couldn't accept that time.");
  }
}

/** The person did not work that day (update 101): it stays at zero hours, is settled, and leaves the list. */
export async function settleNoHours(workdayId: string): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.', notInstalled: true };
  try {
    const { error } = await supabase.rpc('time_settle_no_hours', { p_workday: workdayId });
    return error ? failure(error, "Couldn't settle that day.") : { ok: true, data: undefined };
  } catch (e) {
    return failure(e as Error, "Couldn't settle that day.");
  }
}

/** Accepts every waiting day that has a suggestion. A day that can't be accepted stays in the list. */
export async function acceptAllSuggestedEnds(): Promise<Result<{ accepted: number; left: number }>> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.', notInstalled: true };
  try {
    const { data, error } = await supabase.rpc('time_accept_all_suggested_ends');
    if (error) return failure(error, "Couldn't accept those times.");
    const d = (data ?? {}) as Raw;
    return { ok: true, data: { accepted: Number(d.accepted ?? 0), left: Array.isArray(d.left) ? d.left.length : 0 } };
  } catch (e) {
    return failure(e as Error, "Couldn't accept those times.");
  }
}

export const sourceText = (s?: SuggestionSource): string =>
  s === 'last_stop' ? 'last stop finished' : s === 'last_visit' ? 'last property visit ended' : s === 'last_break' ? 'last break ended' : s === 'worker_said' ? 'what they said' : '';
