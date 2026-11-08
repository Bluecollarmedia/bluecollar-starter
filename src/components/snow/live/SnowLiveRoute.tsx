/**
 * One route, small (Owner, from the live board): every property as one tight line (name, address, service) so 10 to 15 fit on a screen.
 * Working first, then pending, then finished. Read-only; building or changing the route is in the storm screen under Storms.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, LoadingSpinner } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { loadRoute, type RouteDetail, type RouteStop } from '@/data/snowRoutes';
import { SERVICE_LABEL } from '@/data/snowStorms';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const ORDER: Record<RouteStop['status'], number> = { arrived: 0, pending: 1, skipped: 2, completed: 3 };

export function SnowLiveRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const r = await loadRoute(String(id));
    if (r.ok) { setRoute(r.data); setError(''); } else setError(r.error);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const stops = useMemo(
    () => [...(route?.stops ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.position - b.position),
    [route],
  );
  const working = stops.filter((s) => s.status === 'arrived').length;
  const pending = stops.filter((s) => s.status === 'pending').length;
  const done = stops.filter((s) => s.status === 'completed').length;
  const skipped = stops.filter((s) => s.status === 'skipped').length;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} numberOfLines={1}>{route?.name ?? 'Route'}</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
            {route ? `${pending} pending · ${working} working · ${done} done${skipped ? ` · ${skipped} skipped` : ''}` : ' '}
          </Text>
        </View>
      </View>

      {!route && !error ? <LoadingSpinner /> : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        >
          {error ? <Text style={[typeScale.bodyMedium, { color: colors.error }]}>{error}</Text> : null}
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {stops.map((s, i) => {
              const finished = s.status === 'completed' || s.status === 'skipped';
              const dot = s.status === 'arrived' ? colors.primary : s.status === 'completed' ? colors.success : s.status === 'skipped' ? colors.warning : colors.textTertiary;
              const svc = s.service ? (s.service === 'shoveling' ? 'Sidewalks' : SERVICE_LABEL[s.service]) : '';
              return (
                <View key={s.id} style={[styles.line, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                  <View style={[styles.dot, { backgroundColor: dot }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodySmall, { color: finished ? colors.textTertiary : colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{s.propertyName}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{s.propertyAddress}</Text>
                  </View>
                  {svc ? <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{svc}</Text> : null}
                </View>
              );
            })}
            {stops.length === 0 && route ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, padding: spacing.md }]}>No properties on this route yet.</Text> : null}
          </View>
          {route ? (
            <Pressable onPress={() => router.push({ pathname: '/snow/owner/storm/[id]', params: { id: route.stormId } } as never)} style={styles.edit} accessibilityRole="button">
              <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Open storm to edit this route</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  card: { borderRadius: radius.md, overflow: 'hidden' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, paddingHorizontal: spacing.md, minHeight: 44 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  edit: { alignItems: 'center', paddingVertical: spacing.lg },
});
