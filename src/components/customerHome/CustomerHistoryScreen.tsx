/**
 * Every visit to one property for one service (Snow or Lawn), season by season: the date, what was done, when the crew arrived and left, and
 * the photos. Opened from "See all visits" on the property's Snow or Lawn tab. Real data only (useCustomerHome).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, ScreenHeader } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { PhotoPager, type PagerPhoto } from '@/components/media/PhotoPager';
import { TaskMediaViewer, type TaskMediaItem } from '@/components/tasks/TaskMedia';
import { Stats } from '@/components/customerHome/PropertyHome';
import { useCustomerHome } from '@/hooks/useCustomerHome';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import {
  SERVICE_LABEL, lawnVisits, seasonKey, seasonLabel, seasonsOf, shortDate, snowVisits, visitStats, visitTimes, visitsIn,
} from '@/lib/customerProperty';
import { semantic } from '@/theme/colors';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export function CustomerHistoryScreen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ service?: string; property?: string }>();
  const service: 'snow' | 'lawn' = params.service === 'lawn' ? 'lawn' : 'snow';
  // Snow is blue, Lawn is green.
  const accent = service === 'snow' ? semantic.info : colors.primary;
  const data = useCustomerHome();
  const group = data.groups.find((g) => g.key === params.property);
  const visits = useMemo(
    () => (!group ? [] : service === 'snow' ? snowVisits(data.timeline ?? [], group) : lawnVisits(data.lawn ?? [], group)),
    [group, service, data.timeline, data.lawn],
  );
  const seasons = seasonsOf(visits, service);
  const [season, setSeason] = useState<string>(() => seasonKey(new Date().toISOString(), service));
  const current = seasons.includes(season) ? season : seasons[0];
  const list = visitsIn(visits, service, current);
  const stats = visitStats(visits, service, current);
  const [pager, setPager] = useState<{ photos: PagerPhoto[]; startId: string } | null>(null);
  const [viewer, setViewer] = useState<{ items: TaskMediaItem[]; index: number } | null>(null);

  const openPhotos = (id: string) => {
    if (service === 'snow') {
      const entry = (data.timeline ?? []).find((e) => e.visitId === id);
      const items: TaskMediaItem[] = (entry?.media ?? []).filter((m) => m.url).map((m) => ({ key: m.id, uri: m.url as string, mediaType: m.kind === 'photo' ? 'image' : 'video' }));
      if (items.length) setViewer({ items, index: 0 });
      return;
    }
    const upd = (data.lawn ?? []).find((u) => u.stopId === id);
    const photos = (upd?.photos ?? []).map((p) => ({ id: p.id, url: p.url, key: p.key }));
    if (photos.length) setPager({ photos, startId: photos[0].id });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title={t(SERVICE_LABEL[service]) + ' ' + t('visits')} subtitle={group?.name} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'], gap: spacing.lg }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} style={{ marginHorizontal: -spacing.lg }}>
          <View style={{ width: spacing.lg - spacing.sm }} />
          {seasons.map((s) => {
            const on = s === current;
            return (
              <Pressable key={s} onPress={() => setSeason(s)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, { backgroundColor: on ? accent : colors.surface, borderColor: on ? accent : colors.border }]}>
                <Text style={[typeScale.labelLarge, { color: on ? colors.background : colors.textPrimary, fontWeight: '700' }]}>{seasonLabel(s, service)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Stats accent={accent} items={[
          { value: String(stats.visits), label: t('Visits') },
          { value: stats.lastAt ? shortDate(stats.lastAt) : '–', label: t('Last visit') },
          { value: String(stats.photos), label: t('Photos') },
        ]} />

        {list.length === 0 ? (
          <EmptyState icon="calendar" title={t('No visits in this season')} description={t('When we visit, it will be listed here with the time and photos.')} />
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
            {list.map((v, n) => (
              <Pressable
                key={v.id}
                onPress={() => openPhotos(v.id)}
                disabled={v.photos === 0}
                accessibilityRole={v.photos ? 'button' : undefined}
                accessibilityLabel={`${shortDate(v.completedAt)}. ${v.title}. ${visitTimes(v, t)}${v.photos ? '. ' + (v.photos === 1 ? t('1 photo') : t('{count} photos', { count: v.photos })) : ''}`}
                style={[styles.row, n > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[typeScale.overline, { color: colors.textSecondary }]}>{shortDate(v.completedAt).toUpperCase()}</Text>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{v.title}</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{visitTimes(v, t)}</Text>
                </View>
                {v.photos > 0 ? (
                  <View style={styles.photoLink}>
                    <Text style={[typeScale.labelSmall, { color: colors.primary, fontWeight: '700' }]}>{(v.photos === 1 ? t('1 photo') : t('{count} photos', { count: v.photos }))}</Text>
                    <Icon name="chevron-right" size={16} color={colors.primary} />
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
      <PhotoPager photos={pager?.photos ?? []} startId={pager?.startId ?? null} onClose={() => setPager(null)} />
      <TaskMediaViewer items={viewer?.items ?? []} index={viewer ? viewer.index : null} onIndexChange={(i) => setViewer((v) => (v ? { ...v, index: i } : v))} onClose={() => setViewer(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chip: { paddingHorizontal: spacing.md, height: 38, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 64 },
  photoLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
