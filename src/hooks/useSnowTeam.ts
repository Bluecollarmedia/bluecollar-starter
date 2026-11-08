/**
 * The Snow Team (owner/admin): who has snow access, with which services, and the signed-in person's own access.
 * No codes and no requests: the owner grants access directly (snow_grant_access / revoke_snow_access, updates 20/23/66/80),
 * and new people join with a private invite link like everyone else.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { SERVICE_LABEL, SNOW_SERVICES as SERVICE_KEYS } from '@/types/snow';
import type { SnowService } from '@/types/snow';

export type { SnowService };
export const SNOW_SERVICES: { key: SnowService; label: string }[] = SERVICE_KEYS.map((key) => ({ key, label: SERVICE_LABEL[key] }));
export function snowServiceLabel(s: string): string {
  return SERVICE_LABEL[s as SnowService] ?? s;
}

export interface SnowMember {
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  services: SnowService[];
  status: 'active' | 'revoked';
  approvedAt?: string;
  revokedAt?: string;
  landscapingRole?: string;
}

type Result = { ok: true } | { ok: false; error: string };

function friendly(message: string | undefined): string {
  if (!message) return 'Something went wrong. Please try again.';
  if (message.includes('pick at least one')) return 'Pick at least one snow service.';
  if (message.includes('not allowed')) return 'Only the owner can do this.';
  if (message.includes('Could not find the function') || message.includes('does not exist')) {
    return 'The Snow Team needs a database update that has not been run yet.';
  }
  return message;
}

// ── Demo-mode sample (no Supabase) ──────────────────────────────

const demo = {
  members: [
    {
      personId: 'snow-p2', firstName: 'Ana', lastName: 'Duarte', email: 'ana.duarte@gmail.com',
      services: ['shoveling', 'salting'], status: 'active', approvedAt: '2026-10-01T14:00:00Z',
    },
  ] as SnowMember[],
};
const listeners = new Set<() => void>();
function demoChanged() {
  listeners.forEach((l) => l());
}

// ── The signed-in person's standing ──────────────────────────────

/** The companies this person has active snow access in (get_my_snow_access, update 20). Empty without a database. */
export async function fetchMySnowAccess(): Promise<{ companyId: string; services: string[]; landscaping: boolean }[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('get_my_snow_access');
  if (error || !Array.isArray(data)) return [];
  return (data as { company_id: string; services?: string[]; landscaping_access?: boolean }[])
    .map((r) => ({ companyId: r.company_id, services: r.services ?? [], landscaping: r.landscaping_access !== false }));
}

function mapMember(m: any): SnowMember {
  return {
    personId: m.person_id,
    firstName: m.first_name ?? '',
    lastName: m.last_name ?? '',
    email: m.email ?? '',
    phone: m.phone ?? undefined,
    avatarUrl: m.avatar_url ?? undefined,
    services: m.services ?? [],
    status: m.status,
    approvedAt: m.approved_at ?? undefined,
    revokedAt: m.revoked_at ?? undefined,
    landscapingRole: m.landscaping_role ?? undefined,
  };
}

/**
 * Everything the owner's Snow Team screen needs: the snow team and what each person can do. Each action calls the database and then
 * reloads, so the screen always shows what was actually saved.
 */
export function useSnowOnboardingAdmin() {
  const [members, setMembers] = useState<SnowMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setMembers(demo.members.slice());
      setLoading(false);
      return;
    }
    try {
      const memRes = await supabase.rpc('list_snow_members');
      if (memRes.error) {
        setLoadError(friendly(memRes.error.message));
      } else {
        setLoadError(null);
        setMembers(((memRes.data as any[]) ?? []).map(mapMember));
      }
    } catch (e: any) {
      setLoadError(friendly(e?.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    if (!isSupabaseConfigured) {
      listeners.add(reload);
      return () => {
        listeners.delete(reload);
      };
    }
  }, [reload]);

  const call = useCallback(
    async (fn: string, args: Record<string, unknown>, demoApply: () => void): Promise<Result> => {
      if (!isSupabaseConfigured) {
        demoApply();
        demoChanged();
        return { ok: true };
      }
      const { error } = await supabase.rpc(fn, args);
      await reload();
      return error ? { ok: false, error: friendly(error.message) } : { ok: true };
    },
    [reload],
  );

  /** Gives an existing landscaping worker snow access directly (database function snow_grant_access); no request needed. */
  const grantAccess = useCallback(
    (person: { personId: string; firstName: string; lastName: string; email: string; phone?: string }, services: SnowService[]) => {
      if (services.length === 0) return Promise.resolve<Result>({ ok: false, error: 'Pick at least one snow service.' });
      return call('snow_grant_access', { p_person_id: person.personId, p_services: services }, () => {
        demo.members = demo.members.filter((m) => m.personId !== person.personId);
        demo.members.push({
          personId: person.personId, firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone,
          services, status: 'active', approvedAt: new Date().toISOString(), landscapingRole: 'worker',
        });
      });
    },
    [call],
  );

  const revoke = useCallback(
    (member: SnowMember) =>
      call('revoke_snow_access', { p_person_id: member.personId }, () => {
        const m = demo.members.find((x) => x.personId === member.personId);
        if (m) Object.assign(m, { status: 'revoked', revokedAt: new Date().toISOString() });
      }),
    [call],
  );

  return { members, loading, loadError, reload, revoke, grantAccess };
}
