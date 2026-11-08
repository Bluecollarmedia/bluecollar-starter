/**
 * Snow Mode activity log (Owner). Everything that happened in Snow Mode,
 * newest first, filterable by storm, route, worker, property and action.
 *
 * Working layout only: the approved Snow Mode design for this screen hasn't
 * been supplied yet. The data, filters and paging are real.
 */

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { EmptyState, ScreenHeader } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { SERVICE_LABEL as SNOW_SERVICE_LABEL } from '@/types/snow';
import { shortWhen } from '@/lib/snowFormat';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import {
  useSnowActivity, type SnowActivityEntry, type SnowActivityFilters, type SnowFilterKind, type SnowFilterOption,
} from '@/hooks/useSnowActivity';
import { actionIcon, actionLabel, entityLabel, fieldChanges } from '@/lib/snowActivity';
import { ClearLogSheet } from '@/components/logs/ClearLogSheet';
import { loadSnowLogYears, previewSnowClear, runSnowClear } from '@/data/activityClear';
import type { ClearMode } from '@/lib/logClear';
import { DATE_RANGES, buildView, entryServices, runSpan, servicesText, type ViewItem } from '@/lib/snowActivityView';

const FILTERS: { kind: SnowFilterKind; label: string; field: Exclude<keyof SnowActivityFilters, 'range' | 'archived'> }[] = [
  { kind: 'storm', label: 'Storm', field: 'stormId' },
  { kind: 'route', label: 'Route', field: 'routeId' },
  { kind: 'worker', label: 'Worker', field: 'personId' },
  { kind: 'property', label: 'Property', field: 'propertyId' },
  { kind: 'action', label: 'Action', field: 'action' },
];


const SERVICE_LABEL: Record<string, string> = SNOW_SERVICE_LABEL;

const formatTime = shortWhen;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** A name for a filter choice, even when the log never recorded one. */
function optionLabel(o: SnowFilterOption): string {
  if (o.kind === 'action') return actionLabel(o.value);
  if (o.label) return o.label;
  const fallback = { storm: 'Unnamed storm', route: 'Unnamed route', property: 'Unnamed property', worker: 'Unknown person' }[o.kind];
  return `${fallback} · ${shortDate(o.lastAt)}`;
}

