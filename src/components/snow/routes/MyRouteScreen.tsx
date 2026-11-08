/**
 * Snow worker "My Route": the route this person leads on a dispatched storm.
 * Shows the current stop with directions, I'm Here, completion photos and
 * Complete Stop, then the whole route in order. The database decides what's
 * allowed (order, one stop at a time, photo minimum, dispatched storm only;
 * update 026). Working layout in the existing app style; no approved mockup.
 */
import { Image } from 'expo-image';
import { PhotoPager } from '@/components/media/PhotoPager';
import { deleteMedia } from '@/data/snowMediaReview';
import { useT } from '@/i18n';
import { useBackStep } from '@/hooks/useBackStep';
import { pickActiveRoute, splitMyRoutes } from '@/lib/snowMyRoute';
import { canWorkRoute } from '@/lib/snowCrew';
import { groupStatus, groupStops, isGroupClosed, servicesText } from '@/lib/snowStopGroups';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Icon, InlineNotice, Input, LoadingSpinner, ProgressBar, StatusBadge } from '@/components/ui';
import { showMessage, confirmAction } from '@/components/financials/ActionSheet';
import { pickSnowMedia } from '@/components/snow/pickSnowMedia';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { WeatherButton } from '@/components/weather/WeatherButton';
import { usePublicWeatherSwitch } from '@/hooks/usePublicWeatherSwitch';
import { openDirections } from '@/lib/maps';
import { useMediaJobs, waitForMediaJobs } from '@/lib/mediaQueueRuntime';
import { SnowUploadStatus } from '@/components/snow/SnowUploadStatus';
import { formatClock } from '@/data/snowShifts';
import { cardStatusWord, primaryActionFor, routeHeaderLine, routeProgress, splitAddress, stopStatusWord } from '@/lib/snowRouteView';
import { snowUploadState } from '@/hooks/useSnowUploads';
import { SERVICE_LABEL } from '@/data/snowStorms';
import {
  addCompletionMedia, arriveAtStop, finishStop, loadMyRoutes, loadRoute, SNOW_COMPLETION_TARGET, STOP_STATUS_LABEL,
  type MyRoute, type RouteDetail, type RouteStop,
  stopNeedsPhotos,
  stopMinMedia,
} from '@/data/snowRoutes';
import { STOP_TONE } from './RouteEditScreen';
import { LeadSkipPanel } from './SkipRequests';
import { SnowServiceReferenceCard } from '@/components/snow/SnowReference';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { SnowService } from '@/types/snow';

