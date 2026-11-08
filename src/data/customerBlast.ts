/**
 * Sending a message to customers (supabase/updates/055). One database call finds the customers in the chosen group, saves the
 * message in the owner's announcements history, and gives each customer an unread notification, which the phone-push system
 * then delivers. The owner is told how many people it really reached.
 */
import { useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { db, useDb } from '@/data/store';
import { describeSendError, isCustomerAudience, type CustomerAudience } from '@/lib/customerMessage';
import type { Announcement } from '@/types/announcement';

export type SendResult = { ok: true; recipients: number } | { ok: false; error: string };

export async function sendCustomerMessage(input: { title: string; body: string; audience: CustomerAudience }): Promise<SendResult> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Messaging customers needs the live app, not demo mode.' };
  try {
    const { data, error } = await supabase.rpc('send_customer_announcement', {
      p_title: input.title.trim(), p_body: input.body.trim(), p_audience: input.audience,
    });
    if (error) return { ok: false, error: describeSendError(error.message) };
    return { ok: true, recipients: Number((data as { recipients?: number } | null)?.recipients ?? 0) };
  } catch (err) {
    return { ok: false, error: describeSendError(err instanceof Error ? err.message : undefined) };
  }
}

/** How many people each group reaches right now (update 83). Null when it can't be read; the screen just shows no counts. */
export async function fetchCustomerReach(): Promise<Partial<Record<CustomerAudience, number>> | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.rpc('customer_message_reach');
    if (error || !data) return null;
    return data as Partial<Record<CustomerAudience, number>>;
  } catch {
    return null;
  }
}

/** The messages this company has sent to customers, newest first. */
export function useCustomerMessageHistory(): Announcement[] {
  const v = useDb();
  return useMemo(
    () => db.announcements.filter((a) => isCustomerAudience(a.audience)).slice().sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
    [v],
  );
}
