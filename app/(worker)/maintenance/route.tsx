import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { useDayWork } from '@/hooks/useDayWork';
import { useT } from '@/i18n';
import { ScreenContainer } from '@/components/layout';
import { EmptyState } from '@/components/ui';
import { RouteMap } from '@/components/maps/RouteMap';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

/**
 * The Route tab: today's stops on one map with numbered pins (Today is the list of work, so this is the picture of the day), then each
 * route's crew, leader and route notes. A worker on several routes sees every route's stops on the same map.
 */
export default function MaintenanceRouteScreen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const day = useDayWork();
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const stops = day.stops.map((s, i) => ({ id: s.stop.id, number: i + 1, place: s.stop.property ?? {}, done: s.done }));
  const placeable = stops.filter((s) => s.place && Object.keys(s.place).length > 0);
  // How the day is going: stops finished (or skipped) out of all of today's stops, across every route the worker is on.
  const total = day.stops.length;
  const finished = day.stops.filter((s) => s.done).length;
  const progressLabel = total === 1 ? t('{done} of 1 stop done', { done: finished }) : t('{done} of {total} stops done', { done: finished, total });

  return (
    <ScreenContainer scrollable padded variant="grouped">
      <View style={{ paddingTop: insets.top + spacing.md, marginBottom: spacing.lg }}>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Route')}</Text>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{dateStr}</Text>
      </View>

      {total > 0 ? (
        <View style={[styles.progress, { backgroundColor: colors.surface }, shadow.sm]} accessible accessibilityLabel={progressLabel}>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{progressLabel}</Text>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View style={[styles.fill, { backgroundColor: colors.primary, width: `${Math.round((finished / total) * 100)}%` }]} />
          </View>
        </View>
      ) : null}

      {day.routes.length === 0 ? (
        <EmptyState icon="map" title={t('No route today')} description={t('When the owner puts you on a maintenance route, its stops show up here on the map.')} />
      ) : (
        <>
          {placeable.length > 0 ? <RouteMap stops={placeable} height={320} /> : (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{t("This route doesn't have any stops yet.")}</Text>
          )}
          {day.routes.map((route) => (
            <View key={route.id} style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
              {day.routes.length > 1 ? <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.xs }]}>{route.name || t('Route')}</Text> : null}
              <View style={styles.metaRow}>
                <Feather name="users" size={13} color={colors.textTertiary} />
                <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textSecondary }]} numberOfLines={2}>
                  {route.crew.map((p) => `${p.firstName} ${p.lastName}`.trim()).join(', ') || t('No crew assigned')}
                </Text>
              </View>
              {route.lead ? (
                <View style={styles.metaRow}>
                  <Feather name="star" size={13} color={colors.textTertiary} />
                  <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textSecondary }]}>
                    {t('Lead: {name}', { name: `${route.lead.firstName} ${route.lead.lastName}` })}
                  </Text>
                </View>
              ) : null}
              {route.notes ? (
                <View style={[styles.note, { backgroundColor: colors.backgroundSecondary }]}>
                  <Feather name="file-text" size={14} color={colors.textSecondary} />
                  <Text style={[typeScale.bodySmall, styles.metaText, { color: colors.textPrimary, flex: 1 }]}>{route.notes}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  progress: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.lg },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: spacing.sm },
  fill: { height: '100%', borderRadius: 4 },
  card: { borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.lg },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  metaText: { marginLeft: spacing.xs, flexShrink: 1 },
  note: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.sm },
});
