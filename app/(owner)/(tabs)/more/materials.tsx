/**
 * Owner → More → Materials: which upcoming jobs need materials ordered,
 * prepared or picked up. An overview of each project's own checklist (the
 * same records); tapping a job opens its full checklist in the project.
 */

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader, EmptyState, LoadingSpinner, ProgressBar, StatusBadge } from '@/components/ui';
import { formatReminder } from '@/components/materials/ReminderSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { db, useDb } from '@/data/store';
import { materialsOverview, MATERIAL_STATUS_LABEL } from '@/data/materials';
import { formatDocDate } from '@/lib/documentHtml';
import { formatQuantity } from '@/lib/money';
import { offsetDateKey } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

export default function MaterialsOverviewScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const clearance = useTabBarClearance();
  const v = useDb();
  const rows = useMemo(() => materialsOverview(), [v]);
  const soonKey = offsetDateKey(3);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title="Materials" subtitle="Jobs that need materials ordered or picked up, soonest first." />

      <ScrollView bounces={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: clearance + spacing['2xl'], gap: spacing.md }}>
        {!db.ready ? (
          <LoadingSpinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title="No materials to prepare"
            description="When a quote is approved, its job shows up here. Add materials from the project’s More → Materials."
          />
        ) : rows.map((r) => {
          const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
          const soon = r.nextJob && r.outstanding.length > 0 && r.nextJob <= soonKey;
          return (
            <Pressable
              key={r.project.id}
              onPress={() => router.push(`/(owner)/projects/${r.project.id}?section=materials` as any)}
              style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.backgroundSecondary : colors.surface }, shadow.sm]}
              accessibilityRole="button"
              accessibilityLabel={`Open materials for ${r.project.name}`}
            >
              <View style={styles.head}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]} numberOfLines={1}>{r.project.name}</Text>
                  {!!r.project.address && <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{r.project.address}</Text>}
                </View>
                {r.nextJob
                  ? <StatusBadge label={`Job ${formatDocDate(r.nextJob).replace(/, \d{4}$/, '')}`} status={soon ? 'warning' : 'neutral'} />
                  : <StatusBadge label="Not scheduled" status="neutral" />}
              </View>

              {r.total > 0 ? (
                <>
                  <View style={styles.progressRow}>
                    <ProgressBar progress={pct} height={6} style={{ flex: 1 }} />
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{r.done}/{r.total} ready</Text>
                  </View>
                  {r.outstanding.slice(0, 3).map((m) => (
                    <Text key={m.id} style={[typeScale.bodySmall, { color: colors.textPrimary }]} numberOfLines={1}>
                      • {m.name}{m.quantity != null ? ` (${formatQuantity(m.quantity)}${m.unit ? ` ${m.unit}` : ''})` : ' (quantity needed)'}
                      <Text style={{ color: colors.textSecondary }}>  {MATERIAL_STATUS_LABEL[m.status]}</Text>
                    </Text>
                  ))}
                  {r.outstanding.length > 3 && (
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>+ {r.outstanding.length - 3} more to prepare</Text>
                  )}
                </>
              ) : (
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>No checklist yet.</Text>
              )}
              {r.newSuggestions > 0 && (
                <Text style={[typeScale.caption, { color: colors.primaryDark, marginTop: spacing.xs }]}>
                  {r.newSuggestions} suggested from approved work
                </Text>
              )}

              <View style={[styles.foot, { borderTopColor: colors.separator }]}>
                <Meta icon="bell" text={r.reminderAt ? formatReminder(r.reminderAt) : 'No reminder'} warn={!!r.reminderProblem} />
                {(r.vendor || r.pickupLocation) && <Meta icon="truck" text={r.vendor?.name ?? r.pickupLocation!} />}
              </View>
              {!!r.reminderProblem && (
                <Text style={[typeScale.caption, { color: colors.error, marginTop: 4 }]}>{r.reminderProblem}</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Meta({ icon, text, warn }: { icon: 'bell' | 'truck'; text: string; warn?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.meta}>
      <Icon name={icon} size={13} color={warn ? colors.error : colors.textTertiary} />
      <Text style={[typeScale.caption, { color: warn ? colors.error : colors.textSecondary, flexShrink: 1 }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderRadius: radius.xl, padding: spacing.md, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  foot: { flexDirection: 'row', gap: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, marginTop: spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
});
