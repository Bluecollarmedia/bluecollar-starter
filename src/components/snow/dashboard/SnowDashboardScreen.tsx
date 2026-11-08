/**
 * Snow Mode Dashboard (Owner): the active storm's overall progress, then each crew's progress, then Needs Attention
 * and any other storms. Data comes from useSnowDashboard (src/data/snowDashboard.ts); the numbers shown are the
 * app's own (see src/lib/snowDashboardView.ts, which only picks and shapes them). Nothing here changes a record.
 */
import { AdminSnowRouteCard } from './AdminSnowRouteCard';
import { servicesLabel, stormServices } from '@/lib/snowServices';
import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Icon, InlineNotice, LoadingSpinner, ProgressBar, StatusBadge } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useSnowDashboard } from '@/hooks/useSnowDashboard';
import { SERVICE_LABEL } from '@/data/snowStorms';
import type { AttentionItem, StormOverview } from '@/data/snowDashboard';
import { snowDashboardHref } from '@/lib/snowLinks';
import {
  dispatchedLabel, openCrewRows, runningStorms, stopsCompleteLabel, stormHeadline, type CrewRow, type CrewStatus, type StormHeadline,
} from '@/lib/snowDashboardView';
import { WeatherButton } from '@/components/weather/WeatherButton';
import { snowStatus } from '@/theme/colors';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const ATTENTION_ICON: Record<AttentionItem['kind'], React.ComponentProps<typeof Icon>['name']> = {
  skip_request: 'flag',
  missing_media: 'camera-off',
  route_without_lead: 'user-x',
  media_review: 'camera',
  open_shift: 'clock',
};

/** Restrained status colours from the Snow palette: neutral until work starts, blue while working, green when done. */
const STATUS_TONE: Record<CrewStatus, { fg: string; bg: string }> = {
  planned: snowStatus.scheduled,
  not_started: snowStatus.scheduled,
  in_progress: snowStatus.dispatched,
  completed: snowStatus.completed,
  empty: snowStatus.scheduled,
};

