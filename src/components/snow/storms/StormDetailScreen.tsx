/**
 * One storm (Owner): the setup (crew, crew lead, properties, edited right here), the lifecycle actions (Dispatch a draft,
 * End Storm always confirmed, Reopen an ended one), and on a dispatched storm the progress numbers. The database decides
 * what's allowed; this screen shows its answer. The storm's route is created automatically; a saved route template can be
 * added as another route. Layout: the approved icy-blue design (winter picture behind the header only, white cards).
 */
import { dispatchGaps } from '@/lib/snowCrew';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable, ImageBackground } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Button, EmptyState, GlassIconButton, Icon, InlineNotice, LoadingSpinner, ProgressBar, ScreenHeader } from '@/components/ui';
import { SnowPill } from '@/components/snow/SnowPill';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { STORM_PILL } from '@/lib/snowStormView';
import { useTheme } from '@/providers/ThemeProvider';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  deleteDraftStorm, dispatchStorm, endStorm, endStormConfirmation, loadStormRoutes,
  previewEndStorm, reopenStorm, SERVICE_LABEL, STORM_STATUS_LABEL,
  type StormRouteRow, type StormSummary,
} from '@/data/snowStorms';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { SnowStorm } from '@/types/snow';
import { servicesLabel, stormServices } from '@/lib/snowServices';
import { addRouteFromTemplate, createRoute, loadRouteTemplates, type RouteTemplate } from '@/data/snowRoutes';
import { RouteEditor } from '@/components/snow/routes/RouteEditScreen';

/** The winter header picture, bundled with the app (made by scripts/make-storm-header.py from assets/source/snow-panorama.jpg). */
const STORM_HEADER_IMAGE = require('../../../../assets/images/snow-storm-header.jpg');

