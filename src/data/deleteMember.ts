/**
 * Deleting a worker or customer (supabase/updates/092). Only someone with no login and no records at all can be deleted (for example
 * one added by mistake, or a placeholder nobody linked). Anyone else is deactivated instead, which keeps their history and payroll.
 * The database decides; this only asks and reports back in plain words.
 */
import { db, deleteRow, isDemo, refresh, rowsOf, rpc } from '@/data/store';

export type DeleteMemberResult =
  | { ok: true }
  | { ok: false; hasHistory: boolean; error: string };

const MISSING = /could not find the function|schema cache|does not exist/i;

/** Why the app can refuse before asking the database: nothing to delete, or it is the signed-in person. */
export function cannotDeleteReason(personId: string): string | null {
  if (personId === db.personId) return 'You cannot delete yourself.';
  return null;
}

export async function deleteUnusedMember(personId: string): Promise<DeleteMemberResult> {
  const mine = cannotDeleteReason(personId);
  if (mine) return { ok: false, hasHistory: false, error: mine };
  if (isDemo()) {
    const m = db.members.find((x) => x.personId === personId);
    if (!m) return { ok: false, hasHistory: false, error: 'Not found.' };
    const busy = db.assignments.some((a) => a.personId === personId) || db.projects.some((p) => p.customerId === personId);
    if (busy) return { ok: false, hasHistory: true, error: 'They have jobs or projects, so they cannot be deleted. Deactivate them instead and their history stays.' };
    for (const r of rowsOf('crew_members').filter((x) => x.personId === personId)) deleteRow('crew_members', r.id);
    deleteRow('company_members', m.id);
    return { ok: true };
  }
  const { error } = await rpc('delete_unused_member', { p_person_id: personId });
  if (error) {
    if (MISSING.test(error.message)) return { ok: false, hasHistory: false, error: 'Deleting is not switched on yet.' };
    const history = /^HAS_HISTORY:\s*/.test(error.message);
    // The database lists its table names; the owner only needs the plain reason.
    if (history) return { ok: false, hasHistory: true, error: 'They have work history (jobs, routes, hours or snow), so they cannot be deleted. Deactivate them instead and their history stays.' };
    return { ok: false, hasHistory: false, error: error.message };
  }
  await refresh('people', 'company_members', 'crew_members');
  return { ok: true };
}
