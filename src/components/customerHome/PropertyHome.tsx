/**
 * The customer's Home, one property at a time. A row of property chips (with a dot for what a crew is doing there), the property's name, and,
 * only when the property has more than one kind of service, a switch with one tab each: Snow, Lawn, Project. Each tab has its own layout and
 * the three never share a list. Finished projects sit in a quiet "Past work" row at the bottom. Everything comes from real data
 * (useCustomerHome); a line with no data behind it is simply left out.
 */
import { VideoThumb } from '@/components/media/VideoThumb';
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Icon } from '@/components/ui/Icon';
import { OptimizedImage } from '@/components/ui';
import { PrivatePhoto } from '@/components/media/PrivatePhoto';
import { PhotoPager, type PagerPhoto } from '@/components/media/PhotoPager';
import { TaskMediaViewer, type TaskMediaItem } from '@/components/tasks/TaskMedia';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useProject } from '@/hooks/useProject';
import { db } from '@/data/store';
import type { CustomerHomeData } from '@/hooks/useCustomerHome';
import type { HomeItem } from '@/lib/customerHome';
import { SERVICE_NAME, lastServiceLabel, sortServices, statusView, type SnowSvc, type TimelineEntry } from '@/lib/customerSnow';
import {
  SERVICE_LABEL, attentionOf, defaultService, lawnVisits, nextVisitLabel, seasonKey, shortDate, snowVisits, visitStats,
  type Attention, type PropertyGroup, type Service,
} from '@/lib/customerProperty';
import { SERVICE_ICON } from '@/types/snow';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dotColor = (a: Attention, grey: string) => (a === 'on_site' ? semantic.info : a === 'scheduled' ? grey : 'transparent');