export function StormDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [storm, setStorm] = useState<SnowStorm | null>(null);
  const [summary, setSummary] = useState<StormSummary | null>(null);
  const [routes, setRoutes] = useState<StormRouteRow[]>([]);
  const [templates, setTemplates] = useState<RouteTemplate[]>([]);
  // Bumped on every reload so the embedded route editors refresh with the summary (realtime updates included).
  const [reloadToken, setReloadToken] = useState(0);
  const [dragging, setDragging] = useState(false);
  const ensured = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!id) return;
    const ticket = ++latest.current;
    const [s, r] = await Promise.all([previewEndStorm(id), loadStormRoutes(id)]);
    if (ticket !== latest.current) return;
    setLoading(false);
    if (!s.ok) return setError(s.error);
    setError(r.ok ? null : r.error);
    setStorm(s.data.storm);
    setSummary(s.data.summary);
    if (r.ok) setRoutes(r.data);
    // The storm you create is the route: make it now so there is something to add properties to. Only when the storm never
    // had one (a storm whose routes were all cancelled gets a "New route" button instead of a silent replacement).
    if (r.ok && s.data.storm.status !== 'ended' && r.data.length === 0 && ensured.current !== s.data.storm.id) {
      ensured.current = s.data.storm.id;
      const made = await makeRoute(s.data.storm);
      if (!made.ok) {
        // Say so and let pull-to-refresh try again, instead of leaving a draft with no route and no message.
        ensured.current = null;
        if (ticket === latest.current) setError(made.error);
      }
      const again = await loadStormRoutes(id);
      if (ticket === latest.current && again.ok) setRoutes(again.data);
    }
    if (s.data.storm.status !== 'ended') {
      const t = await loadRouteTemplates(stormServices(s.data.storm));
      if (ticket === latest.current && t.ok) setTemplates(t.data);
    }
    if (ticket === latest.current) setReloadToken((n) => n + 1);
  }, [id]);

  /** One route does every service of the storm together (for example plowing + salting on one truck). */
  async function makeRoute(st: SnowStorm): Promise<{ ok: true } | { ok: false; error: string }> {
    const services = stormServices(st);
    const combined = await createRoute(st.id, { name: st.name, service: services[0], services, mediaRequired: false, minMedia: 1 });
    if (combined.ok) return { ok: true };
    // A database without update 61 can't have one route do several services: fall back to one route per service.
    if (services.length > 1 && /services/i.test(combined.error)) {
      for (const sv of services) {
        const one = await createRoute(st.id, { name: `${st.name} · ${SERVICE_LABEL[sv]}`, service: sv, mediaRequired: false, minMedia: 1 });
        if (!one.ok) return { ok: false, error: one.error };
      }
      return { ok: true };
    }
    return { ok: false, error: combined.error };
  }

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    reload();
    if (!id || !isSupabaseConfigured) return;
    const channel = supabase.channel(`snow-storm-${id}`);
    for (const table of ['snow_storms', 'snow_routes', 'snow_visits', 'snow_skip_requests']) {
      const filter = table === 'snow_storms' ? `id=eq.${id}` : `storm_id=eq.${id}`;
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => {
        // A storm in progress changes in bursts (arrive, photos, complete); collapse them into one reload.
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => { reload(); }, 400);
      });
    }
    channel.subscribe();
    return () => { if (debounce.current) clearTimeout(debounce.current); supabase.removeChannel(channel); };
  }, [id, reload]);

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  async function run(action: () => ReturnType<typeof endStorm>, failTitle: string) {
    setBusy(true);
    const res = await action();
    setBusy(false);
    if (!res.ok) return showMessage(failTitle, res.error);
    setStorm(res.data.storm);
    setSummary(res.data.summary);
  }

  function onDispatch() {
    if (!storm) return;
    const gaps = dispatchGaps(routes.filter((r) => !r.cancelled));
    if (gaps.length) return showMessage('Not ready to dispatch', `${gaps.join('. ')}.`);
    confirmAction(
      `Dispatch ${storm.name}?`,
      'Route leads can start their routes. You can still add stops, reorder and reassign leads after dispatching.',
      'Dispatch',
      () => run(() => dispatchStorm(storm.id), 'Can\'t dispatch yet'),
    );
  }

  async function onEnd() {
    if (!storm) return;
    // Fresh numbers for the confirmation, not whatever was on screen.
    setBusy(true);
    const preview = await previewEndStorm(storm.id);
    setBusy(false);
    if (!preview.ok) return showMessage('Couldn\'t check the storm', preview.error);
    const { title, message } = endStormConfirmation(preview.data.storm, preview.data.summary);
    confirmAction(title, message, 'End storm', () => run(() => endStorm(storm.id), 'Couldn\'t end the storm'), true);
  }

  function onReopen() {
    if (!storm) return;
    confirmAction(
      `Reopen ${storm.name}?`,
      'Earlier work stays recorded as it is. No customer notifications or photos are sent again. Add new stops for extra passes.',
      'Reopen',
      () => run(() => reopenStorm(storm.id), 'Couldn\'t reopen the storm'),
    );
  }

  function onDelete() {
    if (!storm) return;
    confirmAction(`Delete ${storm.name}?`, 'This draft and its planned routes will be removed.', 'Delete', async () => {
      setBusy(true);
      const res = await deleteDraftStorm(storm.id);
      setBusy(false);
      if (!res.ok) return showMessage('Couldn\'t delete the draft', res.error);
      router.back();
    }, true);
  }

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
        <ScreenHeader title="Storm" />
        <LoadingSpinner />
      </View>
    );
  }
  if (!storm) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
        <ScreenHeader title="Storm" />
        <EmptyState icon="cloud-off" title="Storm not available" description={error ?? 'It may have been deleted.'} />
      </View>
    );
  }

  const s = summary;
  const remaining = s ? s.pending + s.arrived : 0;
  const progress = s && s.visits ? Math.round((s.completed / s.visits) * 100) : 0;
  const tone = STORM_PILL[storm.status];
  const servicesText = servicesLabel(stormServices(storm), (x) => SERVICE_LABEL[x]);
  const liveRoutes = routes.filter((r) => !r.cancelled);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={{ paddingBottom: storm.status === 'draft' ? spacing['2xl'] : insets.bottom + spacing['4xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* The header picture is decorative: it sits behind the title only and never behind the cards. */}
        <ImageBackground
          source={STORM_HEADER_IMAGE}
          resizeMode="cover"
          style={[styles.header, { paddingTop: insets.top + spacing.sm }]}
          accessibilityIgnoresInvertColors
        >
          <LinearGradient pointerEvents="none" colors={['transparent', colors.groupedBackground]} style={styles.headerFade} />
          <View style={styles.headerTop}>
            <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
            <SnowPill label={STORM_STATUS_LABEL[storm.status]} fg={tone.fg} bg={tone.bg} />
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">{`${servicesText} Route`}</Text>
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: 2 }]}>{storm.name}</Text>
          {storm.notes ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]} numberOfLines={3}>{storm.notes}</Text> : null}
        </ImageBackground>

        <View style={styles.body}>
          {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginBottom: spacing.md }} /> : null}

          {/* The progress numbers only mean something once the storm is dispatched; a draft is just being set up. */}
          {s && storm.status !== 'draft' ? (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.stats}>
                <Stat label="Completed" value={s.completed} color={colors.textPrimary} sub={colors.textSecondary} />
                <Stat label="Remaining" value={remaining} color={colors.textPrimary} sub={colors.textSecondary} divider={colors.border} />
                <Stat label="Skipped" value={s.skipped} color={colors.textPrimary} sub={colors.textSecondary} divider={colors.border} />
                <Stat label={s.routes === 1 ? 'Route' : 'Routes'} value={s.routes} color={colors.textPrimary} sub={colors.textSecondary} divider={colors.border} />
              </View>
              <View style={styles.progressRow}>
                <ProgressBar progress={progress} height={6} style={{ flex: 1 }} />
                <Text style={[typeScale.labelSmall, { color: colors.textSecondary }]}>{progress}% complete</Text>
              </View>
              {s.pendingSkipRequests > 0 ? (
                <InlineNotice
                  icon="flag"
                  tone="warning"
                  text={`${s.pendingSkipRequests} skip ${s.pendingSkipRequests === 1 ? 'request needs' : 'requests need'} your decision`}
                  style={{ marginTop: spacing.md }}
                />
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: spacing.xl }}>
            {liveRoutes.length === 0 && routes.length > 0 && storm.status !== 'ended' ? (
              <View style={{ gap: spacing.md }}>
                <InlineNotice icon="slash" tone="warning" text="Every route on this storm was cancelled." />
                <Button
                  title="New route"
                  icon="plus"
                  variant="secondary"
                  loading={busy}
                  onPress={async () => {
                    setBusy(true);
                    const made = await makeRoute(storm);
                    setBusy(false);
                    if (!made.ok) return showMessage("Couldn't create the route", made.error);
                    reload();
                  }}
                  fullWidth
                />
              </View>
            ) : null}
            {liveRoutes.map((r) => (
              <View key={r.id} style={{ marginBottom: spacing.lg }}>
                {liveRoutes.length > 1 ? (
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.sm }]}>{SERVICE_LABEL[r.service]}</Text>
                ) : null}
                <RouteEditor routeId={r.id} onDragActive={setDragging} refreshToken={reloadToken} onRouteCancelled={reload} />
              </View>
            ))}
            {storm.status !== 'ended' && templates.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={[typeScale.overline, { color: colors.textTertiary, marginBottom: spacing.sm, marginLeft: spacing.sm }]}>SAVED TEMPLATES</Text>
                {templates.map((t) => (
                  <Pressable
                    key={t.id}
                    disabled={busy}
                    onPress={() => confirmAction(
                      `Add "${t.name}"?`,
                      `Adds a ${SERVICE_LABEL[t.service].toLowerCase()} route with its ${t.stops} saved ${t.stops === 1 ? 'stop' : 'stops'} to this storm.`,
                      'Add route',
                      async () => {
                        setBusy(true);
                        const res = await addRouteFromTemplate(storm.id, t.id);
                        setBusy(false);
                        if (!res.ok) return showMessage("Couldn't add the route", res.error);
                        reload();
                      },
                    )}
                    style={[styles.templateRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a route from the template ${t.name}`}
                  >
                    <Icon name="copy" size={18} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{t.name}</Text>
                      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{SERVICE_LABEL[t.service]} · {t.stops} {t.stops === 1 ? 'stop' : 'stops'}</Text>
                    </View>
                    <Icon name="plus" size={18} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          {storm.status !== 'draft' ? (
            <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
              {storm.status === 'dispatched' ? (
                <Button title="End storm" icon="flag" variant="danger" onPress={onEnd} loading={busy} fullWidth size="lg" />
              ) : null}
              {storm.status === 'ended' ? (
                <Button title="Reopen storm" icon="rotate-ccw" variant="secondary" onPress={onReopen} loading={busy} fullWidth size="lg" />
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>
      {storm.status === 'draft' ? (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm, backgroundColor: colors.groupedBackground }]}>
          <Button title="Dispatch Storm" icon="send" onPress={onDispatch} loading={busy} fullWidth size="lg" />
          <Button title="Save Draft" variant="ghost" onPress={() => router.back()} disabled={busy} fullWidth />
          <Pressable onPress={onDelete} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete draft">
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Delete draft</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value, color, sub, divider }: { label: string; value: number; color: string; sub: string; divider?: string }) {
  return (
    <View style={[styles.stat, divider ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: divider } : null]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[typeScale.bodySmall, { color: sub }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 176, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  headerFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  bottomBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs, alignItems: 'center' },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.4 },
  body: { paddingHorizontal: spacing.lg, marginTop: -spacing.md },
  card: { borderRadius: radius.lg, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth },
  stats: { flexDirection: 'row' },
  stat: { alignItems: 'center', flex: 1, paddingVertical: spacing.xs },
  statValue: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.sm },
});
