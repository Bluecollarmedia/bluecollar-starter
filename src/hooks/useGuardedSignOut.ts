/**
 * Sign Out that warns when the person is still clocked in on ANY clock (the workday clock for landscaping and maintenance, or the Snow clock).
 * Signing out never clocks anyone out (the clock lives in the database, not on the phone), so a worker who signs out with the clock running
 * leaves it running. This asks first. It is a prompt, never a block: "Sign out anyway" always works, and a failure to check never stops a sign-out.
 */
import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { useAuth } from '@/providers/AuthProvider';
import { loadMyDay } from '@/data/timeTracking';
import { loadMyUnsettledShifts, splitShifts } from '@/data/snowShifts';
import { isCurrent, WORKDAY_STALE_HOURS } from '@/lib/clockSession';
import { todayKey } from '@/lib/ids';

const clockText = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** What is still running for this person right now: one line per open clock, or an empty list. Never throws. */
export async function openClocksNow(role: string | undefined): Promise<string[]> {
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
  try {
    const shifts = await loadMyUnsettledShifts();
    if (shifts.ok) {
      const { open } = splitShifts(shifts.data);
      if (open) lines.push(`Your Snow shift (since ${clockText(open.clockInAt)})`);
    }
  } catch { /* same */ }
  return lines;
}

export function useGuardedSignOut() {
  const { user, signOut } = useAuth();
  return useCallback(async () => {
    const running = await openClocksNow(user?.role);
    if (!running.length) { await signOut(); return; }
    const message = `${running.join('\n')}\n\nSigning out does not clock you out. Clock out first, or sign out anyway and the clock keeps running.`;
    Alert.alert("You're still clocked in", message, [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out anyway', style: 'destructive', onPress: () => { void signOut(); } },
    ]);
  }, [user?.role, signOut]);
}
