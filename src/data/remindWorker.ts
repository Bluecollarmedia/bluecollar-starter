/** The owner's Remind button (supabase/updates/094): sends the worker a push notification asking them to confirm a job. */
import { isDemo, rpc } from '@/data/store';
import { remindMessage, type RemindResult } from '@/lib/remindMessage';

const MISSING = /could not find the function|schema cache|does not exist/i;

export async function remindWorker(assignmentId: string, firstName: string): Promise<{ tone: 'ok' | 'warn'; text: string; sent: boolean }> {
  if (isDemo()) return { tone: 'ok', text: `Reminder sent to ${firstName || 'the worker'}.`, sent: true };
  const { data, error } = await rpc<RemindResult>('remind_worker_assignment', { p_assignment: assignmentId });
  if (error || !data) {
    const text = MISSING.test(error?.message ?? '') ? 'Reminders are not switched on yet.' : (error?.message || 'Could not send the reminder. Try again.');
    return { tone: 'warn', text, sent: false };
  }
  return { ...remindMessage(data, firstName), sent: !!data.sent };
}
