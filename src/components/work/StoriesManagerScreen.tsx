/**
 * Owner and admin: the Our Work story. Add a photo or a video (each stays up 24 hours), or share a project or video as a card with a frame you
 * design (colours, border, roundness, size, a line of text). Visitors tap the card to open the project or reel; hold it and it says "Tap to see reel".
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, GlassIconButton, Icon, InlineNotice, Input, LoadingSpinner, OptimizedImage, ProgressBar } from '@/components/ui';
import { percentOf } from '@/lib/uploadProgress';
import { VIDEO_PICK_OPTIONS } from '@/lib/videoPick';
import { StoryBackdrop, StoryCard } from '@/components/work/StoryCard';
import { addMediaStory, addShareStory, deleteStory, loadMyStories, loadPostsToShare } from '@/data/portfolioStoriesOwner';
import { useTheme } from '@/providers/ThemeProvider';
import { keepPicked } from '@/lib/keepPickedFile';
import { imageProblem, videoProblem } from '@/lib/mediaFormats';
import { postGridUrl, type PortfolioPost } from '@/lib/portfolio';
import {
  DEFAULT_DESIGN, FRAME_WIDTH_MAX, MAX_STORY_VIDEO_S, RADIUS_MAX, SCALE_MAX, SCALE_MIN, STORY_COLORS, TEXT_MAX, normalizeDesign, stepValue, timeLeftLabel,
  type PortfolioStory, type StoryDesign,
} from '@/lib/portfolioStories';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

type Mode = 'list' | 'pick' | 'design';

export function StoriesManagerScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState<Mode>('list');
  const [stories, setStories] = useState<PortfolioStory[]>([]);
  const [posts, setPosts] = useState<PortfolioPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** The bar while a photo or video is being sent (0 to 1); null when nothing is being sent. */
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PortfolioPost | null>(null);
  const [design, setDesign] = useState<StoryDesign>(DEFAULT_DESIGN);
  const patch = (p: Partial<StoryDesign>) => setDesign((d) => normalizeDesign({ ...d, ...p }));

  const reload = useCallback(async () => {
    const r = await loadMyStories();
    setLoading(false);
    if (r.ok) setStories(r.data); else setProblem(r.error);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function addFromLibrary() {
    setProblem(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setProblem('Turn on photo access for Brighton Lawn in the Settings app.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1, ...VIDEO_PICK_OPTIONS });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    const isVideo = a.type === 'video';
    const wrongFormat = isVideo ? videoProblem(a.fileName ?? a.uri, a.mimeType) : imageProblem(a.fileName ?? a.uri, a.mimeType);
    if (wrongFormat) { setProblem(wrongFormat); return; }
    const seconds = isVideo ? (a.duration ?? 0) / 1000 : null;
    if (isVideo && seconds !== null && seconds > MAX_STORY_VIDEO_S) { setProblem(`A story video can be up to ${MAX_STORY_VIDEO_S} seconds. Trim it first.`); return; }
    setBusy(true);
    // The picked file is copied somewhere safe at once (the phone may remove its temporary copy before the upload ends).
    const kept = await keepPicked(a.uri, isVideo ? 'video' : 'image');
    setProgress(0);
    const r = await addMediaStory({ kind: isVideo ? 'video' : 'photo', localUri: kept, mimeType: a.mimeType, durationS: seconds, width: a.width, height: a.height }, setProgress);
    setProgress(null);
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    await reload();
  }

  async function startShare() {
    setProblem(null);
    setBusy(true);
    const r = await loadPostsToShare();
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setPosts(r.data);
    setMode('pick');
  }

  async function shareNow() {
    if (!chosen) return;
    setBusy(true);
    const video = chosen.kind === 'video' ? chosen.media.find((m) => m.kind === 'video') : undefined;
    const r = await addShareStory({ postId: chosen.id, mediaId: video?.id ?? null, design });
    setBusy(false);
    if (!r.ok) { setProblem(r.error); return; }
    setMode('list'); setChosen(null); setDesign(DEFAULT_DESIGN);
    await reload();
  }

  function confirmDelete(s: PortfolioStory) {
    Alert.alert('Take this down?', 'It disappears from the story right away.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take down', style: 'destructive', onPress: async () => { const r = await deleteStory(s.id); if (!r.ok) setProblem(r.error); else await reload(); } },
    ]);
  }

  const pad = { paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] };
  const back = () => { if (mode === 'design') setMode('pick'); else if (mode === 'pick') setMode('list'); else router.back(); };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={pad} keyboardShouldPersistTaps="handled">
        <GlassIconButton icon="chevron-left" onPress={back} accessibilityLabel="Back" />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>Our Work story</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg }]}>
          Photos, videos and shared cards. Each one stays up for 24 hours.
        </Text>
        {problem ? <InlineNotice icon="alert-circle" tone="error" text={problem} style={{ marginBottom: spacing.md }} /> : null}
        {progress !== null ? (
          <View style={[styles.progressCard, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityLiveRegion="polite" accessibilityLabel={`Uploading ${percentOf(progress)}%`}>
            <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Uploading…</Text>
            <ProgressBar progress={percentOf(progress)} showLabel />
          </View>
        ) : null}

        {mode === 'list' ? (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Add photo or video" onPress={addFromLibrary} loading={busy} style={{ flex: 1 }} />
              <Button title="Share a project" variant="secondary" onPress={startShare} loading={busy} style={{ flex: 1 }} />
            </View>
            <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>UP NOW</Text>
            {loading ? <LoadingSpinner /> : stories.length === 0 ? (
              <EmptyState icon="circle" title="Nothing in your story" description="Add a photo or video, or share a project. A ring shows around your profile picture while the story is up." />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {stories.map((s) => (
                  <View key={s.id} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={[styles.thumb, { backgroundColor: colors.backgroundTertiary }]}>
                      {s.kind === 'photo' && s.media_url ? <OptimizedImage source={s.media_url} style={styles.thumb} /> : <Icon name={s.kind === 'video' ? 'video' : 'layout'} size={22} color={colors.textSecondary} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{s.kind === 'photo' ? 'Photo' : s.kind === 'video' ? 'Video' : 'Shared project'}</Text>
                      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{timeLeftLabel(s.expires_at, Date.now()) || 'Ending'}</Text>
                    </View>
                    <Button title="Take down" size="sm" variant="secondary" onPress={() => confirmDelete(s)} />
                  </View>
                ))}
              </View>
            )}
          </>
        ) : null}

        {mode === 'pick' ? (
          <>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.sm }]}>Which project or video?</Text>
            {posts.length === 0 ? <EmptyState icon="image" title="No posts yet" description="Add a post to Our Work first, then you can share it to your story." /> : (
              <View style={{ gap: spacing.sm }}>
                {posts.map((p) => {
                  const uri = postGridUrl(p);
                  return (
                    <Pressable key={p.id} onPress={() => { setChosen(p); setMode('design'); }} accessibilityRole="button" style={({ pressed }) => [styles.row, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.85 }]}>
                      <View style={[styles.thumb, { backgroundColor: colors.backgroundTertiary }]}>{uri ? <OptimizedImage source={uri} style={styles.thumb} /> : null}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{p.caption || p.town || (p.kind === 'video' ? 'Video' : 'Project')}</Text>
                        <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{p.kind === 'video' ? 'Video' : 'Project'}{p.town ? ` · ${p.town}` : ''}</Text>
                      </View>
                      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        {mode === 'design' && chosen ? (
          <>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.sm }]}>Design the card</Text>
            <Preview design={design} post={chosen} screenW={width} />

            <Label>Background</Label>
            <Segments value={design.background} onChange={(v) => patch({ background: v as StoryDesign['background'] })} options={[['solid', 'Color'], ['gradient', 'Gradient'], ['blur', 'Blurred picture']]} />
            {design.background !== 'blur' ? <><Label>{design.background === 'gradient' ? 'First color' : 'Color'}</Label><Swatches value={design.color} onChange={(v) => patch({ color: v })} /></> : null}
            {design.background === 'gradient' ? <><Label>Second color</Label><Swatches value={design.color2} onChange={(v) => patch({ color2: v })} /></> : null}

            <Label>Frame color</Label>
            <Swatches value={design.frameColor} onChange={(v) => patch({ frameColor: v })} />
            <Stepper label="Border thickness" value={design.frameWidth} onMinus={() => patch({ frameWidth: stepValue(design.frameWidth, -2, 0, FRAME_WIDTH_MAX) })} onPlus={() => patch({ frameWidth: stepValue(design.frameWidth, 2, 0, FRAME_WIDTH_MAX) })} />
            <Stepper label="Roundness" value={design.radius} onMinus={() => patch({ radius: stepValue(design.radius, -4, 0, RADIUS_MAX) })} onPlus={() => patch({ radius: stepValue(design.radius, 4, 0, RADIUS_MAX) })} />
            <Stepper label="Card size" value={Math.round(design.scale * 100)} suffix="%" onMinus={() => patch({ scale: stepValue(design.scale, -0.05, SCALE_MIN, SCALE_MAX) })} onPlus={() => patch({ scale: stepValue(design.scale, 0.05, SCALE_MIN, SCALE_MAX) })} />

            <Label>Text on the card</Label>
            <Input label="A short line (optional)" value={design.text} onChangeText={(v) => patch({ text: v })} maxLength={TEXT_MAX} />
            <Segments value={design.textPlace} onChange={(v) => patch({ textPlace: v as StoryDesign['textPlace'] })} options={[['top', 'Above the card'], ['bottom', 'Below the card']]} />
            <Label>Text color</Label>
            <Swatches value={design.textColor} onChange={(v) => patch({ textColor: v })} />

            <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.md }]}>Visitors tap the card to open it. If they hold it, it says "Tap to see reel".</Text>
            <Button title="Share to story" onPress={shareNow} loading={busy} style={{ marginTop: spacing.lg }} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** A half-size picture of the whole story screen, drawn exactly like the viewer draws it. */
function Preview({ design, post, screenW }: { design: StoryDesign; post: PortfolioPost; screenW: number }) {
  const w = screenW;
  const h = Math.round(screenW * (16 / 9));
  const k = 0.5;
  const isVideo = post.kind === 'video';
  const cover = postGridUrl(post);
  return (
    <View style={{ alignSelf: 'center', width: w * k, height: h * k, borderRadius: 16, overflow: 'hidden', backgroundColor: '#0E1A12' }}>
      <View style={{ width: w, height: h, position: 'absolute', left: -w * (1 - k) / 2, top: -h * (1 - k) / 2, transform: [{ scale: k }] }}>
        <StoryBackdrop design={design} coverUrl={cover} />
        <View style={{ ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
          <StoryCard design={design} coverUrl={cover} isVideo={isVideo} width={w} />
        </View>
      </View>
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.sm }]}>{children}</Text>;
}

function Segments({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segments, { backgroundColor: colors.backgroundTertiary }]}>
      {options.map(([key, label]) => {
        const on = value === key;
        return (
          <Pressable key={key} onPress={() => onChange(key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.segment, on && { backgroundColor: colors.surface }]}>
            <Text style={[typeScale.labelLarge, { color: on ? colors.textPrimary : colors.textSecondary, fontWeight: on ? '700' : '600' }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.swatches}>
      {STORY_COLORS.map((c) => (
        <Pressable key={c} onPress={() => onChange(c)} accessibilityRole="button" accessibilityLabel={`Color ${c}`} accessibilityState={{ selected: value.toLowerCase() === c.toLowerCase() }} style={[styles.swatch, { backgroundColor: c }, value.toLowerCase() === c.toLowerCase() && styles.swatchOn]} />
      ))}
    </View>
  );
}

function Stepper({ label, value, suffix = '', onMinus, onPlus }: { label: string; value: number; suffix?: string; onMinus: () => void; onPlus: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stepper}>
      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{label}</Text>
      <Pressable onPress={onMinus} accessibilityRole="button" accessibilityLabel={`${label} less`} style={[styles.stepBtn, { backgroundColor: colors.backgroundTertiary }]}><Icon name="minus" size={18} color={colors.textPrimary} /></Pressable>
      <Text style={[typeScale.headingSmall, { color: colors.textPrimary, minWidth: 54, textAlign: 'center' }]}>{value}{suffix}</Text>
      <Pressable onPress={onPlus} accessibilityRole="button" accessibilityLabel={`${label} more`} style={[styles.stepBtn, { backgroundColor: colors.backgroundTertiary }]}><Icon name="plus" size={18} color={colors.textPrimary} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  progressCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md },
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  segments: { flexDirection: 'row', padding: 4, borderRadius: radius.lg, gap: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  swatchOn: { borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  stepBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
