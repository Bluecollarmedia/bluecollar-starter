import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, PressableScale, ScreenHeader, StatusBadge } from '@/components/ui';
import { Pill, STOP_STATUS, SectionTitle, formatServiceDate } from '@/components/maintenance/ReviewBits';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useMaintenance, useMaintenanceProperty } from '@/hooks/useMaintenance';
import { db } from '@/data/store';
import { loadPropertyVisits } from '@/data/maintenanceLabor';
import { compareToUsual, hoursText, minutesText, seasonSummary, type VisitRecord } from '@/lib/propertyTrend';
import { buildRouteReview, formatTime } from '@/data/maintenanceReview';
import { dueLabel } from '@/lib/maintenanceSchedule';
import { todayKey } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { MaintenanceServiceRule, ServiceDueInfo } from '@/types/maintenance';

/** How many visits show before "Show all". */
const VISIT_PREVIEW = 10;

function frequencyLabel(r: MaintenanceServiceRule): string {
  switch (r.frequency) {
    case 'weekly': return 'Every week';
    case 'biweekly': return 'Every other week';
    case 'every_n_days': return r.intervalDays ? `Every ${r.intervalDays} days` : 'Repeat not set';
    case 'seasonal_window': return r.windowStart && r.windowEnd
      ? `Once, ${formatServiceDate(r.windowStart)} – ${formatServiceDate(r.windowEnd)}`
      : 'Once a season';
    case 'fixed_dates': return r.scheduledDates?.length ? `${r.scheduledDates.length} visits on set dates` : 'Visit dates not set';
    case 'as_needed': return 'As needed';
  }
}

function dueTone(s: ServiceDueInfo['status']): 'error' | 'warning' | 'success' | 'neutral' {
  if (s === 'overdue') return 'error';
  if (s === 'due') return 'warning';
  if (s === 'done_for_season') return 'success';
  return 'neutral';
}

/**
 * Owner: one property's maintenance history. Each contracted service with its
 * last service date and season count, then every visit (newest first) with
 * services, instructions, checklist, photos and who arrived / finished.
 */