function Pill({ label, tone, onDark }: { label: string; tone: { fg: string; bg: string }; onDark?: boolean }) {
  return (
    <View style={[styles.pill, { backgroundColor: onDark ? 'rgba(255,255,255,0.18)' : tone.bg }]}>
      <View style={[styles.pillDot, { backgroundColor: onDark ? '#FFFFFF' : tone.fg }]} />
      <Text style={[typeScale.labelSmall, { color: onDark ? '#FFFFFF' : tone.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function SnowDashboardScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { state, storms, needsAttention, refreshing, onRefresh, reload } = useSnowDashboard();

  const running = runningStorms(storms);
  const active = running[0];
  const headline = active ? stormHeadline(active) : undefined;
  const others = running.slice(1);

  const header = (
    <>
      <View style={styles.topRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <WeatherButton to="/snow/owner/weather" />
          <View style={styles.modeChip}>
            <Icon name="cloud-snow" size={15} color={colors.primary} />
            <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Snow Mode</Text>
          </View>
        </View>
        {headline ? <Pill label={headline.badgeLabel} tone={headline.dispatched ? snowStatus.dispatched : snowStatus.scheduled} /> : null}
      </View>
      <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.xs }]}>Storm Dashboard</Text>
      <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: 2 }]}>
        {active ? dispatchedLabel(active.dispatchedAt, headline!.dispatched) : 'Manage and track your storms'}
      </Text>
    </>
  );

  const contentStyle = { paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: tabBarClearance + spacing.lg };

  if (state.kind === 'loading' || state.kind === 'unavailable') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
        <View style={contentStyle}>
          {header}
          {state.kind === 'loading'
            ? <LoadingSpinner />
            : <EmptyState icon="cloud-snow" title="Snow data isn't available" description={state.reason} />}
        </View>
      </View>
    );
  }

  const openStorm = (stormId: string) => router.push(snowDashboardHref({ kind: 'storm', stormId }));
  const openRoute = (stormId: string, routeId: string) => router.push(snowDashboardHref({ kind: 'route', stormId, routeId }));

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView
        contentContainerStyle={contentStyle}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {header}
        <AdminSnowRouteCard />
        {state.kind === 'error' && (
          <Pressable onPress={reload} accessibilityRole="button" accessibilityLabel="Couldn't refresh. Tap to try again">
            <InlineNotice icon="alert-circle" tone="error" text={`Couldn't refresh: ${state.message}. Tap to try again.`} style={{ marginTop: spacing.md }} />
          </Pressable>
        )}

        {active && headline ? (
          <>
            <ActiveStormCard storm={active} headline={headline} />
            <CrewsSection storm={active} headline={headline} onOpenStorm={() => openStorm(active.id)} onViewAll={() => router.push({ pathname: '/snow/owner/live/[id]', params: { id: active.id } } as never)} />
          </>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface, alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg }]}>
            <Icon name="cloud-snow" size={22} color={colors.textTertiary} />
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>No storm is running right now. Past and planned storms are on the Storms tab.</Text>
            <Button title="New storm" icon="plus" size="sm" onPress={() => router.push('/snow/owner/storm-new')} />
          </View>
        )}

        {/* Only shown when something really needs you (for example a shift left open for hours); an empty list is just noise.
            Worker hours live in More > Snow hours. */}
        {needsAttention.length > 0 ? (
          <>
            <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>
              Needs attention ({needsAttention.length})
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, paddingVertical: 0 }]}>
              {needsAttention.map((item, i) => (
                <Pressable
                  key={item.key}
                  onPress={() => router.push(snowDashboardHref(item.target))}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}. ${item.detail}`}
                >
                  <Icon name={ATTENTION_ICON[item.kind]} size={18} color={colors.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{item.title}</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{item.detail}</Text>
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {others.length > 0 && (
          <>
            <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>
              Other running storms
            </Text>
            {others.map((s) => (
              <OtherStormCard key={s.id} storm={s} onOpenStorm={() => openStorm(s.id)} onOpenRoute={(routeId) => openRoute(s.id, routeId)} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** The whole-storm picture: name, services, status, the four numbers, one bar and a sentence. */
/** Read-only: the dashboard has one way into the storm ("View all" under Routes), so the card itself doesn't navigate. */
function ActiveStormCard({ storm, headline }: { storm: StormOverview; headline: StormHeadline }) {
  const { colors } = useTheme();
  const services = servicesLabel(stormServices(storm), (x) => SERVICE_LABEL[x]);
  const stateTone = headline.stateLabel === 'Completed' ? snowStatus.completed : headline.stateLabel === 'In Progress' ? snowStatus.dispatched : snowStatus.scheduled;
  return (
    <View style={[styles.heroCard, { backgroundColor: colors.surface }]}>
      <View style={[styles.heroBand, { backgroundColor: colors.primaryDark }]}>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingLarge, { color: '#FFFFFF' }]} numberOfLines={2}>{storm.name}</Text>
          <Text style={[typeScale.bodyMedium, { color: 'rgba(255,255,255,0.85)', marginTop: 2 }]} numberOfLines={1}>
            {services}
            {storm.reopenedCount > 0 ? ` · Reopened${storm.reopenedCount > 1 ? ` ${storm.reopenedCount}×` : ''}` : ''}
          </Text>
        </View>
        <Pill label={headline.stateLabel} tone={stateTone} onDark />
      </View>
      <View style={styles.heroBody}>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} accessibilityRole="summary">{stopsCompleteLabel(storm)}</Text>
        <ProgressBar progress={headline.percent} height={10} style={{ marginTop: spacing.sm }} />
        {storm.skipped > 0 ? (
          <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>{storm.skipped} skipped (counted as done)</Text>
        ) : null}
        {storm.attentionCount > 0 ? (
          <Text style={[typeScale.caption, { color: colors.warning, marginTop: 2 }]}>
            {storm.attentionCount} need{storm.attentionCount === 1 ? 's' : ''} attention
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function CrewsSection({ storm, headline, onOpenStorm, onViewAll }: {
  storm: StormOverview; headline: StormHeadline; onOpenStorm: () => void; onViewAll: () => void;
}) {
  const { colors } = useTheme();
  const rows = openCrewRows(storm);
  const allDone = rows.length === 0 && storm.total > 0;
  return (
    <>
      <View style={styles.sectionHead}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>Routes</Text>
        {rows.length > 0 ? (
          <Pressable onPress={onViewAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="View all routes" style={styles.viewAll}>
            <Text style={[typeScale.labelLarge, { color: colors.primary }]}>View all</Text>
            <Icon name="chevron-right" size={16} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {rows.length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>
            {allDone ? 'Every route is finished.' : 'No properties in this storm yet. Open the storm to add properties and crews.'}
          </Text>
          {allDone ? null : <Button title="Open storm" icon="chevron-right" size="sm" variant="secondary" onPress={onOpenStorm} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />}
        </View>
      ) : (
        <>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
            Each route's progress. Tap View all to open them.
          </Text>
          <View style={{ gap: spacing.sm }}>
            {rows.map((r) => <CrewRowView key={r.id} row={r} />)}
          </View>
          {headline.cancelledRoutes > 0 ? (
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs, marginLeft: spacing.sm }]}>
              {headline.cancelledRoutes} cancelled route{headline.cancelledRoutes === 1 ? ' isn’t' : 's aren’t'} counted.
            </Text>
          ) : null}
        </>
      )}
    </>
  );
}

/** Read-only progress for one route; the way in is "View all" in the Routes header. */
function CrewRowView({ row }: { row: CrewRow }) {
  const { colors } = useTheme();
  const tone = STATUS_TONE[row.status];
  const count = row.total ? `${row.completed} / ${row.total}` : '0 stops';
  return (
    <View
      accessible
      accessibilityLabel={`${row.name}. ${row.leadLabel}. ${row.completed} of ${row.total} stops, ${row.percent} percent. ${row.statusLabel}`}
      style={[styles.crewRow, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primarySurface }]}>
        <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{row.initials}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.crewTop}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flex: 1 }]} numberOfLines={1}>{row.name}</Text>
          <Pill label={row.statusLabel} tone={tone} />
        </View>
        <View style={styles.crewTop}>
          <Text style={[typeScale.caption, { color: colors.textSecondary, flex: 1 }]} numberOfLines={1}>{row.leadLabel}</Text>
          <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>{count}{row.total ? `  ·  ${row.percent}%` : ''}</Text>
        </View>
        <ProgressBar progress={row.percent} height={6} />
        {row.skipped > 0 ? (
          <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{row.skipped} skipped</Text>
        ) : null}
      </View>
    </View>
  );
}

/** Any storm besides the active one: the existing compact card, with its routes. */
function OtherStormCard({ storm, onOpenStorm, onOpenRoute }: { storm: StormOverview; onOpenStorm: () => void; onOpenRoute: (routeId: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, marginBottom: spacing.md }]}>
      <Pressable onPress={onOpenStorm} accessibilityRole="button" accessibilityLabel={`Open ${storm.name}`} style={styles.stormHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{storm.name}</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
            {servicesLabel(stormServices(storm), (x) => SERVICE_LABEL[x])}
            {storm.reopenedCount > 0 ? ` · Reopened${storm.reopenedCount > 1 ? ` ${storm.reopenedCount}×` : ''}` : ''}
          </Text>
        </View>
        <StatusBadge label={storm.status === 'draft' ? 'Not dispatched' : 'Dispatched'} status={storm.status === 'draft' ? 'neutral' : 'info'} />
        <Icon name="chevron-right" size={18} color={colors.textTertiary} />
      </Pressable>

      <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>
        {stopsCompleteLabel(storm)}
        {storm.attentionCount ? ` · ${storm.attentionCount} need${storm.attentionCount === 1 ? 's' : ''} attention` : ''}
      </Text>
      {storm.total ? <ProgressBar progress={Math.round(storm.progress * 100)} style={{ marginTop: spacing.xs }} /> : null}

      {storm.routes.filter((r) => !r.cancelled && r.remaining > 0).map((r) => (
        <Pressable
          key={r.id}
          onPress={() => onOpenRoute(r.id)}
          accessibilityRole="button"
          accessibilityLabel={`Open route ${r.name}`}
          style={({ pressed }) => [styles.routeRow, { borderTopColor: colors.separator }, pressed && { opacity: 0.6 }]}
        >
          <View style={{ flex: 1 }}>
            <View style={styles.routeTitle}>
              <Text style={[typeScale.bodyLarge, { color: r.cancelled ? colors.textTertiary : colors.textPrimary, fontWeight: '600', flex: 1 }]}>
                {r.name}{r.cancelled ? ' (cancelled)' : ''}
              </Text>
              {r.attentionCount > 0 && <StatusBadge label={`${r.attentionCount} need${r.attentionCount === 1 ? 's' : ''} attention`} status="warning" />}
            </View>
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>
              {r.leadNames.length > 1 ? 'Leads' : 'Lead'}: {r.leadName ?? 'Not assigned'}
              {r.mediaRequired ? ` · ${r.minMedia} photo${r.minMedia === 1 ? '' : 's'} required` : ''}
            </Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>
              {r.completed} of {r.total} completed{r.skipped ? `, ${r.skipped} skipped` : ''}
              {r.nextStop ? ` · ${r.nextStop.status === 'arrived' ? 'On site at' : 'Next:'} ${r.nextStop.propertyName}` : r.total ? ' · All stops done' : ''}
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.textTertiary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { marginLeft: spacing.sm, marginBottom: spacing.sm, marginTop: spacing.xl },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 44 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full, alignSelf: 'flex-start' },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  heroCard: { borderRadius: radius.xl, overflow: 'hidden', marginTop: spacing.lg },
  heroBand: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xl },
  heroBody: { padding: spacing.md, marginTop: -spacing.md, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: 'transparent' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: 2 },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  crewTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stormHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.md, paddingTop: spacing.md, minHeight: 44 },
  routeTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
