/**
 * Live board (Owner, from the dashboard's "View all"): the storm's routes in one small list, so you can see on the road what is open,
 * what is being worked and what is done. Read-only. Tap a route for its properties (SnowLiveRoute). Everything you BUILD (routes,
 * properties, crews) stays in the storm screen under Storms; this is only for looking.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, LoadingSpinner, ProgressBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useSnowDashboard } from '@/hooks/useSnowDashboard';
import { crewRows, pickActiveStorm, stormHeadline, type CrewRow } from '@/lib/snowDashboardView';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export function SnowLiveStorm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, storms, refreshing, onRefresh } = useSnowDashboard();
  const storm = storms.find((s) => s.id === id) ?? pickActiveStorm(storms);
  const rows = storm ? crewRows(storm) : [];
  const headline = storm ? stormHeadline(storm) : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} numberOfLines={1}>{storm?.name ?? 'Routes'}</Text>
          {headline ? <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{headline.summary}</Text> : null}
        </View>
      </View>

      {state.kind === 'loading' && !storm ? <LoadingSpinner /> : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {headline ? <ProgressBar progress={headline.percent} height={6} style={{ marginBottom: spacing.md }} /> : null}
          {rows.length === 0 ? (
            <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>No routes in this storm yet.</Text>
          ) : rows.map((r) => <RouteLine key={r.id} row={r} onPress={() => router.push({ pathname: '/snow/owner/live-route/[id]', params: { id: r.id } } as never)} />)}
          {storm ? (
            <Pressable onPress={() => router.push({ pathname: '/snow/owner/storm/[id]', params: { id: storm.id } } as never)} style={styles.edit} accessibilityRole="button">
              <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Open storm to edit routes and properties</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function RouteLine({ row, onPress }: { row: CrewRow; onPress: () => void }) {
  const { colors } = useTheme();
  const working = row.onSite;
  const pending = Math.max(0, row.remaining - working);
  const dot = row.status === 'completed' ? colors.success : row.status === 'in_progress' ? colors.primary : colors.textTertiary;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open route ${row.name}`} style={({ pressed }) => [styles.row, { backgroundColor: colors.surface }, pressed && { opacity: 0.7 }]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{row.name}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{row.leadLabel}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
          {pending} pending · {working} working · {row.completed} done{row.skipped ? ` · ${row.skipped} skipped` : ''}
        </Text>
      </View>
      <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{row.percent}%</Text>
      <Icon name="chevron-right" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  edit: { alignItems: 'center', paddingVertical: spacing.lg },
});