export default function PropertyHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const tabBarClearance = useTabBarClearance();
  const today = todayKey();
  const detail = useMaintenanceProperty(id, today);
  const m = useMaintenance();
  const [showAll, setShowAll] = useState(false);
  // Saved arrival / completion, elapsed time and ESTIMATED labor-hours per visit (owner only; update 68). Null = not installed yet.
  const [labor, setLabor] = useState<VisitRecord[] | null>(null);
  useEffect(() => { if (id) loadPropertyVisits(id).then(setLabor); }, [id, detail?.visits.length]);
  const laborByStop = useMemo(() => new Map((labor ?? []).map((l) => [l.stopId, l])), [labor]);
  const season = useMemo(() => (labor ? seasonSummary(labor) : null), [labor]);

  const visits = useMemo(() => {
    if (!detail) return [];
    return detail.visits
      .map((stop) => {
        const route = m.routeById[stop.routeId];
        const review = route ? buildRouteReview(route, m.events, m.attendance, db.people, today).stops.find((s) => s.stop.id === stop.id) : undefined;
        return { stop, route, review };
      })
      .filter((v) => v.route && v.route.status !== 'cancelled');
  }, [detail, m, today]);

  if (!detail) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
        <ScreenHeader title="Service History" />
        <EmptyState icon="home" title="Property not found" description="It may have been removed." actionTitle="Go Back" onAction={() => router.back()} />
      </View>
    );
  }

  const { property, activeContract } = detail;
  const shown = showAll ? visits : visits.slice(0, VISIT_PREVIEW);
  const customer = property.customer;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title={property.name} subtitle={[property.address, property.city, property.state].filter(Boolean).join(', ')} />
      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance + spacing['3xl'] }]}>
        <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, { gap: spacing.xs }]}>
          <View style={styles.rowBetween}>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
              {activeContract ? activeContract.name : 'No active contract'}
            </Text>
            <StatusBadge label={property.isActive ? 'Active' : 'Inactive'} status={property.isActive ? 'success' : 'neutral'} />
          </View>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>
            Last service: {detail.due.lastServiceDate ? formatServiceDate(detail.due.lastServiceDate) : 'none recorded'}
          </Text>
          {customer && (
            <Pressable onPress={() => router.push(`/(owner)/customers/${customer.id}` as any)} hitSlop={6} accessibilityRole="button" style={styles.inline}>
              <Icon name="user" size={14} color={colors.primary} />
              <Text style={[typeScale.bodySmall, { color: colors.primary }]}>{customer.firstName} {customer.lastName}</Text>
            </Pressable>
          )}
          {property.accessNotes ? (
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Access: {property.accessNotes}</Text>
          ) : null}
        </View>

        {season && season.visits > 0 ? (
          <>
            <SectionTitle>TIME ON SITE</SectionTitle>
            <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, { gap: spacing.xs }]}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>
                {season.visits} timed visit{season.visits === 1 ? '' : 's'} · usually {minutesText(season.averageElapsedMinutes)} on site
              </Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                Estimated labor-hours: about {hoursText(season.averageLaborMinutes)} per visit, {hoursText(season.totalLaborMinutes)} so far.
              </Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                Time on site = the leader's arrival to completion. Estimated labor-hours = each assigned worker's own clocked-in time during the visit, added up. It is an estimate for spotting trends, not payroll.
              </Text>
            </View>
          </>
        ) : null}

        <SectionTitle>SERVICES</SectionTitle>
        <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, { paddingVertical: spacing.xs }]}>
          {detail.due.services.length === 0 ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, paddingVertical: spacing.md }]}>
              {activeContract ? 'No services on this contract yet.' : 'No active contract, so nothing is due.'}
            </Text>
          ) : detail.due.services.map((s, i) => (
            <View key={s.rule.id} style={[styles.serviceRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{s.rule.label}</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{frequencyLabel(s.rule)}</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                  Last: {s.lastServiceDate ? formatServiceDate(s.lastServiceDate) : 'never'}
                  {' · '}
                  {s.rule.seasonQuantity ? `${s.completedCount} of ${s.rule.seasonQuantity} done` : `${s.completedCount} done`}
                  {s.remainingCount != null ? `, ${s.remainingCount} left` : ''}
                </Text>
                {s.rule.priorCompletedCount > 0 && (
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                    Includes {s.rule.priorCompletedCount} done before the app
                  </Text>
                )}
              </View>
              <Pill label={dueLabel(s, today)} tone={dueTone(s.status)} />
            </View>
          ))}
        </View>

        <SectionTitle
          right={visits.length > VISIT_PREVIEW ? (
            <Pressable onPress={() => setShowAll((x) => !x)} hitSlop={8} accessibilityRole="button">
              <Text style={[typeScale.labelSmall, { color: colors.primary }]}>{showAll ? 'Show less' : `Show all ${visits.length}`}</Text>
            </Pressable>
          ) : undefined}
        >
          {`VISITS (${visits.length})`}
        </SectionTitle>
        {visits.length === 0 ? (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginHorizontal: spacing.xs }]}>
            No visits yet. Visits show here once the property is on a route.
          </Text>
        ) : shown.map(({ stop, route, review }) => {
          const st = STOP_STATUS[stop.status];
          const arrival = review?.arrival;
          const completion = review?.completion;
          return (
            <PressableScale
              key={stop.id}
              onPress={() => router.push(`/(owner)/maintenance/routes/${stop.routeId}` as any)}
              style={[styles.card, styles.visit, { backgroundColor: colors.surface }, shadow.sm]}
              accessibilityRole="button"
              accessibilityLabel={`Visit ${formatServiceDate(route!.serviceDate)}, ${st.label}. Opens the route.`}
            >
              <View style={styles.rowBetween}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>
                  {formatServiceDate(route!.serviceDate, { relative: true, today })}
                </Text>
                <StatusBadge label={st.label} status={st.status} />
              </View>
              {stop.services.length > 0 && (
                <View style={styles.chips}>
                  {stop.services.map((s) => <Pill key={s.id} label={s.label} tone={s.completed ? 'success' : 'neutral'} />)}
                </View>
              )}
              {stop.instructions ? (
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>Instructions: {stop.instructions}</Text>
              ) : null}
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                {arrival?.at ? `Arrived ${formatTime(arrival.correction?.at ?? arrival.at)}${arrival.by ? ` (${arrival.by.firstName})` : ''}` : stop.status === 'pending' ? 'Not started yet' : 'No arrival recorded'}
                {completion?.at ? ` · Finished ${formatTime(completion.correction?.at ?? completion.at)}${completion.by ? ` (${completion.by.firstName})` : ''}` : ''}
                {(arrival?.correction || completion?.correction) ? ' · corrected by owner' : ''}
              </Text>
              {laborByStop.get(stop.id)?.elapsedMinutes != null ? (() => {
                const l = laborByStop.get(stop.id)!;
                const cmp = labor ? compareToUsual(labor, stop.id) : null;
                return (
                  <View style={{ gap: 2 }}>
                    <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                      On site {minutesText(l.elapsedMinutes)} · Estimated labor {hoursText(l.estLaborMinutes)}
                      {l.crew.length ? ` (${l.crew.map((c) => `${c.name.split(' ')[0]} ${minutesText(c.minutes)}`).join(', ')})` : ''}
                    </Text>
                    {cmp ? (
                      <Text style={[typeScale.caption, { color: cmp.unusual ? colors.warning : colors.textSecondary }]}>
                        {cmp.unusual ? 'Longer than usual: ' : 'Compared with usual: '}
                        {cmp.differenceMinutes >= 0 ? '+' : '−'}{minutesText(Math.abs(cmp.differenceMinutes))} vs about {minutesText(cmp.usualMinutes)}
                      </Text>
                    ) : null}
                  </View>
                );
              })() : null}
              {(stop.tasks.length > 0 || stop.photos.length > 0 || stop.requiresPhotos) && (
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                  {stop.tasks.length > 0 ? `Checklist ${review?.tasksDone ?? 0}/${stop.tasks.length}` : ''}
                  {stop.tasks.length > 0 && (stop.photos.length > 0 || stop.requiresPhotos) ? ' · ' : ''}
                  {stop.photos.length > 0 || stop.requiresPhotos ? `${stop.photos.length} photo${stop.photos.length === 1 ? '' : 's'}${stop.requiresPhotos ? ` (${stop.minPhotos} required)` : ''}` : ''}
                </Text>
              )}
              {stop.status === 'skipped' && stop.skipReason ? (
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Skipped: {stop.skipReason}</Text>
              ) : null}
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  card: { borderRadius: radius.md, padding: spacing.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  visit: { marginBottom: spacing.md, gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
