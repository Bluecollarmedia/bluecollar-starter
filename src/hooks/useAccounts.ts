import { useCallback, useEffect, useState } from 'react';
import { db, rpc, refresh, isDemo } from '@/data/store';

/**
 * Where someone stands with the company, from their membership. Someone added with a private link is "not joined" until they use
 * it, and active the moment they do: there is nothing to approve.
 */
export type AccountStatus = 'active' | 'removed' | 'not_joined';
export type AccountRole = 'owner' | 'admin' | 'worker' | 'customer';

export interface Account {
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  signedUpAt?: string;
  lastSignInAt?: string;
  role?: AccountRole;
  status: AccountStatus;
  removedAt?: string;
  isMe: boolean;
}

interface AccountRow {
  person_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  signed_up_at: string | null;
  last_sign_in_at: string | null;
  role: AccountRole | null;
  member_status: 'active' | 'invited' | 'inactive' | null;
  removed_at: string | null;
  request_status: 'pending' | 'approved' | 'declined' | null;
  is_me: boolean;
}

function statusOf(member: string | null | undefined): AccountStatus {
  if (member === 'active') return 'active';
  if (member === 'inactive') return 'removed';
  return 'not_joined';
}

function fromRow(r: AccountRow): Account {
  return {
    personId: r.person_id,
    firstName: r.first_name ?? '',
    lastName: r.last_name ?? '',
    email: r.email ?? '',
    phone: r.phone ?? undefined,
    avatarUrl: r.avatar_url ?? undefined,
    signedUpAt: r.signed_up_at ?? undefined,
    lastSignInAt: r.last_sign_in_at ?? undefined,
    role: r.role ?? undefined,
    status: statusOf(r.member_status),
    removedAt: r.removed_at ?? undefined,
    isMe: !!r.is_me,
  };
}

/** Demo mode: build the list from the local store's members. */
function demoAccounts(): Account[] {
  const out = new Map<string, Account>();
  for (const m of db.members) {
    if (!m.person) continue;
    out.set(m.personId, {
      personId: m.personId,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      email: m.person.email,
      phone: m.person.phone,
      avatarUrl: m.person.avatarUrl,
      signedUpAt: m.createdAt,
      role: m.role as AccountRole,
      status: statusOf(m.status),
      isMe: m.personId === db.personId,
    });
  }
  return [...out.values()];
}

/** Every account that has signed up, for the owner's Accounts screen. */
export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (isDemo()) {
      setAccounts(demoAccounts());
      setLoading(false);
      return;
    }
    const { data, error: rpcError } = await rpc<AccountRow[]>('list_accounts');
    if (rpcError) setError(rpcError.message);
    else {
      setError('');
      setAccounts((data ?? []).map(fromRow));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Runs one of the owner actions; returns an error message, or '' on success. */
  const act = useCallback(
    async (fn: 'remove_account_access' | 'restore_account_access' | 'delete_account', personId: string) => {
      if (isDemo()) return 'Accounts can’t be changed in demo mode.';
      const { error: rpcError } = await rpc(fn, { p_person_id: personId });
      if (rpcError) return rpcError.message;
      await Promise.all([load(), refresh('company_members', 'people')]);
      return '';
    },
    [load],
  );

  return {
    accounts,
    loading,
    error,
    reload: load,
    removeAccess: (personId: string) => act('remove_account_access', personId),
    restoreAccess: (personId: string) => act('restore_account_access', personId),
    deleteAccount: (personId: string) => act('delete_account', personId),
  };
}
