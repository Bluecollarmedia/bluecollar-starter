import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { loadReviewList, settleNoHours, sourceText, type ReviewDay } from '@/data/timeReview';
import { confirmAction } from '@/components/financials/ActionSheet';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * "Needs your OK": days a worker never clocked out of. They count for no hours until the owner decides. Each row says when the worker
 * probably stopped (the database's suggestion) with an Edit button that opens the day to set the end time ("Set time" when it can't tell). Hidden when nothing is waiting.
 */
export function NeedsOkCard() {
  const { colors } = useTheme();
  const router = useRouter();
  const [days, setDays] = useState<ReviewDay[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await loadReviewList();
    if (r.ok) { setDays(r.data); setError(''); } else if (!r.notInstalled) setError(r.error);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (days.length === 0 && !error) return null;

  function noHours(d: ReviewDay) {
    confirmAction(`No hours for ${d.name}?`, `${dayOf(d.clockInAt)} counts as zero hours and leaves this list. It stays in the time history.`, 'No hours', async () => {
      setBusy(d.workdayId);
      setError('');
      const r = await settleNoHours(d.workdayId);
      setBusy(null);
      if (!r.ok) { setError(r.error); haptics.warning(); return; }
      haptics.success();
      load();
    });
  }
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.warning }, shadow.sm]}>
      <View style={styles.head}>
        <Feather name="clock" size={18} color={colors.warning} />
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>Needs your OK</Text>
      </View>
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
        These days closed on their own. They count as zero hours until you set an end time.
      </Text>
      {days.map((d) => (
        <View key={d.workdayId} style={[styles.row, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{d.name} · {dayOf(d.clockInAt)}</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
              {d.suggestedEndAt
                ? `${timeOf(d.clockInAt)} to ${timeOf(d.suggestedEndAt)} (${sourceText(d.suggestionSource)})`
                : `Clocked in ${timeOf(d.clockInAt)}. No end time to suggest.`}
            </Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={() => router.push({ pathname: '/(owner)/more/labor-day', params: { id: d.workdayId } } as never)}
              accessibilityRole="button"
              accessibilityLabel={`Set the end time for ${d.name}`}
              hitSlop={8}
              style={[styles.edit, { borderColor: colors.border }]}
            >
              <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>{d.suggestedEndAt ? 'Edit' : 'Set time'}</Text>
            </Pressable>
            <Pressable onPress={() => noHours(d)} accessibilityRole="button" accessibilityLabel={`No hours for ${d.name}`} hitSlop={8} style={[styles.edit, { borderColor: colors.border }]}>
              <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>No hours</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {error ? <Text style={[typeScale.bodySmall, { color: colors.error, marginTop: spacing.sm }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { paddingTop: spacing.md, marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  edit: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1 },
});
