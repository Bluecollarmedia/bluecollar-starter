import { useCallback, useEffect, useState } from 'react';
import { db, rpc, refresh } from '@/data/store';

/**
 * Private one-time invite links for workers and customers (supabase/updates/078_invite_links.sql).
 * The database makes the link and stores only a hash of it, so the link can be shown once, right after it is made.
 * "Send again" makes a new link; the old one stops working.
 */
export interface IssuedInvite {
  inviteId: string;
  personId: string;
  token: string;
  expiresAt: string;
}

export interface PendingInvite {
  id: string;
  personId: string;
  kind: 'worker' | 'customer';
  firstName: string;
  lastName: string;
  phone: string;
  expiresAt: string;
  lastSentAt?: string;
}

interface IssuedRow { invite_id: string; person_id: string; token: string; expires_at: string }
interface PendingRow { id: string; person_id: string; kind: 'worker' | 'customer'; first_name: string | null; last_name: string | null; phone: string | null; expires_at: string; last_sent_at: string | null }

const issued = (r: IssuedRow): IssuedInvite => ({ inviteId: r.invite_id, personId: r.person_id, token: r.token, expiresAt: r.expires_at });

const demoToken = () => `demo${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

/** Adds a worker with just a name and a phone number and returns the private link. Throws a sentence the screen can show. */
export async function addWorker(input: { firstName: string; lastName: string; phone: string }): Promise<IssuedInvite> {
  if (db.demo) {
    if (!input.firstName.trim()) throw new Error('Enter the worker’s first name.');
    if (input.phone.replace(/\D/g, '').length < 7) throw new Error('Enter the worker’s phone number.');
    return { inviteId: 'demo', personId: 'demo', token: demoToken(), expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };
  }
  const { data, error } = await rpc<IssuedRow>('add_worker', { p_first: input.firstName, p_last: input.lastName, p_phone: input.phone });
  if (error || !data) throw new Error(error?.message ?? 'Could not add the worker.');
  await refresh('people', 'company_members');
  return issued(data);
}

/** A new private link for a worker or customer who has not signed up yet. The old link stops working. */
export async function sendInviteAgain(personId: string): Promise<IssuedInvite> {
  if (db.demo) return { inviteId: 'demo', personId, token: demoToken(), expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };
  const { data, error } = await rpc<IssuedRow>('invite_send', { p_person: personId });
  if (error || !data) throw new Error(error?.message ?? 'Could not make a new link.');
  return issued(data);
}

export async function cancelInvite(inviteId: string): Promise<void> {
  if (db.demo) return;
  const { error } = await rpc('invite_revoke', { p_invite: inviteId });
  if (error) throw new Error(error.message);
}

/** Links that were sent and not used yet (workers, and customers if you send them a link). */
export function usePendingInvites() {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (db.demo) { setLoading(false); return; }
    const { data } = await rpc<PendingRow[]>('invites_pending');
    setInvites((data ?? []).map((r) => ({
      id: r.id, personId: r.person_id, kind: r.kind, firstName: r.first_name ?? '', lastName: r.last_name ?? '', phone: r.phone ?? '',
      expiresAt: r.expires_at, lastSentAt: r.last_sent_at ?? undefined,
    })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return { invites, loading, reload: load };
}
