/**
 * The customer's Home, one property at a time. A row of property chips, the property's name, and its projects. Finished projects sit in a
 * quiet "Past work" row at the bottom. Everything comes from real data (useCustomerHome); a line with no data behind it is simply left out.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { OptimizedImage } from '@/components/ui';
import { PhotoPager, type PagerPhoto } from '@/components/media/PhotoPager';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useProject } from '@/hooks/useProject';
import { db } from '@/data/store';
import type { CustomerHomeData } from '@/hooks/useCustomerHome';
import type { HomeItem } from '@/lib/customerHome';
import type { PropertyGroup } from '@/lib/customerProperty';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function PropertyHome({ data }: { data: CustomerHomeData }) {
  const t = useT();
  const { colors } = useTheme();
  const { groups, past } = data;
  const [picked, setPicked] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const group = groups.find((g) => g.key === picked) ?? groups[0];

  return (
    <View>
      {groups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsWrap}>
          {groups.map((g) => {
            const on = g.key === group?.key;
            return (
              <Pressable
                key={g.key}
                onPress={() => setPicked(g.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={g.name}
                style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.primary + '40' }]}
              >
                <Text style={[typeScale.labelLarge, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{g.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {group ? (
        <>
          <View style={{ marginTop: spacing.lg }}>
            {group.address ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, fontWeight: '600' }]}>{group.address}</Text> : null}
            <Text style={[typeScale.displaySmall, { color: colors.textPrimary, fontWeight: '800' }]} accessibilityRole="header">{group.name}</Text>
          </View>
          <View style={{ marginTop: spacing.lg }}>
            <ProjectPane group={group} />
          </View>
        </>
      ) : null}

      {past.length > 0 ? (
        <View style={{ marginTop: spacing['2xl'] }}>
          <Pressable onPress={() => setShowPast((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showPast }} style={styles.pastRow}>
            <Text style={[typeScale.labelLarge, { color: colors.textSecondary, flex: 1 }]}>{t('Past work')} {'·'} {t('{count} completed', { count: past.length })}</Text>
            <Icon name={showPast ? 'chevron-down' : 'chevron-right'} size={18} color={colors.textTertiary} />
          </Pressable>
          {showPast ? (
            <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
              {past.map((i, n) => <PastRow key={i.key} item={i} first={n === 0} />)}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ── Project ──────────────────────────────────────────────────────────────────

function ProjectPane({ group }: { group: PropertyGroup }) {
  const projects = group.items.filter((i) => i.kind === 'project');
  return <View style={{ gap: spacing.lg }}>{projects.map((p) => <ProjectCard key={p.key} item={p} />)}</View>;
}

function ProjectCard({ item }: { item: HomeItem }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const id = item.key.slice('project:'.length);
  const { photos } = useProject(id);
  const [viewing, setViewing] = useState<{ photos: PagerPhoto[]; startId: string } | null>(null);
  const shared = useMemo(
    () => photos.filter((p) => p.isCustomerVisible).sort((a, b) => (b.sharedAt ?? b.createdAt ?? '').localeCompare(a.sharedAt ?? a.createdAt ?? '')),
    [photos],
  );
  const shown = shared.slice(0, 3);
  const extra = shared.length - shown.length;
  const held = item.status === 'on_hold';
  const project = db.projects.find((p) => p.id === id);
  const open = () => router.push(`/(customer)/project?id=${id}` as never);
  return (
    <View style={[styles.projectCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }, shadow.sm]}>
      <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>{item.name}</Text>
      <View style={styles.rowBetween}>
        <Text style={[typeScale.labelLarge, { color: held ? semantic.warning : semantic.success, fontWeight: '700' }]}>{held ? t('On hold') : t('In progress')}</Text>
        {item.progress != null && !held ? <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>{item.progress}%</Text> : null}
      </View>
      {item.progress != null && !held ? (
        <View style={[styles.barTrack, { backgroundColor: colors.borderLight }]}><View style={[styles.barFill, { width: `${Math.max(0, Math.min(100, item.progress))}%`, backgroundColor: colors.primary }]} /></View>
      ) : null}
      {item.latestUpdate ? (
        <View>
          <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={2}>{item.latestUpdate.title}</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{t('Last update {date}', { date: fmtDate(item.latestUpdate.at) })}</Text>
        </View>
      ) : null}
      {shown.length ? (
        <View style={styles.tiles}>
          {shown.map((p, i) => (
            <Pressable key={p.id} onPress={() => setViewing({ photos: shared.map((s) => ({ id: s.id, url: s.fileUrl })), startId: p.id })} accessibilityRole="button" accessibilityLabel={t('View photo')} style={[styles.tile, { backgroundColor: colors.borderLight }]}>
              <OptimizedImage source={p.fileUrl} style={StyleSheet.absoluteFill as never} />
              {i === shown.length - 1 && extra > 0 ? <View style={styles.tileMore}><Text style={[typeScale.headingSmall, { color: '#FFFFFF' }]}>+{extra}</Text></View> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <SeeAll label={project ? t('Open project') : t('Open')} onPress={open} />
      <PhotoPager photos={viewing?.photos ?? []} startId={viewing?.startId ?? null} onClose={() => setViewing(null)} />
    </View>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────────

function SeeAll({ label, onPress, accent }: { label: string; onPress: () => void; accent?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.seeAll}>
      <Text style={[typeScale.labelLarge, { color: accent ?? colors.primary, fontWeight: '700', flex: 1 }]}>{label}</Text>
      <Icon name="chevron-right" size={18} color={accent ?? colors.primary} />
    </Pressable>
  );
}

function PastRow({ item, first }: { item: HomeItem; first: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/(customer)/project?id=${item.key.slice('project:'.length)}` as never)}
      accessibilityRole="button"
      accessibilityLabel={t('Completed project: {name}. {address}. Open', { name: item.name, address: item.address })}
      style={[styles.pastItem, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
    >
      <Icon name="check-circle" size={18} color={semantic.success} />
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
          {[item.address, item.completedAt ? t('Completed {date}', { date: fmtDate(item.completedAt) }) : t('Completed')].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Open')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipsWrap: { marginHorizontal: -spacing.lg },
  chips: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: spacing.md, height: 40, borderRadius: radius.full, borderWidth: 1, maxWidth: 220 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden' },
  tileMore: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(15,25,35,0.5)', alignItems: 'center', justifyContent: 'center' },
  seeAll: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  projectCard: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  pastRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: spacing.xs },
  list: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginTop: spacing.xs },
  pastItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, minHeight: 56 },
});