export default function SnowActivityScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [filters, setFilters] = useState<SnowActivityFilters>({});
  const [picking, setPicking] = useState<SnowFilterKind | null>(null);
  // The filter area is two small buttons; each opens its own panel and a second tap (or a choice) puts it away again.
  const [panel, setPanel] = useState<'period' | 'filters' | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Group by day and fold long runs of routine entries. Off shows the plain list. Either way nothing is hidden.
  const [grouped, setGrouped] = useState(true);
  const [openRuns, setOpenRuns] = useState<Record<string, boolean>>({});
  const { events, options, loading, loadingMore, hasMore, error, reload, loadMore } = useSnowActivity(filters);
  // Clear / archive the log (update 51)
  const [clearing, setClearing] = useState(false);
  const [years, setYears] = useState<number[]>([]);
  const [clearedNote, setClearedNote] = useState<string | null>(null);
  const archivedView = !!filters.archived;
  const clearModes: ClearMode[] = archivedView ? ['restore', 'delete'] : ['archive', 'delete'];
  function openClear() { loadSnowLogYears().then(setYears); setClearing(true); }

  const labelOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of options) map.set(`${o.kind}:${o.value}`, optionLabel(o));
    return (kind: SnowFilterKind, value?: string) => (value ? map.get(`${kind}:${value}`) : undefined);
  }, [options]);

  const filterCount = FILTERS.filter((f) => filters[f.field]).length + (archivedView ? 1 : 0);
  const activeCount = FILTERS.filter((f) => filters[f.field]).length + (filters.range && filters.range !== 'all' ? 1 : 0);
  const periodLabel = DATE_RANGES.find((r) => r.key === (filters.range ?? 'all'))?.label ?? 'All time';
  const view = useMemo(() => buildView(events, { group: grouped, fold: grouped }), [events, grouped]);

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  function choose(kind: SnowFilterKind, value?: string) {
    const field = FILTERS.find((f) => f.kind === kind)!.field;
    setFilters((prev) => ({ ...prev, [field]: value }));
    setPicking(null);
    setExpandedId(null);
  }

  function renderEvent(e: SnowActivityEntry, nested = false) {
    const isExpanded = expandedId === e.id;
    const who = e.actorName ?? (e.actorId ? 'Someone' : 'System');
    const context = [
      labelOf('storm', e.stormId),
      labelOf('route', e.routeId),
      labelOf('property', e.propertyId),
      servicesText(entryServices(e), (k) => SERVICE_LABEL[k] ?? k) || undefined,
    ].filter(Boolean).join(' · ');
    const about = e.personName && e.personId !== e.actorId ? e.personName : undefined;
    const changes = isExpanded ? fieldChanges(e.before ?? null, e.after ?? null) : [];

    return (
      <Pressable
        onPress={() => setExpandedId(isExpanded ? null : e.id)}
        style={[styles.row, { borderBottomColor: colors.borderLight }, nested && { paddingLeft: spacing.xl }]}
        accessibilityRole="button"
        accessibilityLabel={`${actionLabel(e.action)} by ${who}, ${formatTime(e.occurredAt)}`}
        accessibilityHint={isExpanded ? 'Hides the details' : 'Shows what changed'}
      >
        <View style={[styles.rowIcon, { backgroundColor: colors.backgroundTertiary }]}>
          <Icon name={actionIcon(e.action)} size={18} color={colors.textSecondary} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flex: 1 }]} numberOfLines={2}>
              {actionLabel(e.action)}
            </Text>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{formatTime(e.occurredAt)}</Text>
          </View>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
            {who}{about ? ` → ${about}` : ''}
          </Text>
          {context ? (
            <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={isExpanded ? undefined : 1}>
              {context}
            </Text>
          ) : null}

          {isExpanded && (
            <View style={[styles.details, { borderTopColor: colors.borderLight }]}>
              {e.note ? (
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginBottom: spacing.sm }]}>{e.note}</Text>
              ) : null}
              {changes.length === 0 ? (
                <Text style={[typeScale.caption, { color: colors.textTertiary }]}>No field details recorded.</Text>
              ) : (
                changes.map((c) => (
                  <View key={c.field} style={styles.change}>
                    <Text style={[typeScale.overline, { color: colors.textTertiary }]}>{c.field.toUpperCase()}</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                      {c.before !== undefined && c.after !== undefined
                        ? `${c.before} → ${c.after}`
                        : c.after ?? `was ${c.before}`}
                    </Text>
                  </View>
                ))
              )}
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>
                {entityLabel(e.entityType)} record · {new Date(e.occurredAt).toLocaleString('en-US')}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  }

  function dayLabel(day: string): string {
    const [y, m, d] = day.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  function renderItem({ item }: { item: ViewItem<SnowActivityEntry> }) {
    if (item.type === 'day') {
      return (
        <Text style={[typeScale.overline, styles.dayHeader, { color: colors.textSecondary, backgroundColor: colors.background }]}>
          {dayLabel(item.day).toUpperCase()}
        </Text>
      );
    }
    if (item.type === 'event') return renderEvent(item.entry);
    const open = !!openRuns[item.key];
    const first = item.entries[0];
    const services = servicesText(entryServices(first), (k) => SERVICE_LABEL[k] ?? k);
    const storm = labelOf('storm', first.stormId);
    return (
      <View>
        <Pressable
          onPress={() => setOpenRuns((cur) => ({ ...cur, [item.key]: !open }))}
          style={[styles.row, { borderBottomColor: colors.borderLight }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${actionLabel(item.action)}, ${item.entries.length} entries. ${open ? 'Hides them' : 'Shows them'}`}
        >
          <View style={[styles.rowIcon, { backgroundColor: colors.backgroundTertiary }]}>
            <Icon name={actionIcon(item.action)} size={18} color={colors.textSecondary} />
          </View>
          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flex: 1 }]} numberOfLines={2}>
                {actionLabel(item.action)} ×{item.entries.length}
              </Text>
              <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
            </View>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
              {runSpan(item.entries, (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}
            </Text>
            {[storm, services].filter(Boolean).length ? (
              <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>{[storm, services].filter(Boolean).join(' · ')}</Text>
            ) : null}
          </View>
        </Pressable>
        {open ? item.entries.map((e) => <View key={e.id}>{renderEvent(e, true)}</View>) : null}
      </View>
    );
  }

  const pickingFilter = FILTERS.find((f) => f.kind === picking);
  const pickOptions = options.filter((o) => o.kind === picking);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title={archivedView ? 'Archived activity' : 'Snow Activity'}
        subtitle={archivedView ? 'Entries you moved to history' : 'Everything that happened, newest first'}
        right={
          <Pressable onPress={openClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear or archive the log" style={styles.clearBtn}>
            <Icon name="trash-2" size={18} color={colors.textSecondary} />
          </Pressable>
        }
      />
      {clearedNote ? <Text style={[typeScale.bodySmall, styles.error, { color: colors.success }]}>{clearedNote}</Text> : null}

      <View style={styles.filterBar}>
        <Pressable
          onPress={() => setPanel(panel === 'period' ? null : 'period')}
          style={[styles.chip, { backgroundColor: panel === 'period' ? colors.primarySurface : colors.backgroundTertiary, borderColor: panel === 'period' ? colors.primary : colors.borderLight }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: panel === 'period' }}
          accessibilityLabel={`Time period: ${periodLabel}. Tap to change`}
        >
          <Icon name="calendar" size={14} color={colors.textSecondary} />
          <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>{periodLabel}</Text>
          <Icon name={panel === 'period' ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={() => setPanel(panel === 'filters' ? null : 'filters')}
          style={[styles.chip, { backgroundColor: filterCount > 0 ? colors.primary : panel === 'filters' ? colors.primarySurface : colors.backgroundTertiary, borderColor: filterCount > 0 ? colors.primary : panel === 'filters' ? colors.primary : colors.borderLight }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: panel === 'filters' }}
          accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} on. Tap to change` : 'Filters'}
        >
          <Icon name="sliders" size={14} color={filterCount > 0 ? colors.textOnPrimary : colors.textSecondary} />
          <Text style={[typeScale.labelSmall, { color: filterCount > 0 ? colors.textOnPrimary : colors.textPrimary }]}>{filterCount > 0 ? `Filters · ${filterCount}` : 'Filters'}</Text>
          <Icon name={panel === 'filters' ? 'chevron-up' : 'chevron-down'} size={14} color={filterCount > 0 ? colors.textOnPrimary : colors.textSecondary} />
        </Pressable>
        {activeCount > 0 && (
          <Pressable onPress={() => { setFilters({}); setPanel(null); }} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear all filters">
            <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Clear</Text>
          </Pressable>
        )}
      </View>

      {panel === 'period' ? (
        <View style={styles.filterBar}>
          {DATE_RANGES.map((r) => {
            const on = (filters.range ?? 'all') === r.key;
            return (
              <Pressable
                key={r.key}
                onPress={() => { setFilters((prev) => ({ ...prev, range: r.key === 'all' ? undefined : r.key })); setExpandedId(null); setPanel(null); }}
                style={[styles.chip, { backgroundColor: on ? colors.primary : colors.backgroundTertiary, borderColor: on ? colors.primary : colors.borderLight }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Show ${r.label.toLowerCase()}`}
              >
                <Text style={[typeScale.labelSmall, { color: on ? colors.textOnPrimary : colors.textPrimary }]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {panel === 'filters' ? (
        <>
          <View style={styles.filterBar}>
            {FILTERS.map((f) => {
              const value = filters[f.field];
              const on = !!value;
              return (
                <Pressable
                  key={f.kind}
                  onPress={() => setPicking(f.kind)}
                  style={[styles.chip, {
                    backgroundColor: on ? colors.primary : colors.backgroundTertiary,
                    borderColor: on ? colors.primary : colors.borderLight,
                  }]}
                  accessibilityRole="button"
                  accessibilityLabel={on ? `${f.label}: ${labelOf(f.kind, value)}. Change filter` : `Filter by ${f.label.toLowerCase()}`}
                >
                  <Text style={[typeScale.labelSmall, { color: on ? colors.textOnPrimary : colors.textPrimary }]} numberOfLines={1}>
                    {on ? labelOf(f.kind, value) ?? f.label : f.label}
                  </Text>
                  <Icon name="chevron-down" size={14} color={on ? colors.textOnPrimary : colors.textSecondary} />
                </Pressable>
              );
            })}
          </View>
          <View style={styles.filterBar}>
            <Pressable
              onPress={() => { setFilters((prev) => ({ ...prev, archived: archivedView ? undefined : true })); setExpandedId(null); setClearedNote(null); }}
              style={[styles.chip, { backgroundColor: archivedView ? colors.primarySurface : colors.backgroundTertiary, borderColor: archivedView ? colors.primary : colors.borderLight }]}
              accessibilityRole="switch"
              accessibilityState={{ checked: archivedView }}
              accessibilityLabel="Show archived entries"
            >
              <Icon name="archive" size={14} color={archivedView ? colors.primary : colors.textSecondary} />
              <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>Archived</Text>
            </Pressable>
            <Pressable
              onPress={() => setGrouped(!grouped)}
              style={[styles.chip, { backgroundColor: grouped ? colors.primarySurface : colors.backgroundTertiary, borderColor: grouped ? colors.primary : colors.borderLight }]}
              accessibilityRole="switch"
              accessibilityState={{ checked: grouped }}
              accessibilityLabel="Group by day and fold repeated entries"
            >
              <Icon name={grouped ? 'check-square' : 'square'} size={14} color={grouped ? colors.primary : colors.textSecondary} />
              <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>Group by day</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {error ? (
        <Text style={[typeScale.bodySmall, styles.error, { color: semantic.error }]}>{error}</Text>
      ) : null}

      {loading && events.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={view}
          keyExtractor={(v) => v.key}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing['3xl'] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            error ? null : (
              <EmptyState
                icon="activity"
                title={activeCount > 0 ? 'Nothing matches these filters' : 'No snow activity yet'}
                description={activeCount > 0
                  ? 'Try removing a filter or choosing a longer period.'
                  : 'Storms, routes, stops, media and time records show up here as soon as they change.'}
                actionTitle={activeCount > 0 ? 'Clear filters' : undefined}
                onAction={activeCount > 0 ? () => setFilters({}) : undefined}
              />
            )
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.primary} />
            : !hasMore && events.length > 0 ? (
              <Text style={[typeScale.caption, styles.end, { color: colors.textTertiary }]}>Start of the log</Text>
            ) : null
          }
        />
      )}

      <ClearLogSheet
        visible={clearing}
        onClose={() => setClearing(false)}
        title={archivedView ? 'Archived entries' : 'Clear the activity log'}
        modes={clearModes}
        years={years}
        preview={(range, mode) => previewSnowClear(range, mode)}
        run={(range, mode) => runSnowClear(range, mode)}
        onDone={(msg) => { setClearedNote(msg); reload(); }}
      />

      <BottomSheetModal visible={!!picking} onRequestClose={() => setPicking(null)}>
        <Pressable style={styles.overlay} onPress={() => setPicking(null)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.md }]}>
              Filter by {pickingFilter?.label.toLowerCase()}
            </Text>
            <ScrollView bounces={false} style={{ maxHeight: 420 }}>
              {pickingFilter && [{ value: undefined as string | undefined, label: `Any ${pickingFilter.label.toLowerCase()}`, count: undefined as number | undefined }]
                .concat(pickOptions.map((o) => ({ value: o.value, label: optionLabel(o), count: o.count })))
                .map((o) => {
                  const selected = filters[pickingFilter.field] === o.value;
                  return (
                    <Pressable
                      key={o.value ?? 'any'}
                      onPress={() => choose(pickingFilter.kind, o.value)}
                      style={[styles.option, { borderBottomColor: colors.borderLight }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>{o.label}</Text>
                      {o.count !== undefined && (
                        <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{o.count}</Text>
                      )}
                      {selected && <Icon name="check" size={18} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              {pickOptions.length === 0 && (
                <Text style={[typeScale.bodySmall, { color: colors.textTertiary, paddingVertical: spacing.md }]}>
                  Nothing logged yet.
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  dayHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 200,
    paddingHorizontal: spacing.md, minHeight: 36, borderRadius: radius.full, borderWidth: 1,
  },
  clear: { paddingHorizontal: spacing.sm, minHeight: 36, justifyContent: 'center' },
  clearBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  error: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  details: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  change: { marginBottom: spacing.xs },
  end: { textAlign: 'center', marginVertical: spacing.lg },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
});
