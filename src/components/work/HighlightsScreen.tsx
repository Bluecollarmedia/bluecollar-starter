/**
 * Owner and admin: the Highlights, the circles at the top of Our Work. A highlight groups posts: AUTOMATIC ones follow a tag (new posts with that
 * tag join on their own), or you pick the posts by hand. Name it (short, so it fits under the circle), choose its picture, put the circles in order.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, GlassIconButton, Icon, InlineNotice, Input, LoadingSpinner, OptimizedImage } from '@/components/ui';
import { confirmAction } from '@/components/financials/ActionSheet';
import { deleteHighlight, loadOwnerPortfolio, saveHighlight, saveHighlightOrder, type OwnerPortfolio } from '@/data/portfolioOwner';
import { uploadPortfolioPhoto } from '@/data/portfolioUpload';
import { db } from '@/data/store';
import { keepPicked } from '@/lib/keepPickedFile';
import { HIGHLIGHT_NAME_MAX, TAG_CHOICES, highlightCoverUrl, highlightProblem, moveItem, postGridUrl, postsForHighlight, type PortfolioHighlight } from '@/lib/portfolio';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

interface Draft { id: string | null; name: string; mode: 'tag' | 'manual'; tag: string | null; coverUrl: string | null; postIds: string[] }
const BLANK: Draft = { id: null, name: '', mode: 'tag', tag: null, coverUrl: null, postIds: [] };

export function HighlightsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<OwnerPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const reload = useCallback(async () => {
    const r = await loadOwnerPortfolio();
    setLoading(false);
    if (r.ok) { setData(r.data); setProblem(null); } else setProblem(r.error);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const highlights = [...(data?.highlights ?? [])].sort((a, b) => a.position - b.position);
  const posts = data?.posts ?? [];
  const edit = (h: PortfolioHighlight) => setDraft({ id: h.id, name: h.name, mode: h.mode, tag: h.tag, coverUrl: h.cover_url, postIds: h.post_ids });

  async function pickCover() {
    setProblem(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setProblem('Turn on photo access for Brighton Lawn in the Settings app.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0] || !db.companyId) return;
    setBusy(true);
    try {
      const kept = await keepPicked(result.assets[0].uri, 'image');
      const up = await uploadPortfolioPhoto(kept, db.companyId, 'covers');
      setDraft((d) => (d ? { ...d, coverUrl: up.thumbUrl } : d));
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : "Couldn't upload that picture.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const bad = highlightProblem({ name: draft.name, mode: draft.mode, tag: draft.tag, postIds: draft.postIds });
    if (bad) { setProblem(bad); return; }
    setBusy(true);
    const r = await saveHighlight(draft.id, { name: draft.name, mode: draft.mode, tag: draft.tag, coverUrl: draft.coverUrl, postIds: draft.postIds }, highlights.length);
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setProblem(null);
    setDraft(null);
    await reload();
  }

  function remove() {
    if (!draft?.id) return;
    const id = draft.id;
    confirmAction('Delete this highlight?', 'The circle goes away. The posts in it are not deleted.', 'Delete', async () => {
      const r = await deleteHighlight(id);
      if (!r.ok) { setProblem(r.error); return; }
      setDraft(null);
      await reload();
    }, true);
  }

  async function reorder(from: number, to: number) {
    const ids = moveItem(highlights.map((h) => h.id), from, to);
    if (ids.join() === highlights.map((h) => h.id).join()) return;
    setData((d) => (d ? { ...d, highlights: ids.map((id, i) => ({ ...(d.highlights.find((h) => h.id === id) as PortfolioHighlight), position: i })) } : d));
    const r = await saveHighlightOrder(ids);
    if (!r.ok) { setProblem(r.error); await reload(); }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['4xl'] }} keyboardShouldPersistTaps="handled">
        <GlassIconButton icon="chevron-left" onPress={() => (draft ? setDraft(null) : router.back())} accessibilityLabel="Back" />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>Highlights</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg }]}>
          The circles at the top of Our Work. Each one groups posts, like Patios or Turf.
        </Text>
        {problem ? <InlineNotice icon="alert-circle" tone="error" text={problem} style={{ marginBottom: spacing.md }} /> : null}

        {loading ? <LoadingSpinner /> : draft ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, gap: spacing.md }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={[styles.bigCircle, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
                {draft.coverUrl ? <OptimizedImage source={draft.coverUrl} style={styles.bigCircleImg} /> : <Icon name="image" size={26} color={colors.textTertiary} />}
              </View>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Button title="Choose the circle picture" size="sm" variant="secondary" onPress={pickCover} loading={busy} />
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{draft.coverUrl ? 'Your picture is used.' : 'Without one, the first post\'s cover is used.'}</Text>
              </View>
            </View>

            <Input label="Name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} maxLength={HIGHLIGHT_NAME_MAX} hint="Short names fit best under the circle." />

            <View>
              <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm }]}>Which posts go in it?</Text>
              <View style={[styles.segments, { backgroundColor: colors.backgroundTertiary }]}>
                {([['tag', 'Automatic, by tag'], ['manual', 'I pick the posts']] as const).map(([key, label]) => {
                  const on = draft.mode === key;
                  return (
                    <Pressable key={key} onPress={() => setDraft({ ...draft, mode: key })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.segment, on && { backgroundColor: colors.surface }]}>
                      <Text style={[typeScale.labelLarge, { color: on ? colors.textPrimary : colors.textSecondary, fontWeight: on ? '700' : '600' }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {draft.mode === 'tag' ? (
              <View>
                <View style={styles.tags}>
                  {TAG_CHOICES.map((t) => {
                    const on = draft.tag === t;
                    return (
                      <Pressable key={t} onPress={() => setDraft({ ...draft, tag: t })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.tag, { backgroundColor: on ? '#2E5E34' : colors.surface, borderColor: on ? '#2E5E34' : colors.border }]}>
                        <Text style={[typeScale.labelLarge, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '600' }]}>{t}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                  {draft.tag ? `${postsForHighlight({ id: '', name: '', cover_url: null, mode: 'tag', tag: draft.tag, position: 0, post_ids: [] }, posts).length} post(s) have this tag now. New posts with it join on their own.` : 'Pick a tag.'}
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {posts.length === 0 ? <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>Add some posts first.</Text> : posts.map((p) => {
                  const on = draft.postIds.includes(p.id);
                  const uri = postGridUrl(p);
                  return (
                    <Pressable key={p.id} onPress={() => setDraft({ ...draft, postIds: on ? draft.postIds.filter((x) => x !== p.id) : [...draft.postIds, p.id] })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.pickRow, { borderColor: on ? '#2E5E34' : colors.border, backgroundColor: colors.surface }]}>
                      <View style={[styles.pickThumb, { backgroundColor: colors.backgroundTertiary }]}>{uri ? <OptimizedImage source={uri} style={styles.pickThumb} /> : null}</View>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>{p.caption || p.town || (p.kind === 'video' ? 'Reel' : 'Project')}</Text>
                      <Icon name={on ? 'check-circle' : 'circle'} size={22} color={on ? '#2E5E34' : colors.textTertiary} />
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {draft.id ? <Button title="Delete" variant="danger" onPress={remove} style={{ flex: 1 }} /> : <Button title="Cancel" variant="secondary" onPress={() => setDraft(null)} style={{ flex: 1 }} />}
              <Button title="Save" onPress={save} loading={busy} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <>
            <Button title="+ New highlight" onPress={() => setDraft({ ...BLANK })} />
            {highlights.length === 0 ? (
              <View style={{ marginTop: spacing.lg }}><EmptyState icon="disc" title="No highlights yet" description="Make a circle like Patios or Turf. Visitors tap it to see those posts." /></View>
            ) : (
              <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
                {highlights.map((h, i) => {
                  const uri = highlightCoverUrl(h, posts);
                  const count = postsForHighlight(h, posts).length;
                  return (
                    <View key={h.id} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <View style={[styles.circle, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>{uri ? <OptimizedImage source={uri} style={styles.circleImg} /> : null}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{h.name}</Text>
                        <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{count} post{count === 1 ? '' : 's'} · {h.mode === 'tag' ? `automatic, ${h.tag ?? 'no tag'}` : 'you picked them'}{count === 0 ? ' · hidden until it has a post' : ''}</Text>
                      </View>
                      <View style={{ flexDirection: 'row' }}>
                        <Pressable onPress={() => reorder(i, i - 1)} disabled={i === 0} accessibilityRole="button" accessibilityLabel="Move earlier" style={[styles.move, i === 0 && { opacity: 0.25 }]}><Icon name="chevron-up" size={18} color={colors.textPrimary} /></Pressable>
                        <Pressable onPress={() => reorder(i, i + 1)} disabled={i === highlights.length - 1} accessibilityRole="button" accessibilityLabel="Move later" style={[styles.move, i === highlights.length - 1 && { opacity: 0.25 }]}><Icon name="chevron-down" size={18} color={colors.textPrimary} /></Pressable>
                        <Pressable onPress={() => edit(h)} accessibilityRole="button" accessibilityLabel={`Edit ${h.name}`} style={styles.move}><Text style={[typeScale.labelLarge, { color: colors.primary, fontWeight: '700' }]}>Edit</Text></Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { padding: spacing.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  circle: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, overflow: 'hidden' },
  circleImg: { width: '100%', height: '100%' },
  bigCircle: { width: 76, height: 76, borderRadius: 38, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  bigCircleImg: { width: '100%', height: '100%' },
  move: { minWidth: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', padding: 4, borderRadius: radius.lg, gap: 4 },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { minHeight: 40, paddingHorizontal: 14, borderRadius: 99, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.lg, borderWidth: 1.5 },
  pickThumb: { width: 44, height: 44, borderRadius: radius.sm, overflow: 'hidden' },
});
