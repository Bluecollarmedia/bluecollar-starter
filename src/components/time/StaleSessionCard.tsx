/**
 * The ONE card shown, on every clock (the workday clock and the Snow clock), when a worker never clocked out of an earlier day.
 * It blocks nothing: today's Clock In, route and timer work normally underneath. The worker says when they really stopped (or that
 * they are not sure); that is only SAVED for the owner, who sets the real end time. The old time is kept, counts as zero hours
 * until then, and no end time is ever invented.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { stopTimeChoices } from '@/lib/clockSession';
import { useT } from '@/i18n';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export interface StaleSession {
  id: string;
  clockInAt: string;
  /** What the worker already said (empty = not answered yet, or "not sure"). */
  claimedOutAt?: string;
  claimNote?: string;
  /** True once the worker has answered at all (a time, or "not sure"). */
  answered: boolean;
}

const dayAndTime = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function StaleSessionCard({ session, busy, nowMs, onAnswer, error }: {
  session: StaleSession;
  busy: boolean;
  nowMs: number;
  /** stoppedAtIso = null means "I'm not sure". */
  onAnswer: (stoppedAtIso: string | null) => void | Promise<unknown>;
  error?: string | null;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const choices = useMemo(() => stopTimeChoices(session.clockInAt, nowMs).reverse(), [session.clockInAt, nowMs]);

  async function pick(iso: string | null) {
    setOpen(false);
    await onAnswer(iso);
  }

  // The same sentences as lib/clockSession, with the Spanish for them.
  const headline = t("You didn't clock out on {day}", { day: new Date(session.clockInAt).toLocaleDateString('en-US', { weekday: 'long' }) });
  const detail = t("You clocked in {when} and never clocked out. It counts as zero hours until your boss sets the real end time. Tell them when you stopped; today's work is not affected.", { when: dayAndTime(session.clockInAt) });
  const said = session.claimedOutAt ? t('You said you stopped {when}.', { when: dayAndTime(session.claimedOutAt) }) : t('You said you are not sure when you stopped.');
  const answered = `${said}${session.claimNote ? ` "${session.claimNote}"` : ''} ${t('Your boss will set the real end time.')}`;

  return (
    <View style={[styles.card, { backgroundColor: colors.warningLight, borderColor: colors.warning }]} accessibilityRole="alert">
      <View style={styles.head}>
        <Feather name="alert-circle" size={18} color={colors.warning} />
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>{headline}</Text>
      </View>
      {session.answered ? (
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{answered}</Text>
      ) : (
        <>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{detail}</Text>
          <View style={styles.actions}>
            <Pressable onPress={() => setOpen(true)} disabled={busy} style={[styles.btn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]} accessibilityRole="button">
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>{t('I stopped at…')}</Text>}
            </Pressable>
            <Pressable onPress={() => pick(null)} disabled={busy} style={[styles.btn, { borderColor: colors.border, borderWidth: 1, opacity: busy ? 0.6 : 1 }]} accessibilityRole="button">
              <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{t("I'm not sure")}</Text>
            </Pressable>
          </View>
        </>
      )}
      {error ? <Text style={[typeScale.caption, { color: colors.error }]}>{error}</Text> : null}

      <BottomSheetModal visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center' }]}>{t('When did you stop?')}</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md }]}>
              {t('This is only sent to your boss. They set the real time.')}
            </Text>
            <ScrollView bounces={false} style={{ maxHeight: 360 }}>
              {choices.length === 0 ? (
                <Text style={[typeScale.bodySmall, { color: colors.textTertiary, textAlign: 'center', padding: spacing.lg }]}>{t('No times to choose from.')}</Text>
              ) : choices.map((c) => (
                <Pressable key={c.iso} onPress={() => pick(c.iso)} style={[styles.row, { borderColor: colors.borderLight }]} accessibilityRole="button">
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable onPress={() => pick(null)} style={[styles.row, { borderColor: colors.borderLight }]} accessibilityRole="button">
              <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{t("I'm not sure")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  btn: { flex: 1, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing['3xl'] },
  row: { minHeight: 52, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
