/**
 * The customer's Snow screen. One page per Snow property (swipe left and right between them; a single property is just one page).
 * Each page tells the story of that property: what is happening right now (only during a storm), the season so far, the services it gets,
 * and a timeline of every completed, sent service with its photos. Plowing and salting are separate entries even when different crews did
 * them. Everything comes from real data (src/data/snowCustomer.ts); nothing is made up. Notification switches live in Account, not here.
 */
import { VideoThumb } from '@/components/media/VideoThumb';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, useWindowDimensions, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { InlineNotice, ScreenHeader } from '@/components/ui';
import { TaskMediaViewer, type TaskMediaItem } from '@/components/tasks/TaskMedia';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useMySnowPropertyList } from '@/hooks/useHasSnow';
import { loadServices, loadStatuses, loadTimeline, peekTimeline } from '@/data/snowCustomer';
import {
  DAYS_PREVIEW, SERVICE_NAME, SERVICE_VERB, clampPage, countLabel, daysToShow, groupTimeline, lastServiceLabel, seasonStats, sortServices,
  statusView, timeLabel,
  type SnowStatus, type SnowSvc, type TimelineEntry,
} from '@/lib/customerSnow';
import { SERVICE_ICON } from '@/types/snow';
import { properName } from '@/lib/names';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';

interface Prop { id: string; name: string; address: string }

const sameProperty = (e: TimelineEntry, p: Prop) => e.propertyId === p.id || (e.propertyId === e.propertyName && e.propertyName.trim().toLowerCase() === p.name.trim().toLowerCase());

export function CustomerSnowScreen() {
  const t = useT();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ property?: string }>();
  const { list: properties, loaded } = useMySnowPropertyList();
  // Opens with the last timeline that loaded (if any); otherwise the page shows its layout in quiet placeholders. Never a spinner.
  const [entries, setEntries] = useState<TimelineEntry[] | null>(() => peekTimeline());
  const [statuses, setStatuses] = useState<SnowStatus[]>([]);
  const [services, setServices] = useState<Record<string, SnowSvc[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [viewer, setViewer] = useState<{ items: TaskMediaItem[]; index: number } | null>(null);
  const pager = useRef<ScrollView>(null);
  const placed = useRef(false);

  const reload = useCallback(async () => {
    const [tl, s, sv] = await Promise.all([loadTimeline(), loadStatuses(), loadServices()]);
    if (tl.ok) { setEntries(tl.data); setError(null); } else { setEntries((cur) => cur ?? []); setError(tl.error); }
    setStatuses(s);
    setServices(sv);
  }, []);
  useFocusEffect(useCallback(() => {
    void reload();
    // A storm moves quickly: look again every minute while this screen is open.
    const timer = setInterval(() => { void reload(); }, 60_000);
    return () => clearInterval(timer);
  }, [reload]));

  // Open on the property that was tapped on Home.
  useEffect(() => {
    if (placed.current || properties.length === 0) return;
    const i = Math.max(0, properties.findIndex((p) => p.id === params.property));
    placed.current = true;
    setPage(i);
    if (i > 0) setTimeout(() => pager.current?.scrollTo({ x: i * width, animated: false }), 0);
  }, [properties, params.property, width]);

  const current = properties[clampPage(page, properties.length)];
  const onPaged = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(clampPage(e.nativeEvent.contentOffset.x / width, properties.length));

  async function onRefresh() { setRefreshing(true); await reload(); setRefreshing(false); }

  const openViewer = (entry: TimelineEntry, index: number) => {
    const items: TaskMediaItem[] = entry.media.filter((m) => m.url).map((m) => ({ key: m.id, uri: m.url as string, mediaType: m.kind === 'photo' ? 'image' : 'video' }));
    if (items.length) setViewer({ items, index });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title={current ? properName(current.name) : t('Snow')} subtitle={current?.address || undefined} />
      {properties.length > 1 ? (
        <View style={styles.dots} accessibilityLabel={t('Property {n} of {total}. Swipe to see the next.', { n: page + 1, total: properties.length })}>
          {properties.map((p, i) => <View key={p.id} style={[styles.dot, { backgroundColor: i === page ? colors.primary : colors.border }]} />)}
        </View>
      ) : null}

      {loaded && properties.length === 0 ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <InlineNotice icon="cloud-snow" tone="info" text={t('No Snow service is linked to your account yet.')} />
        </View>
      ) : properties.length === 0 ? (
        <Placeholder />
      ) : (
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          scrollEnabled={properties.length > 1}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onPaged}
          style={{ flex: 1 }}
        >
          {properties.map((p) => (
            <View key={p.id} style={{ width }}>
              <PropertyPage
                prop={p}
                entries={entries === null ? null : entries.filter((e) => sameProperty(e, p))}
                status={statuses.find((s) => s.propertyId === p.id)}
                services={sortServices(services[p.id] ?? [])}
                error={error}
                refreshing={refreshing}
                onRefresh={onRefresh}
                onOpenPhoto={openViewer}
              />
            </View>
          ))}
        </ScrollView>
      )}

      <TaskMediaViewer
        items={viewer?.items ?? []}
        index={viewer ? viewer.index : null}
        onIndexChange={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
        onClose={() => setViewer(null)}
      />
    </View>
  );
}

