/**
 * Snow Mode → Storms tab (Owner). Active, draft and ended storms, newest
 * first, with a button to create one. Several storms can be active at once.
 *
 * Working layout in the existing app style; no approved mockup yet.
 */
import { DateStrip } from '@/components/ui/DateStrip';
import { localDateKey } from '@/lib/ids';
import { servicesLabel, stormServices } from '@/lib/snowServices';
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Icon, InlineNotice, LoadingSpinner, StatusBadge } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useSnowStorms } from '@/hooks/useSnowStorms';
import { SERVICE_LABEL, STORM_STATUS_LABEL } from '@/data/snowStorms';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { SERVICE_ICON, type SnowStorm } from '@/types/snow';
import { shortWhen } from '@/lib/snowFormat';

export const STATUS_TONE = { draft: 'neutral', dispatched: 'info', ended: 'success' } as const;

function when(storm: SnowStorm): string {
  const fmt = shortWhen;
  if (storm.status === 'ended' && storm.endedAt) return `Ended ${fmt(storm.endedAt)}`;
  if (storm.status === 'dispatched' && storm.lastReopenedAt) return `Reopened ${fmt(storm.lastReopenedAt)}`;
  if (storm.status === 'dispatched' && storm.dispatchedAt) return `Dispatched ${fmt(storm.dispatchedAt)}`;
  return `Created ${fmt(storm.createdAt)}`;
}

export function StormsListScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const all = useSnowStorms();
  const { loading, error, reload } = all;
  // Day cards: tap a day to see only the storms of that day (a storm's day is when it was dispatched, or created if it was not yet).
  const [day, setDay] = useState<string | null>(null);
  const dayOf = (st: SnowStorm) => localDateKey(new Date(st.dispatchedAt ?? st.createdAt));
  const days = Array.from(new Set([...all.active, ...all.drafts, ...all.ended].map(dayOf))).sort().reverse().slice(0, 14);
  const keep = (list: SnowStorm[]) => (day ? list.filter((st) => dayOf(st) === day) : list);
  const active = keep(all.active);
  const drafts = keep(all.drafts);
  const ended = keep(all.ended);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  const open = (id: string) => router.push({ pathname: '/snow/owner/storm/[id]', params: { id } });

  function section(title: string, list: SnowStorm[]) {
    if (!list.length) return null;
    return (
      <View style={styles.section}>
        <Text style={[typeScale.overline, styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          {list.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => open(s.id)}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${s.name}, ${servicesLabel(stormServices(s), (x) => SERVICE_LABEL[x])}, ${STORM_STATUS_LABEL[s.status]}`}
            >
              <View style={[styles.rowIcon, { backgroundColor: colors.primarySurface }]}>
                <Icon name={stormServices(s).length > 1 ? 'cloud-snow' : SERVICE_ICON[s.service]} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{s.name}</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
                  {servicesLabel(stormServices(s), (x) => SERVICE_LABEL[x])} · {when(s)}
                </Text>
              </View>
              <StatusBadge label={STORM_STATUS_LABEL[s.status]} status={STATUS_TONE[s.status]} />
              <Icon name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  const empty = !loading && !error && !all.active.length && !all.drafts.length && !all.ended.length;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: clearance + spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={[typeScale.displaySmall, { color: colors.textPrimary, flex: 1, flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} accessibilityRole="header">Storms</Text>
          <View style={{ flexShrink: 0, marginLeft: spacing.md }}><Button title="Crew" icon="plus" size="sm" onPress={() => router.push('/snow/owner/storm-new')} /></View>
        </View>

        <DateStrip dates={days} selected={day} onSelect={setDay} />
        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginBottom: spacing.lg }} /> : null}
        {loading ? <LoadingSpinner /> : null}
        {empty ? (
          <EmptyState
            icon="cloud-snow"
            title="No storms yet"
            description="Create a storm for a service, plan its routes, then dispatch it when you're ready."
            actionTitle="Crew"
            onAction={() => router.push('/snow/owner/storm-new')}
          />
        ) : null}
        {section('Active', active)}
        {section('Drafts', drafts)}
        {section('Ended', ended)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg, marginLeft: spacing.xs },
  section: { marginBottom: spacing.xl },
  sectionTitle: { marginLeft: spacing.sm, marginBottom: spacing.sm },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 60 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
