import React, { useState } from 'react';
import { View, Text, Pressable, Modal, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Button, Input } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useLabor } from '@/hooks/useLabor';
import { ownerClockIn, ownerClockOut } from '@/data/ownerClock';
import { offsetDateKey, todayKey } from '@/lib/ids';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

const REASONS_IN = ['Forgot to clock in', 'Phone problem', 'Started early'];
const REASONS_OUT = ['Forgot to clock out', 'Phone problem', 'Sent home'];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * On a worker's page: is this person clocked in right now, and a button to clock them in or out by hand. A reason is required and the change
 * is saved in the time history as the owner's. The worker's phone picks it up within a minute (their Today shows or hides the work).
 * Uses the owner's existing audited functions; see src/data/ownerClock.ts.
 */
export function OwnerClockCard({ personId, firstName }: { personId: string; firstName: string }) {
  const { colors } = useTheme();
  const L = useLabor(offsetDateKey(-1), todayKey(), personId, 30_000);
  const [mode, setMode] = useState<'in' | 'out' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const days = L.snapshot?.workdays ?? [];
  const open = days.filter((d) => !d.clockOutAt && d.status !== 'needs_review').sort((a, b) => b.clockInAt.localeCompare(a.clockInAt))[0];
  const stale = L.snapshot?.staleOpen?.[0];
  const closed = days.filter((d) => d.clockOutAt && d.status !== 'needs_review' && d.workDate === todayKey()).sort((a, b) => (a.clockOutAt ?? '').localeCompare(b.clockOutAt ?? '')).pop();
  const loading = L.loading && !L.snapshot;
  if (L.notInstalled) return null;

  function close() { setMode(null); setReason(''); setError(''); setBusy(false); }
  async function confirm() {
    if (!mode || busy) return;
    setBusy(true);
    setError('');
    const r = mode === 'in' ? await ownerClockIn(personId, reason.trim()) : open ? await ownerClockOut(open.id, reason.trim()) : { ok: false as const, error: 'They are not clocked in.' };
    if (!r.ok) { setError(r.error); setBusy(false); haptics.warning(); return; }
    haptics.success();
    close();
    L.reload();
  }

  const status = open ? `Clocked in since ${timeOf(open.clockInAt)}${open.workDate !== todayKey() ? ` (${dayOf(open.clockInAt)})` : ''}`
    : stale ? `Still open from ${dayOf(stale.clockInAt)}. Fix that day first.`
    : closed?.clockOutAt ? `Clocked out at ${timeOf(closed.clockOutAt)}`
    : 'Not clocked in';
  const dot = open ? colors.success : stale ? colors.warning : colors.textTertiary;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
      <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700' }]}>Workday</Text>
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, flex: 1 }]}>{loading ? 'Checking…' : status}</Text>
      </View>
      {!loading && !stale ? (
        <Pressable
          onPress={() => { haptics.select(); setMode(open ? 'out' : 'in'); }}
          accessibilityRole="button"
          accessibilityLabel={open ? `Clock out ${firstName}` : `Clock in ${firstName}`}
          style={({ pressed }) => [styles.button, open ? { borderColor: colors.border, borderWidth: 1 } : { backgroundColor: colors.primary }, pressed && { opacity: 0.85 }]}
        >
          <Text style={[typeScale.labelLarge, { color: open ? colors.textPrimary : colors.textOnPrimary, fontWeight: '700' }]}>
            {open ? `Clock out ${firstName}` : `Clock in ${firstName}`}
          </Text>
        </Pressable>
      ) : null}

      <Modal visible={!!mode} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{mode === 'in' ? `Clock in ${firstName} now?` : `Clock out ${firstName} now?`}</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              This is saved in the time history as your change, with the reason below. {firstName}'s phone updates within a minute.
            </Text>
            <View style={styles.chips}>
              {(mode === 'in' ? REASONS_IN : REASONS_OUT).map((r) => (
                <Pressable key={r} onPress={() => setReason(r)} accessibilityRole="button" style={[styles.chip, { backgroundColor: reason === r ? colors.primary : colors.backgroundTertiary }]}>
                  <Text style={[typeScale.labelSmall, { color: reason === r ? colors.textOnPrimary : colors.textPrimary }]}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <Input label="Reason" value={reason} onChangeText={setReason} placeholder="Why are you doing this?" containerStyle={{ marginTop: spacing.md }} />
            {error ? <Text style={[typeScale.bodySmall, { color: colors.error, marginTop: spacing.sm }]}>{error}</Text> : null}
            <View style={styles.actions}>
              <Button title="Cancel" variant="ghost" onPress={close} />
              <Button title={mode === 'in' ? 'Clock In' : 'Clock Out'} loading={busy} disabled={reason.trim().length < 3} onPress={confirm} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  dot: { width: 9, height: 9, borderRadius: 5 },
  button: { height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sheet: { width: '100%', maxWidth: 420, borderRadius: radius.xl, padding: spacing.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.lg },
});