function PropertyPage({ prop, entries: loadedEntries, status, services, error, refreshing, onRefresh, onOpenPhoto }: {
  prop: Prop; entries: TimelineEntry[] | null; status?: SnowStatus; services: SnowSvc[]; error: string | null;
  refreshing: boolean; onRefresh: () => void; onOpenPhoto: (e: TimelineEntry, index: number) => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [showAll, setShowAll] = useState(false);
  // null = the timeline has not loaded yet: show quiet placeholders where it will be, and no "nothing yet" message.
  const entries = useMemo(() => loadedEntries ?? [], [loadedEntries]);
  const waiting = loadedEntries === null;
  const stats = useMemo(() => seasonStats(entries), [entries]);
  const groups = useMemo(() => groupTimeline(entries), [entries]);
  const shown = daysToShow(groups, showAll);
  const live = statusView(status, prop.address, t);

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'], gap: spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
    >
      {error ? <InlineNotice icon="alert-circle" tone="error" text={t(error)} /> : null}

      {live ? (
        <View style={[styles.card, styles.hero, { backgroundColor: live.tone === 'active' ? semantic.infoLight : colors.surface }, shadow.sm]} accessible accessibilityLabel={t('Right now. {headline}. {detail}', { headline: live.headline, detail: live.detail ?? '' })}>
          <View style={[styles.heroIcon, { backgroundColor: live.tone === 'active' ? semantic.info : colors.backgroundTertiary }]}>
            <Icon name={live.tone === 'active' ? 'truck' : 'cloud-snow'} size={22} color={live.tone === 'active' ? '#FFFFFF' : semantic.info} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.overline, { color: semantic.info }]}>{t('RIGHT NOW')}</Text>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{live.headline}</Text>
            {live.detail ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{live.detail}</Text> : null}
          </View>
        </View>
      ) : null}

      {entries.length > 0 ? (
        <View>
          <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>{t('THIS SEASON')}</Text>
          <View style={styles.statRow}>
            <Stat value={String(stats.services)} label={stats.services === 1 ? t('Service') : t('Services')} />
            <Stat value={stats.lastServiceAt ? new Date(stats.lastServiceAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'} label={t('Last service')} />
            <Stat value={String(stats.photos)} label={stats.photos === 1 ? t('Photo') : t('Photos')} />
          </View>
        </View>
      ) : null}

      {services.length > 0 ? (
        <View>
          <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>{t('INCLUDED AT YOUR PROPERTY')}</Text>
          <View style={styles.chips}>
            {services.map((s) => (
              <View key={s} style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                <Icon name={SERVICE_ICON[s]} size={14} color={semantic.info} />
                <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{t(SERVICE_NAME[s])}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {waiting ? (
        <Placeholder />
      ) : entries.length === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.surface, gap: spacing.md }, shadow.sm]}>
          <View style={[styles.snowCircle, { backgroundColor: semantic.infoLight }]}><Icon name="cloud-snow" size={28} color={semantic.info} /></View>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center' }]}>{t('No service yet this season')}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>{t("We'll be ready when the snow falls.")}</Text>
          <Text style={[typeScale.overline, { color: colors.textSecondary }]}>{t('HOW IT WORKS')}</Text>
          {[t('The crew is dispatched when snow falls.'), t("You'll see it here the moment they arrive."), t("When it's done you'll see photos here.")].map((line, i) => (
            <View key={i} style={styles.step}>
              <View style={[styles.stepNum, { backgroundColor: colors.primarySurface }]}><Text style={[typeScale.labelLarge, { color: colors.primaryDark }]}>{i + 1}</Text></View>
              <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>{line}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View>
          <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>{t('TIMELINE')}</Text>
          {shown.map((g) => (
            <View key={g.key} style={{ marginBottom: spacing.md }}>
              <Text style={[typeScale.labelLarge, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
                {t(g.label)}{g.stormNames.length ? <Text style={{ color: colors.textTertiary, fontWeight: '500' }}>{`  ·  ${g.stormNames.join(', ')}`}</Text> : null}
              </Text>
              {g.entries.map((e, i) => (
                <View key={e.visitId} style={styles.entryRow}>
                  <View style={styles.rail}>
                    <View style={[styles.railDot, { backgroundColor: semantic.info }]} />
                    {i < g.entries.length - 1 ? <View style={[styles.railLine, { backgroundColor: colors.border }]} /> : null}
                  </View>
                  <EntryCard entry={e} onOpenPhoto={(idx) => onOpenPhoto(e, idx)} />
                </View>
              ))}
            </View>
          ))}
          {groups.length > DAYS_PREVIEW ? (
            <Pressable onPress={() => setShowAll((v) => !v)} accessibilityRole="button" style={styles.more}>
              <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{showAll ? t('Show fewer') : t('Show earlier ({count} more days)', { count: groups.length - DAYS_PREVIEW })}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

/** Quiet grey blocks in the shape of the content that is about to appear. No spinner, no movement. */
function Placeholder() {
  const { colors } = useTheme();
  const block = (h: number, w: number | string = '100%') => <View style={{ height: h, width: w as any, borderRadius: radius.lg, backgroundColor: colors.borderLight }} />;
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {block(18, 110)}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>{block(64, '31%')}{block(64, '31%')}{block(64, '31%')}</View>
      {block(18, 150)}
      {block(120)}
      {block(120)}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontWeight: '800' }]}>{value}</Text>
      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

function EntryCard({ entry, onOpenPhoto }: { entry: TimelineEntry; onOpenPhoto: (index: number) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const visible = entry.media.filter((m) => m.url);
  const strip = visible.slice(0, 4);
  const extra = visible.length - strip.length;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, flex: 1, gap: spacing.sm }, shadow.sm]}>
      <View style={styles.entryTop}>
        <View style={[styles.svcIcon, { backgroundColor: semantic.infoLight }]}><Icon name={SERVICE_ICON[entry.service]} size={18} color={semantic.info} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{t(SERVICE_VERB[entry.service])}</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{timeLabel(entry.completedAt)}</Text>
        </View>
        <View style={styles.done}>
          <Icon name="check-circle" size={16} color={semantic.success} />
          <Text style={[typeScale.labelSmall, { color: semantic.success }]}>{t('Completed')}</Text>
        </View>
      </View>
      {strip.length ? (
        <>
          <View style={styles.strip}>
            {strip.map((m, i) => (
              <Pressable key={m.id} onPress={() => onOpenPhoto(i)} accessibilityRole="button" accessibilityLabel={m.kind === 'video' ? t('Play video') : t('View photo')} style={[styles.tile, { backgroundColor: colors.borderLight }]}>
                {m.kind === 'photo' ? <Image source={{ uri: m.url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <VideoThumb uri={m.url ?? ''} fallback={<Icon name="video" size={22} color={colors.textTertiary} />} />}
                {i === strip.length - 1 && extra > 0 ? <View style={styles.tileMore}><Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>+{extra}</Text></View> : null}
              </Pressable>
            ))}
          </View>
          <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{countLabel(visible.length, t('photo'), t('photos'))}</Text>
        </>
      ) : null}
    </View>
  );
}

const TILE = 68;
const styles = StyleSheet.create({
  screen: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: spacing.sm },
  dot: { width: 7, height: 7, borderRadius: 4 },
  card: { borderRadius: radius.xl, padding: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  label: { marginLeft: spacing.xs, marginBottom: spacing.sm },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 38, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth },
  snowCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepNum: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  entryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  rail: { width: 14, alignItems: 'center', paddingTop: 18 },
  railDot: { width: 9, height: 9, borderRadius: 5 },
  railLine: { flex: 1, width: 2, marginTop: 4, borderRadius: 1 },
  entryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  svcIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  strip: { flexDirection: 'row', gap: spacing.sm },
  tile: { width: TILE, height: TILE, borderRadius: radius.md, overflow: 'hidden' },
  tileIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileMore: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  more: { alignSelf: 'center', paddingVertical: spacing.sm },
});

// Used by tests and by Home to say when the last service was.
export { lastServiceLabel };
