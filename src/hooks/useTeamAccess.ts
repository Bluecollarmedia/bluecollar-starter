import { useCallback, useEffect, useState } from 'react';
import { db, rpc, refresh, isDemo } from '@/data/store';

/**
 * The owner's Team access screen: who is on the team, which modes each person works in, who is an admin, and who is deactivated.
 * Everything is decided by the database (update 66); this hook only shows it and asks for changes. A change is shown as done
 * only after the database says so.
 */
export type SnowService = 'plowing' | 'shoveling' | 'salting';
export const SNOW_SERVICES: { key: SnowService; label: string }[] = [
  { key: 'plowing', label: 'Plowing' },
  { key: 'shoveling', label: 'Shoveling' },
  { key: 'salting', label: 'Salting' },
];

export type TeamState = 'active' | 'waiting' | 'deactivated';
export interface TeamPerson {
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string;
  role?: 'owner' | 'admin' | 'worker' | 'customer';
  workerType?: 'landscaping' | 'maintenance';
  landscaping: boolean;
  snowServices: SnowService[];
  isStaff: boolean;
  pendingTeam: boolean;
  pendingSnow: boolean;
  deactivatedAt?: string;
  deactivatedByName?: string;
  isMe: boolean;
  state: TeamState;
}

interface Row {
  person_id: string; first_name: string | null; last_name: string | null; email: string | null; avatar_url: string | null;
  role: TeamPerson['role'] | null; member_status: string | null; worker_type: 'landscaping' | 'maintenance' | null;
  landscaping: boolean | null; snow_services: SnowService[] | null; is_staff: boolean | null;
  pending_team_request: boolean; pending_snow_request: boolean; deactivated_at: string | null; deactivated_by_name: string | null; is_me: boolean;
}

function fromRow(r: Row): TeamPerson {
  const snow = (r.snow_services ?? []) as SnowService[];
  const landscaping = !!r.landscaping;
  // 'waiting' = invited: added with a name and phone, link not opened yet.
  const state: TeamState = landscaping || snow.length > 0 ? 'active' : r.member_status === 'invited' || r.pending_team_request || r.pending_snow_request ? 'waiting' : 'deactivated';
  return {
    personId: r.person_id, firstName: r.first_name ?? '', lastName: r.last_name ?? '', email: r.email ?? '', avatarUrl: r.avatar_url ?? undefined,
    role: r.role ?? undefined, workerType: r.worker_type ?? undefined, landscaping, snowServices: snow, isStaff: !!r.is_staff,
    pendingTeam: r.pending_team_request, pendingSnow: r.pending_snow_request, deactivatedAt: r.deactivated_at ?? undefined,
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
    reactivate: (personId: string, landscaping: boolean, workerType: 'landscaping' | 'maintenance', snow: SnowService[]) =>
      act('reactivate_member', { p_person_id: personId, p_landscaping: landscaping, p_worker_type: workerType, p_snow_services: snow }),
    setRole: (personId: string, role: 'admin' | 'worker') => act('set_member_role', { p_person_id: personId, p_role: role }),
    setModes: (personId: string, landscaping: boolean, snow: SnowService[]) => act('set_member_modes', { p_person_id: personId, p_landscaping: landscaping, p_snow_services: snow }),
  };
}

export interface AdminPermissions { team: boolean; invites: boolean; snow_access: boolean; time_corrections: boolean; pay_rates: boolean }
export const ADMIN_POWERS: { key: keyof AdminPermissions; label: string; hint: string }[] = [
  { key: 'team', label: 'Team members', hint: 'Deactivate, reactivate and change the modes people work in.' },
  { key: 'invites', label: 'Invites', hint: 'Adding workers and customers and sending their private links.' },
  { key: 'snow_access', label: 'Snow access', hint: 'Give, change or remove snow services.' },
  { key: 'time_corrections', label: 'Time corrections', hint: 'Correct and approve workdays and property times.' },
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
      p_team: next.team, p_invites: next.invites, p_snow_access: next.snow_access, p_time_corrections: next.time_corrections, p_pay_rates: next.pay_rates,
    });
    if (e) return e.message;
    setPerms(next);
    return '';
  }, []);
  return { perms, error, save, reload: load };
}