export function MyRouteScreen({ clockedInSince, topNotice, pastOnly }: { /** Settings > Past storms: only the ended storms (and one opened read-only), none of the current work. */ pastOnly?: boolean; /** When the worker clocked in (the Route tab only shows this screen once they have). */ clockedInSince?: string; /** Shown first (the "you didn't clock out" card for an earlier shift). */ topNotice?: React.ReactNode } = {}) {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const weatherOn = usePublicWeatherSwitch(false);
  const tabBarClearance = useTabBarClearance();
  const [routes, setRoutes] = useState<MyRoute[]>([]);
  const [routeId, setRouteId] = useState<string | null>(null);
  // A past route the worker opened from History (read-only). Never chosen automatically.
  const [historyId, setHistoryId] = useState<string | null>(null);
  // The back swipe closes an earlier route you are looking at before it leaves the screen.
  useBackStep(historyId != null, () => setHistoryId(null));
  const [showHistory, setShowHistory] = useState(false);
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  // The stop in the list whose instructions and photos are open (any stop, any time: before the storm starts and for stops still ahead).
  const [openStopId, setOpenStopId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const mine = await loadMyRoutes();
    if (!mine.ok) { setLoading(false); return setError(mine.error); }
    setRoutes(mine.data);
    // Current work is only ever a route on a dispatched storm. A past route is shown
    // only when the worker opens it from History.
    const { active } = splitMyRoutes(mine.data);
    const current = pickActiveRoute(active, routeId);
    setRouteId(current);
    const pick = historyId && mine.data.some((r) => r.id === historyId) ? historyId : (pastOnly ? null : current);
    if (!pick) { setRoute(null); setLoading(false); return setError(null); }
    const r = await loadRoute(pick);
    setLoading(false);
    setError(r.ok ? null : r.error);
    if (r.ok) setRoute(r.data);
  }, [routeId, historyId, pastOnly]);

  useEffect(() => { reload(); }, [reload]);

  // Photos upload in the background. When one finishes saving, refresh so the stop's photo count is the real one.
  const mediaJobs = useMediaJobs();
  const savedPhotos = snowUploadState(mediaJobs, SNOW_COMPLETION_TARGET, () => true).saved;
  useEffect(() => { if (savedPhotos > 0) reload(); }, [savedPhotos]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(run: () => Promise<{ ok: boolean; error?: string }>, failTitle: string) {
    setBusy(true);
    const res = await run();
    setBusy(false);
    if (!res.ok) showMessage(failTitle, t(res.error ?? ''));
    await reload();
    return res.ok;
  }

  if (loading) {
    return <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}><LoadingSpinner /></View>;
  }

  // A route that does several services together has one visit per service at each property. The crew works the property
  // once, so those visits are one stop here: I'm Here starts all of them, Complete Stop completes all of them.
  const groups = route ? groupStops(route.stops) : [];
  const currentGroup = groups.find((g) => !isGroupClosed(g));
  const current = currentGroup?.[0];
  const progress = routeProgress(groups.map(groupStatus));
  // routeProgress words its text in English (the check reads it); the screen words it again in the chosen language.
  const progressBase = t(progress.total === 1 ? '{done} of {total} stop completed' : '{done} of {total} stops completed', { done: progress.completed, total: progress.total });
  const progressText = progress.skipped ? `${progressBase} · ${t('{n} skipped', { n: progress.skipped })}` : progressBase;
  const working = route?.stormStatus === 'dispatched' && !route.cancelled;
  const { active: activeRoutes, history: pastRoutes } = splitMyRoutes(routes);
  // Update 41: crew can see the route, its stops and instructions; only the lead can act on it.
  const isLead = canWorkRoute(routes.find((r) => r.id === route?.id)?.role);
  // The photos already saved for this stop: tap one to open it (swipe for the others); the lead can delete one (a wrong photo by mistake).
  const stopPhotos = (currentGroup ?? []).flatMap((st) => st.photos ?? []);
  const svcLabel = (x: string) => t(SERVICE_LABEL[x as SnowService]);
  const { street, place } = current ? splitAddress(current.propertyName, current.propertyAddress) : { street: undefined, place: undefined };
  const groupServices = (g: RouteStop[]) => g.map((v) => v.service ?? route!.service);
  // Photos are added once for the stop, on its first visit. Ones still uploading count as added: they are saved on the phone and
  // keep going in the background; ones that failed do not count until they are retried.
  const { uploading, failed: failedJobs } = snowUploadState(mediaJobs, SNOW_COMPLETION_TARGET, (p) => !!current && p.visitId === current.id);
  const addedCount = (current?.mediaCount ?? 0) + uploading.length;
  // Photos for stops already completed (or any other stop) keep uploading in the background; they stay visible here so they can be retried or removed.
  const elsewhere = snowUploadState(mediaJobs, SNOW_COMPLETION_TARGET, (p) => !current || p.visitId !== current.id);
  const needMedia = route && current && stopNeedsPhotos(current, route) ? Math.max(0, stopMinMedia(current, route) - addedCount) : 0;

  /** Starts every visit at this property that has not been started, in order. Stops at the first problem. */
  async function arriveGroup(g: RouteStop[]): Promise<{ ok: boolean; error?: string }> {
    for (const v of g.filter((x) => x.status === 'pending')) {
      const res = await arriveAtStop(v.id);
      if (!res.ok) return res;
    }
    return { ok: true };
  }

  /**
   * Finishes every visit at this property that is not finished. The note goes on the first one. It never waits for photos: any still
   * uploading keep going in the background and attach to the stop when they finish.
   */
  async function finishGroup(g: RouteStop[]): Promise<{ ok: boolean; error?: string }> {
    let first = true;
    for (const v of g.filter((x) => x.status === 'arrived' || x.status === 'pending')) {
      const res = await finishStop(v.id, first ? note : undefined);
      if (!res.ok) return res;
      first = false;
    }
    return { ok: true };
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: tabBarClearance + spacing.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
        keyboardShouldPersistTaps="handled"
      >
        {pastOnly && !historyId ? (
          <Pressable onPress={() => router.back()} style={styles.backToCurrent} accessibilityRole="button" accessibilityLabel={t('Back')}>
            <Icon name="arrow-left" size={18} color={colors.primary} />
            <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Back')}</Text>
          </Pressable>
        ) : null}
        {weatherOn && !pastOnly ? <View style={{ alignSelf: 'flex-start', marginBottom: spacing.md }}><WeatherButton to="/snow/worker/weather" /></View> : null}
        {pastOnly ? null : topNotice}
        {clockedInSince && !pastOnly ? (
          <View style={[styles.clockLine, { backgroundColor: colors.primarySurface }]} accessible accessibilityLabel={t('Clocked in since {time}. Clock out in the Time Clock tab.', { time: formatClock(clockedInSince) })}>
            <View style={[styles.clockDot, { backgroundColor: colors.success }]} />
            <Text style={[typeScale.caption, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{t('Clocked in since {time}.', { time: formatClock(clockedInSince) })}</Text>{' '}{t('Clock out in the Time Clock tab.')}
            </Text>
          </View>
        ) : null}
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.sm }]}>{pastOnly ? t('Past storms') : t('My Route')}</Text>
        {error ? <InlineNotice icon="alert-circle" tone="error" text={t(error)} style={{ marginTop: spacing.md }} /> : null}

        {/* Photos of earlier stops (or ended storms) still uploading or failed: always visible, so Retry / Remove is never lost. */}
        <View style={{ marginTop: spacing.sm }}>
          <SnowUploadStatus uploading={elsewhere.uploading} failed={elsewhere.failed} />
        </View>

        {historyId ? (
          <Pressable onPress={() => setHistoryId(null)} style={styles.backToCurrent} accessibilityRole="button" accessibilityLabel={t('Back to current work')}>
            <Icon name="arrow-left" size={18} color={colors.primary} />
            <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{pastOnly ? t('Back to past storms') : t('Back to current work')}</Text>
          </Pressable>
        ) : null}

        {!pastOnly && !historyId && activeRoutes.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}>
            {activeRoutes.map((r) => {
              const on = r.id === routeId;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => setRouteId(r.id)}
                  style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[typeScale.labelLarge, { color: on ? colors.textOnPrimary : colors.textPrimary }]}>{r.name}</Text>
                  <Text style={[typeScale.caption, { color: on ? colors.textOnPrimary : colors.textSecondary }]}>{r.stormName}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {!route && pastOnly ? (pastRoutes.length === 0 ? <EmptyState icon="clock" title={t('No past storms yet')} description={t('Storms you worked on show up here once they have ended.')} /> : null) : !route ? (
          <>
          <EmptyState icon="navigation" title={t('No active route')} description={t('When the owner dispatches a storm with you on a route (as its lead or crew), the stops show up here. Finished storms are in Settings, under Past storms.')} />
          </>
        ) : (
          <>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: spacing.xs }]} numberOfLines={1}>
              {routeHeaderLine(route.name, route.services.map(svcLabel))}
            </Text>
            <View style={styles.progressRow} accessible accessibilityLabel={progressText}>
              <ProgressBar progress={progress.percent} height={5} style={{ flex: 1 }} />
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{progressText}</Text>
            </View>
            {!working ? (
              <InlineNotice icon="info" tone="info" text={route.cancelled ? t('This route was cancelled.') : t('This storm has ended. Nothing more to do here.')} style={{ marginTop: spacing.md }} />
            ) : null}

            {working && current && currentGroup ? (
              <View style={[styles.card, { backgroundColor: colors.surface, marginTop: spacing.md, gap: spacing.md }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text style={[typeScale.overline, { color: colors.textSecondary, flex: 1 }]}>
                    {groupStatus(currentGroup) === 'pending' ? t('NEXT STOP') : t('CURRENT STOP')}
                  </Text>
                  <StatusBadge label={t(cardStatusWord(groupStatus(currentGroup)))} status={STOP_TONE[groupStatus(currentGroup)]} />
                </View>
                <View style={{ gap: 2 }}>
                  <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{current.propertyName}</Text>
                  {street ? <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{street}</Text> : null}
                  {place ? <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>{place}</Text> : null}
                  {route.services.length > 1 ? (
                    <Text style={[typeScale.labelLarge, { color: colors.primary, marginTop: 2 }]}>{servicesText(groupServices(currentGroup), svcLabel)}</Text>
                  ) : null}
                </View>
                {current.ownerNote ? (
                  <InlineNotice icon="file-text" tone="info" text={current.ownerNote} />
                ) : null}
                <Button title={t('Directions')} icon="navigation" variant="secondary" size="lg" style={styles.squared} onPress={() => openDirections({ address: current.propertyAddress })} fullWidth />
                {!isLead ? (
                  <InlineNotice icon="eye" tone="info" text={t("You're on this route's crew. The route lead marks arrivals, completes stops and adds photos.")} />
                ) : primaryActionFor(groupStatus(currentGroup)) === 'arrive' ? (
                  <Button title={t("I'm Here")} icon="map-pin" size="lg" style={styles.squared} loading={busy} onPress={() => act(() => arriveGroup(currentGroup), t("Can't start this stop"))} fullWidth />
                ) : (
                  <>
                    {/* The database requires the stop's photos before it can be completed, so they are added here, between arriving and completing. */}
                    <Button
                      title={addedCount ? t('Add photos ({n} added)', { n: addedCount }) : t('Add photos')}
                      icon="camera"
                      variant="secondary"
                      size="lg"
                      style={styles.squared}
                      disabled={busy}
                      onPress={async () => {
                        const drafts = await pickSnowMedia();
                        if (!drafts.length) return;
                        // Instant: the photos are queued and upload in the background, so there is nothing to wait for here.
                        const res = await addCompletionMedia(route.companyId, current.id, drafts);
                        if (!res.ok) showMessage(t("Couldn't add the photos"), t(res.error));
                      }}
                      fullWidth
                    />
                    <SnowUploadStatus uploading={uploading} failed={failedJobs} />
                    {stopPhotos.length ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                        {stopPhotos.map((p) => (
                          <Pressable key={p.id} onPress={() => setViewingPhoto(p.id)} accessibilityRole="button" accessibilityLabel={t('Open photo')}>
                            <Image source={{ uri: p.url }} style={{ width: 72, height: 72, borderRadius: radius.md }} contentFit="cover" />
                          </Pressable>
                        ))}
                      </ScrollView>
                    ) : null}
                    <Input label={t('Note (optional)')} value={note} onChangeText={setNote} placeholder={t('Anything the owner should know')} />
                    {needMedia > 0 ? (
                      <Text style={[typeScale.caption, { color: colors.warning }]}>
                        {addedCount > 0
                          ? t('{added} of {min} photos added. You can still complete this stop; add the rest if you can.', { added: addedCount, min: route.minMedia })
                          : t('No photos added yet. You can still complete this stop; add photos first if you can.')}
                      </Text>
                    ) : null}
                    <Button
                      title={t('Complete Stop')}
                      icon="check-circle"
                      size="lg"
                      style={styles.squared}
                      loading={busy}
                      onPress={async () => { if (await act(() => finishGroup(currentGroup), t("Can't complete yet"))) setNote(''); }}
                      fullWidth
                    />
                  </>
                )}
                {isLead ? currentGroup.filter((v) => v.status !== 'completed' && v.status !== 'skipped').map((v) => (
                  <View key={v.id} style={{ gap: spacing.xs }}>
                    {currentGroup.length > 1 ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{svcLabel(v.service ?? route.service)}</Text> : null}
                    <LeadSkipPanel visitId={v.id} disabled={busy} onChanged={reload} />
                  </View>
                )) : null}
              </View>
            ) : null}
            {working && current && currentGroup ? (
              <>
                {Array.from(new Set(groupServices(currentGroup))).map((sv) => (
                  <View key={sv}>
                    <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>
                      {t('{service} instructions', { service: svcLabel(sv) })}
                    </Text>
                    <SnowServiceReferenceCard propertyId={current.propertyId} service={sv} />
                  </View>
                ))}
              </>
            ) : null}
            {working && !current && groups.length ? (
              <InlineNotice icon="check-circle" tone="success" text={t('Every stop on this route is done.')} style={{ marginTop: spacing.md }} />
            ) : null}

            <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>{t('All stops')}</Text>
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {groups.map((g, i) => {
                const s = g[0];
                const status = groupStatus(g);
                const word = stopStatusWord(status, working && g === currentGroup);
                const open = openStopId === s.id;
                return (
                <View key={s.id} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight } : undefined}>
                <Pressable
                  onPress={() => setOpenStopId(open ? null : s.id)}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={open ? t('Stop {n}, {name}. Hide instructions and photos', { n: i + 1, name: s.propertyName }) : t('Stop {n}, {name}. Show instructions and photos', { n: i + 1, name: s.propertyName })}
                  accessibilityState={{ expanded: open }}
                >
                  <View style={[styles.numberMarker, { backgroundColor: colors.backgroundTertiary }]} accessible accessibilityLabel={t('Stop {n}', { n: i + 1 })}>
                    <Text style={[typeScale.labelLarge, { color: colors.textSecondary }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{s.propertyName}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{s.propertyAddress}</Text>
                    {route.services.length > 1 ? <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{servicesText(groupServices(g), svcLabel)}</Text> : null}
                    {s.ownerNote ? <Text style={[typeScale.caption, { color: colors.primary }]} numberOfLines={2}>{s.ownerNote}</Text> : null}
                  </View>
                  {word === 'Completed' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <Icon name="check-circle" size={18} color={colors.success} />
                      <Text style={[typeScale.labelLarge, { color: colors.success }]}>{t('Completed')}</Text>
                    </View>
                  ) : (
                    <StatusBadge label={t(word)} status={word === 'Arrived' ? 'info' : word === 'Skipped' ? 'warning' : 'neutral'} />
                  )}
                  <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
                </Pressable>
                {open ? (
                  <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md }}>
                    {Array.from(new Set(groupServices(g))).map((sv) => (
                      <View key={sv}>
                        <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>{t('{service} instructions and photos', { service: svcLabel(sv) })}</Text>
                        <SnowServiceReferenceCard propertyId={s.propertyId} service={sv} />
                      </View>
                    ))}
                  </View>
                ) : null}
                </View>
                );
              })}
            </View>
          </>
        )}

        {/* Past work is not on the Route tab at all: it lives in Settings > Past storms (pastOnly). */}
        {!historyId && pastOnly && pastRoutes.length > 0 ? (
          <>
            <Pressable onPress={() => { if (!pastOnly) setShowHistory(!showHistory); }} style={styles.historyHeader} accessibilityRole="button" accessibilityState={{ expanded: showHistory || !!pastOnly }}>
              <Text style={[typeScale.overline, { color: colors.textSecondary, flex: 1 }]}>{t('PAST WORK ({n})', { n: pastRoutes.length })}</Text>
              {pastOnly ? null : <Icon name={showHistory ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />}
            </Pressable>
            {showHistory || pastOnly ? (
              <View style={[styles.group, { backgroundColor: colors.surface }]}>
                {pastRoutes.map((r, i) => (
                  <Pressable
                    key={r.id}
                    onPress={() => { setHistoryId(r.id); setLoading(true); }}
                    style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}
                    accessibilityRole="button"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{r.name}</Text>
                      <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{r.stormName} · {servicesText(r.services ?? [r.service], svcLabel)} · {t('Ended')}</Text>
                    </View>
                    <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <PhotoPager
        photos={stopPhotos}
        startId={viewingPhoto}
        onClose={() => setViewingPhoto(null)}
        actionsFor={(ph) => (isLead ? [{
          key: 'delete', label: t('Delete'), icon: 'trash-2', destructive: true,
          onPress: () => confirmAction(t('Delete this photo?'), t('It is removed for good.'), t('Delete'), async () => {
            const res = await deleteMedia(ph.id);
            if (!res.ok) showMessage(t("Couldn't delete"), res.error);
            reload();
          }, true),
        }] : [])}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  backToCurrent: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  historyHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: spacing.sm },
  clockLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  clockDot: { width: 8, height: 8, borderRadius: 4 },
  squared: { borderRadius: radius.md },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  numberMarker: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  chip: { borderRadius: radius.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  label: { marginLeft: spacing.sm, marginBottom: spacing.sm, marginTop: spacing.xl },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 52 },
});