export function PropertyHome({ data }: { data: CustomerHomeData }) {
  const t = useT();
  const { colors } = useTheme();
  const { groups, past, statuses } = data;
  const [picked, setPicked] = useState<string | null>(null);
  const [tabFor, setTabFor] = useState<Record<string, Service>>({});
  const [showPast, setShowPast] = useState(false);

  const group = groups.find((g) => g.key === picked) ?? groups[0];
  const attention = group ? attentionOf(group, statuses) : 'none';
  const service: Service | undefined = group ? (tabFor[group.key] && group.services.includes(tabFor[group.key]) ? tabFor[group.key] : defaultService(group, attention)) : undefined;

  return (
    <View>
      {groups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsWrap}>
          {groups.map((g) => {
            const on = g.key === group?.key;
            const a = attentionOf(g, statuses);
            return (
              <Pressable
                key={g.key}
                onPress={() => setPicked(g.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={a === 'on_site' ? t('{name}. Crew on site.', { name: g.name }) : a === 'scheduled' ? t('{name}. Crew assigned.', { name: g.name }) : g.name}
                style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.primary + '40' }]}
              >
                {a !== 'none' ? <View style={[styles.chipDot, { backgroundColor: on && a === 'scheduled' ? colors.border : dotColor(a, colors.textTertiary) }]} /> : null}
                <Text style={[typeScale.labelLarge, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{g.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {group && service ? (
        <>
          <View style={{ marginTop: spacing.lg }}>
            {group.address ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, fontWeight: '600' }]}>{group.address}</Text> : null}
            <Text style={[typeScale.displaySmall, { color: colors.textPrimary, fontWeight: '800' }]} accessibilityRole="header">{group.name}</Text>
          </View>
          {group.services.length > 1 ? <ServiceSwitch group={group} current={service} attention={attention} onPick={(s) => setTabFor((m) => ({ ...m, [group.key]: s }))} /> : null}
          <View style={{ marginTop: spacing.lg }}>
            {service === 'snow' ? <SnowPane data={data} group={group} /> : service === 'lawn' ? <LawnPane data={data} group={group} /> : <ProjectPane group={group} />}
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

function ServiceSwitch({ group, current, attention, onPick }: { group: PropertyGroup; current: Service; attention: Attention; onPick: (s: Service) => void }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={[styles.switchTrack, { backgroundColor: colors.primary + '1A' }]} accessibilityRole="tablist">
      {group.services.map((s) => {
        const on = s === current;
        return (
          <Pressable
            key={s}
            onPress={() => onPick(s)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.switchItem, on && [{ backgroundColor: colors.surface }, shadow.sm]]}
          >
            {s === 'snow' && attention !== 'none' ? <View style={[styles.chipDot, { backgroundColor: dotColor(attention, colors.textTertiary) }]} /> : null}
            <Text style={[typeScale.labelLarge, { color: on ? (s === 'snow' ? semantic.info : colors.primary) : colors.textSecondary, fontWeight: on ? '800' : '600' }]}>{t(SERVICE_LABEL[s])}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Snow ─────────────────────────────────────────────────────────────────────

function SnowPane({ data, group }: { data: CustomerHomeData; group: PropertyGroup }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const [viewer, setViewer] = useState<{ items: TaskMediaItem[]; index: number } | null>(null);
  const ids = group.items.filter((i) => i.kind === 'snow').map((i) => i.key.slice('snow:'.length));
  const names = group.items.filter((i) => i.kind === 'snow').map((i) => i.name.trim().toLowerCase());
  const entries = useMemo(
    () => (data.timeline ?? []).filter((e) => ids.includes(e.propertyId) || (e.propertyId === e.propertyName && names.includes(e.propertyName.trim().toLowerCase()))).sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.timeline, group.key],
  );
  const status = data.statuses.find((s) => ids.includes(s.propertyId));
  const sv = status ? statusView(status, group.address, t) : null;
  const latest = entries[0];
  const today = latest && new Date(latest.completedAt).toDateString() === new Date().toDateString();
  const withPhotos = entries.find((e) => e.media.some((m) => m.url));
  const shown = withPhotos ? withPhotos.media.filter((m) => m.url).slice(0, 3) : [];
  const extra = withPhotos ? withPhotos.media.filter((m) => m.url).length - shown.length : 0;
  const stats = visitStats(snowVisits(data.timeline ?? [], group), 'snow', seasonKey(new Date().toISOString(), 'snow'));
  const services = sortServices(ids.flatMap((id) => data.snowServices[id] ?? []) as SnowSvc[]);

  const open = (entry: TimelineEntry, index: number) => {
    const items: TaskMediaItem[] = entry.media.filter((m) => m.url).map((m) => ({ key: m.id, uri: m.url as string, mediaType: m.kind === 'photo' ? 'image' : 'video' }));
    if (items.length) setViewer({ items, index });
  };

  return (
    <View style={{ gap: spacing.lg }}>
      {sv ? (
        <View style={[styles.hero, { backgroundColor: sv.tone === 'active' ? semantic.info : colors.surface, borderColor: sv.tone === 'active' ? semantic.info : colors.borderLight }, shadow.sm]}>
          <Text style={[typeScale.labelSmall, { color: sv.tone === 'active' ? '#FFFFFFD9' : colors.textSecondary, fontWeight: '800' }]}>{t('Right now')}</Text>
          <Text style={[typeScale.headingLarge, { color: sv.tone === 'active' ? '#FFFFFF' : colors.textPrimary, fontWeight: '800' }]}>{sv.headline}</Text>
          {sv.detail ? <Text style={[typeScale.bodyMedium, { color: sv.tone === 'active' ? '#FFFFFFE6' : colors.textSecondary }]}>{sv.detail}</Text> : null}
        </View>
      ) : today ? (
        <View style={[styles.hero, { backgroundColor: semantic.success, borderColor: semantic.success }, shadow.sm]}>
          <Text style={[typeScale.labelSmall, { color: '#FFFFFFD9', fontWeight: '800' }]}>{t('Right now')}</Text>
          <Text style={[typeScale.headingLarge, { color: '#FFFFFF', fontWeight: '800' }]}>{t('All done')}</Text>
          <Text style={[typeScale.bodyMedium, { color: '#FFFFFFE6' }]}>{lastServiceLabel(latest.completedAt, t)}</Text>
        </View>
      ) : (
        <View style={[styles.hero, { backgroundColor: semantic.info + '14', borderColor: semantic.info + '40' }, shadow.sm]}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>{t('No storm right now')}</Text>
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>
            {latest ? t('Last service {when}', { when: lastServiceLabel(latest.completedAt, t) }) : t("We'll be ready when the snow falls.")}
          </Text>
        </View>
      )}

      {withPhotos && shown.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>{today && withPhotos === latest ? t('Photos today') : t('Latest photos')}</Text>
          <View style={styles.tiles}>
            {shown.map((m, i) => (
              <Pressable key={m.id} onPress={() => open(withPhotos, i)} accessibilityRole="button" accessibilityLabel={m.kind === 'video' ? t('Play video') : t('View photo')} style={[styles.tile, { backgroundColor: colors.borderLight }]}>
                {m.kind === 'photo' ? <Image source={{ uri: m.url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <VideoThumb uri={m.url ?? ''} fallback={<Icon name="video" size={22} color={colors.textTertiary} />} />}
                {i === shown.length - 1 && extra > 0 ? <View style={styles.tileMore}><Text style={[typeScale.headingSmall, { color: '#FFFFFF' }]}>+{extra}</Text></View> : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <Stats accent={semantic.info} items={[
        { value: String(stats.visits), label: t('Visits this season') },
        { value: stats.lastAt ? shortDate(stats.lastAt) : '–', label: t('Last visit') },
        { value: String(stats.photos), label: t('Photos') },
      ]} />
      {services.length ? (
        <View style={styles.chipRow}>
          {services.map((s) => (
            <View key={s} style={[styles.svcChip, { backgroundColor: semantic.infoLight }]}>
              <Icon name={SERVICE_ICON[s]} size={13} color={semantic.info} />
              <Text style={[typeScale.labelSmall, { color: semantic.info, fontWeight: '700' }]}>{t(SERVICE_NAME[s])}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <SeeAll accent={semantic.info} label={t('See all visits')} onPress={() => router.push(`/(customer)/history?service=snow&property=${encodeURIComponent(group.key)}` as never)} />
      <TaskMediaViewer items={viewer?.items ?? []} index={viewer ? viewer.index : null} onIndexChange={(i) => setViewer((v) => (v ? { ...v, index: i } : v))} onClose={() => setViewer(null)} />
    </View>
  );
}

// ── Lawn ─────────────────────────────────────────────────────────────────────

function LawnPane({ data, group }: { data: CustomerHomeData; group: PropertyGroup }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const [viewing, setViewing] = useState<{ photos: PagerPhoto[]; startId: string } | null>(null);
  const ids = group.items.filter((i) => i.kind === 'maintenance').map((i) => i.key.slice('maintenance:'.length));
  const names = group.items.filter((i) => i.kind === 'maintenance').map((i) => i.name.trim().toLowerCase());
  const updates = useMemo(
    () => (data.lawn ?? []).filter((u) => (u.propertyId ? ids.includes(u.propertyId) : names.includes(u.propertyName.trim().toLowerCase()))).sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.lawn, group.key],
  );
  const next = data.nextVisits.filter((n) => ids.includes(n.propertyId)).sort((a, b) => a.day.localeCompare(b.day))[0];
  const last = updates[0];
  const stats = visitStats(lawnVisits(data.lawn ?? [], group), 'lawn', seasonKey(new Date().toISOString(), 'lawn'));
  const photos: PagerPhoto[] = last ? last.photos.map((p) => ({ id: p.id, url: p.url, key: p.key })) : [];
  const shown = last ? last.photos.slice(0, 3) : [];
  const extra = last ? last.photos.length - shown.length : 0;

  return (
    <View style={{ gap: spacing.lg }}>
      {next ? (
        <View style={[styles.hero, { backgroundColor: colors.primary, borderColor: colors.primary }, shadow.sm]}>
          <Text style={[typeScale.labelSmall, { color: '#FFFFFFD9', fontWeight: '800' }]}>{t('Next visit')}</Text>
          <Text style={[typeScale.headingLarge, { color: '#FFFFFF', fontWeight: '800' }]}>{nextVisitLabel(next.day, new Date(), t)}</Text>
          {next.services ? <Text style={[typeScale.bodyMedium, { color: '#FFFFFFE6' }]}>{next.services}</Text> : null}
        </View>
      ) : (
        <View style={[styles.hero, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '33' }, shadow.sm]}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>{t('No visit scheduled yet')}</Text>
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{t('Your next visit will show here once it is scheduled.')}</Text>
        </View>
      )}

      {last ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>{t('Last visit')} {'·'} {shortDate(last.completedAt)}</Text>
          {last.services ? <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{last.services}</Text> : null}
          {shown.length ? (
            <View style={styles.tiles}>
              {shown.map((p, i) => (
                <Pressable key={p.id} onPress={() => setViewing({ photos, startId: p.id })} accessibilityRole="button" accessibilityLabel={p.task ? t('Photo: {task}', { task: p.task }) : t('Open photo')} style={[styles.tile, { backgroundColor: colors.borderLight }]}>
                  <PrivatePhoto fileUrl={p.url} fileKey={p.key} style={StyleSheet.absoluteFill as never} accessibilityLabel={t('Photo from your visit')} />
                  {i === shown.length - 1 && extra > 0 ? <View style={styles.tileMore}><Text style={[typeScale.headingSmall, { color: '#FFFFFF' }]}>+{extra}</Text></View> : null}
                  {p.task ? <View style={styles.tileCaption}><Text style={[typeScale.caption, { color: '#FFFFFF', fontWeight: '700' }]} numberOfLines={1}>{p.task}</Text></View> : null}
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>{t('No photos were shared for this visit.')}</Text>
          )}
        </View>
      ) : data.lawn === null ? null : (
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{t("After each visit to your property you'll see it here, with photos when we've shared them.")}</Text>
      )}

      <Stats items={[
        { value: String(stats.visits), label: t('Visits this year') },
        { value: stats.lastAt ? shortDate(stats.lastAt) : '–', label: t('Last visit') },
        { value: String(stats.photos), label: t('Photos') },
      ]} />
      <SeeAll label={t('See all visits')} onPress={() => router.push(`/(customer)/history?service=lawn&property=${encodeURIComponent(group.key)}` as never)} />
      <PhotoPager photos={viewing?.photos ?? []} startId={viewing?.startId ?? null} onClose={() => setViewing(null)} />
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

export function Stats({ items, accent }: { items: { value: string; label: string }[]; accent?: string }) {
  const { colors } = useTheme();
  const tone = accent ?? colors.primary;
  return (
    <View style={styles.statsRow}>
      {items.map((s) => (
        <View key={s.label} style={[styles.stat, { backgroundColor: tone + '14', borderColor: tone + '40' }]}>
          <Text style={[typeScale.headingSmall, { color: tone, fontWeight: '800' }]} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={2}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

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
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  switchTrack: { flexDirection: 'row', padding: 4, borderRadius: radius.lg, marginTop: spacing.md, gap: 4 },
  switchItem: { flex: 1, minHeight: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  hero: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: 2 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden' },
  tileCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileMore: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(15,25,35,0.5)', alignItems: 'center', justifyContent: 'center' },
  tileCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: 'rgba(15,25,35,0.55)' },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  svcChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.full },
  seeAll: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  projectCard: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, gap: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  pastRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: spacing.xs },
  list: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginTop: spacing.xs },
  pastItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, minHeight: 56 },
});
