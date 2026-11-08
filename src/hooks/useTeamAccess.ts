import { useCallback, useEffect, useState } from 'react';
import { db, rpc, refresh, isDemo } from '@/data/store';
import { w } from '@/config/brand';

/**
 * The owner's Team access screen: who is on the team, who is an admin, and who is deactivated.
 * Everything is decided by the database (supabase/setup.sql); this hook only shows it and asks for changes. A change is shown as done
 * only after the database says so.
 */

export type TeamState = 'active' | 'waiting' | 'deactivated';
export interface TeamPerson {
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string;
  role?: 'owner' | 'admin' | 'worker' | 'customer';
  /** Has team access: an active owner, admin or worker (has_access from team_access_overview). */
  hasAccess: boolean;
  isStaff: boolean;
  pendingTeam: boolean;
  deactivatedAt?: string;
  deactivatedByName?: string;
  isMe: boolean;
  state: TeamState;
}

interface Row {
  person_id: string; first_name: string | null; last_name: string | null; email: string | null; avatar_url: string | null;
  role: TeamPerson['role'] | null; member_status: string | null;
  has_access: boolean | null; is_staff: boolean | null;
  pending_team_request: boolean; deactivated_at: string | null; deactivated_by_name: string | null; is_me: boolean;
}

function fromRow(r: Row): TeamPerson {
  const hasAccess = !!r.has_access;
  // 'waiting' = invited: added with a name and phone, link not opened yet.
  const state: TeamState = hasAccess ? 'active' : r.member_status === 'invited' || r.pending_team_request ? 'waiting' : 'deactivated';
  return {
    personId: r.person_id, firstName: r.first_name ?? '', lastName: r.last_name ?? '', email: r.email ?? '', avatarUrl: r.avatar_url ?? undefined,
    role: r.role ?? undefined, hasAccess, isStaff: !!r.is_staff,
    pendingTeam: r.pending_team_request, deactivatedAt: r.deactivated_at ?? undefined,
    deactivatedByName: r.deactivated_by_name ?? undefined, isMe: !!r.is_me, state,
  };
}

export interface DeactivationCheck { blocking: string[]; warnings: string[] }

export function useTeamAccess() {
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [myRole, setMyRole] = useState<'owner' | 'admin' | undefined>();

  const load = useCallback(async () => {
    if (isDemo()) { setLoading(false); setError('Team access needs the live database.'); return; }
    const { data, error: e } = await rpc<Row[]>('team_access_overview');
    if (e) setError(/function .* does not exist|schema cache/i.test(e.message) ? 'Team access is not switched on yet (the database update has not been installed).' : e.message);
    else {
      setError('');
      const list = (data ?? []).map(fromRow).filter((p) => p.role !== 'customer');
      setPeople(list);
      setMyRole(list.find((p) => p.isMe)?.role === 'owner' ? 'owner' : 'admin');
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Runs one change. Returns the database's own message when it refuses, or '' on success. */
  const act = useCallback(async (fn: string, args: Record<string, unknown>) => {
    const { error: e } = await rpc(fn, args);
    if (e) return e.message;
    await Promise.all([load(), refresh('company_members', 'people')]);
    return '';
  }, [load]);

  const check = useCallback(async (personId: string): Promise<DeactivationCheck | string> => {
    const { data, error: e } = await rpc<{ blocking: string[]; warnings: string[] }>('member_deactivation_check', { p_person_id: personId });
    if (e) return e.message;
    return { blocking: data?.blocking ?? [], warnings: data?.warnings ?? [] };
  }, []);

  return {
    people, loading, error, myRole, reload: load, check,
    deactivate: (personId: string, acknowledge: boolean) => act('deactivate_member', { p_person_id: personId, p_acknowledge: acknowledge }),
    reactivate: (personId: string) => act('reactivate_member', { p_person_id: personId }),
    setRole: (personId: string, role: 'admin' | 'worker') => act('set_member_role', { p_person_id: personId, p_role: role }),
  };
}

export interface AdminPermissions { team: boolean; invites: boolean; time_corrections: boolean; pay_rates: boolean }
export const ADMIN_POWERS: { key: keyof AdminPermissions; label: string; hint: string }[] = [
  { key: 'team', label: 'Team members', hint: 'Deactivate and reactivate workers.' },
  { key: 'invites', label: 'Invites', hint: 'Adding workers and customers and sending their private links.' },
  { key: 'time_corrections', label: 'Time corrections', hint: w('Correct and approve workdays and job site times.') },
  { key: 'pay_rates', label: 'Pay rates', hint: 'See and change hourly rates and overtime terms.' },
];

export function useAdminPermissions() {
  const [perms, setPerms] = useState<AdminPermissions | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (isDemo()) return;
    const { data, error: e } = await rpc<AdminPermissions>('get_admin_permissions');
    if (e) setError(e.message); else { setError(''); setPerms(data ?? null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = useCallback(async (next: AdminPermissions) => {
    const { error: e } = await rpc('set_admin_permissions', {
      p_team: next.team, p_invites: next.invites, p_time_corrections: next.time_corrections, p_pay_rates: next.pay_rates,
    });
    if (e) return e.message;
    setPerms(next);
    return '';
  }, []);
  return { perms, error, save, reload: load };
}
