import { DateStrip } from '@/components/ui/DateStrip';
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, PressableScale, ProgressBar, RaisedAddButton, ScreenHeader, StatusBadge } from '@/components/ui';
import { ROUTE_STATUS, SectionTitle, formatServiceDate } from '@/components/maintenance/ReviewBits';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useMaintenance } from '@/hooks/useMaintenance';
import { db } from '@/data/store';
import { buildRouteReview } from '@/data/maintenanceReview';
import { todayKey } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { MaintenanceRouteDetail } from '@/types/maintenance';

/** How many past routes show before older ones are cut off. */
const PAST_LIMIT = 30;

/** Owner: every daily route, today and upcoming first, then past ones. */
export default function RoutesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const tabBarClearance = useTabBarClearance();
  const m = useMaintenance();
  const today = todayKey();
  // Day cards: tap a day to see only that day's routes.
  const [day, setDay] = useState<string | null>(null);
  const days = useMemo(() => Array.from(new Set(m.routes.map((r) => r.serviceDate))).sort().reverse().slice(0, 14), [m.routes]);

  const { current, past, attentionById } = useMemo(() => {
    const attention: Record<string, number> = {};
    for (const r of m.routes) {
      if (r.serviceDate <= today) attention[r.id] = buildRouteReview(r, m.events, m.attendance, db.people, today).attention.length;
    }
    return {
      current: m.routes.filter((r) => r.serviceDate >= today && (!day || r.serviceDate === day)).slice().reverse(),
      past: m.routes.filter((r) => r.serviceDate < today && (!day || r.serviceDate === day)).slice(0, PAST_LIMIT),
      attentionById: attention,
    };
  }, [m, today, day]);

  const newRoute = () => router.push('/(owner)/route-new' as any);
  const open = (id: string) => router.push(`/(owner)/maintenance/routes/${id}` as any);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader
        title="Daily Routes"
        subtitle="Each day’s stops, crew and what got done"
        right={<RaisedAddButton onPress={newRoute} accessibilityLabel="New route" />}
      />
      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance + spacing['3xl'] }]}>
        {m.routes.length === 0 ? (
          <EmptyState
            icon="map"
            title="No routes yet"
            description="Create a route for the day: pick the properties that are due, put them in order, and assign the Maintenance Crew."
            actionTitle="New Route"
            onAction={newRoute}
          />
        ) : (
          <>
            <DateStrip dates={days} selected={day} onSelect={setDay} />
            <SectionTitle>TODAY AND UPCOMING</SectionTitle>
            {current.length === 0 ? (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginHorizontal: spacing.xs }]}>
                No route for today yet.
              </Text>
            ) : current.map((r) => <RouteCard key={r.id} route={r} today={today} attention={attentionById[r.id] ?? 0} onPress={() => open(r.id)} />)}
            {past.length > 0 && (
              <>
                <SectionTitle>PAST ROUTES</SectionTitle>
                {past.map((r) => <RouteCard key={r.id} route={r} today={today} attention={attentionById[r.id] ?? 0} onPress={() => open(r.id)} />)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function RouteCard({ route, today, attention, onPress }: {
  route: MaintenanceRouteDetail; today: string; attention: number; onPress: () => void;
}) {
  const { colors } = useTheme();
  const total = route.stops.length;
  const finished = route.stops.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const status = ROUTE_STATUS[route.status];
  const crew = route.crew.map((p) => p.firstName).join(', ');
  const title = formatServiceDate(route.serviceDate, { relative: true, today });
  const subtitle = [route.name, title !== formatServiceDate(route.serviceDate) ? formatServiceDate(route.serviceDate) : undefined]
    .filter(Boolean).join(' · ');
  return (
    <PressableScale
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}
      accessibilityRole="button"
      accessibilityLabel={`Route ${formatServiceDate(route.serviceDate)}, ${route.completedCount} of ${total} stops finished`}
    >
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
          )}
        </View>
        <StatusBadge label={status.label} status={status.status} />
      </View>
      <ProgressBar progress={total ? (finished / total) * 100 : 0} style={{ marginTop: spacing.sm }} />
      <View style={[styles.rowBetween, { marginTop: spacing.sm }]}>
        <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
          {route.completedCount} of {total} stop{total === 1 ? '' : 's'} finished
        </Text>
        {attention > 0 && (
          <View style={styles.inline}>
            <Icon name="alert-circle" size={14} color={colors.warning} />
            <Text style={[typeScale.caption, { color: colors.warning }]}>{attention} to review</Text>
          </View>
        )}
      </View>
      <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
        {crew ? `Crew: ${crew}` : 'No crew assigned'}
        {route.lead ? ` · Lead: ${route.lead.firstName}` : ''}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  card: { borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
