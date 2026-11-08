/**
 * Sign Out that warns when the person is still clocked in (the workday clock).
 * Signing out never clocks anyone out (the clock lives in the database, not on the phone), so a worker who signs out with the clock running
 * leaves it running. This asks first. It is a prompt, never a block: "Sign out anyway" always works, and a failure to check never stops a sign-out.
 */
import { useCallback } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { loadMyDay } from '@/data/timeTracking';
import { isCurrent, WORKDAY_STALE_HOURS } from '@/lib/clockSession';
import { todayKey } from '@/lib/ids';
import { confirmAction } from '@/components/financials/ActionSheet';

const clockText = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** What is still running for this person right now: one line per open clock, or an empty list. Never throws. */
export async function listOpenClocks(role: string | undefined): Promise<string[]> {
  if (role !== 'worker' && role !== 'owner') return [];
  const lines: string[] = [];
  try {
    const day = await loadMyDay(todayKey());
    if (day.ok) {
      const nowMs = Date.now() + day.data.clockOffsetMs;
      const running = day.data.days.find((d) => !d.clockOutAt && d.status !== 'needs_review'
        && isCurrent({ clockInAt: d.clockInAt, clockOutAt: d.clockOutAt }, nowMs, day.data.settings.staleAfterHours ?? WORKDAY_STALE_HOURS));
      if (running) lines.push(`Your workday (since ${clockText(running.clockInAt)})`);
    }
  } catch { /* checking must never stop a sign-out */ }
  return lines;
}

export function useGuardedSignOut() {
  const { user, signOut } = useAuth();
  return useCallback(async () => {
    const running = await listOpenClocks(user?.role);
    if (!running.length) { await signOut(); return; }
    const message = `${running.join('\n')}\n\nSigning out does not clock you out. Clock out first, or sign out anyway and the clock keeps running.`;
    confirmAction("You're still clocked in", message, 'Sign out anyway', () => { void signOut(); }, true, 'Stay signed in');
  }, [user?.role, signOut]);
}
