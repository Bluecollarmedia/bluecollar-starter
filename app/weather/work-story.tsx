import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { markStep } from '@/lib/errorReporting';
import { useWorkBase } from '@/lib/workRoutes';
import { OptimizedImage } from '@/components/ui';
import { ProfileAvatar } from '@/components/work/ProfileAvatar';
import { StoryBackdrop, StoryCard } from '@/components/work/StoryCard';
import { markStorySeen, useSeenStories } from '@/data/portfolioStories';
import { getLoadedPortfolio } from '@/data/portfolio';
import { useAppActive } from '@/hooks/useAppActive';
import { highlightFrames, postGridUrl, type PortfolioPost } from '@/lib/portfolio';
import {
  activeStories, agoLabel, nextIndex, normalizeDesign, previousIndex, shareTarget, startIndex, storyDurationMs, tapZone, type PortfolioStory,
} from '@/lib/portfolioStories';

const HOLD_MS = 250;

/**
 * Stories, full screen, like Instagram: a thin progress bar per story at the top; tap the right side for the next one and the left third for the
 * previous one; hold to pause; swipe down to close. A shared card shows the project (or video) in the owner's frame: hold it and it says
 * "Tap to see reel"; tap it and it opens. Photos stay a few seconds, a video plays its own length. What has been watched is remembered on this phone.
 */
export default function WeatherWorkStory() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { start, highlight } = useLocalSearchParams<{ start?: string; highlight?: string }>();
  const base = useWorkBase();
  const feed = getLoadedPortfolio();
  // A highlight plays like a story that never expires: its posts' photos and videos, one after another, in this same viewer.
  const hl = highlight ? feed?.highlights.find((h) => h.id === highlight) : undefined;
  const stories = useMemo(() => (hl && feed ? highlightFrames(hl, feed.posts) : activeStories(feed?.stories, Date.now())), [feed, hl]);
  const seen = useSeenStories();
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  const focused = isFocused && appActive;
  const [index, setIndex] = useState(() => {
    const n = Number(start);
    return Number.isInteger(n) && n >= 0 && n < stories.length ? n : startIndex(stories, seen);
  });
  const [holding, setHolding] = useState(false);
  // While the viewer is being pulled down the story waits (like a hold).
  const [dragging, setDragging] = useState(false);
  const [sound, setSound] = useState(false);
  const story = stories[index];

  const goBack = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace(`${base}/work` as any); }, [router, base]);

  // ── the timer for the story on screen (stops while held, while another screen is on top, or when the app is switched away) ──
  const progress = useRef(new Animated.Value(0)).current;
  const value = useRef(0);
  const run = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => { const id = progress.addListener(({ value: v }) => { value.current = v; }); return () => progress.removeListener(id); }, [progress]);
  const advance = useCallback(() => {
    const n = nextIndex(index, stories.length);
    if (n === null) goBack(); else setIndex(n);
  }, [index, stories.length, goBack]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => { progress.setValue(0); value.current = 0; }, [index, progress]);
  const playing = focused && !holding && !dragging;
  useEffect(() => {
    if (!story) return;
    if (!playing) { run.current?.stop(); return; }
    const remaining = storyDurationMs(story) * (1 - value.current);
    run.current = Animated.timing(progress, { toValue: 1, duration: Math.max(1, remaining), easing: Easing.linear, useNativeDriver: false });
    run.current.start(({ finished }) => { if (finished) advanceRef.current(); });
    return () => run.current?.stop();
  }, [story, playing, progress]);

  // Only real stories are remembered as watched (a highlight is always there to watch again).
  useEffect(() => { if (story && !hl) void markStorySeen(story.id, stories.map((s) => s.id)); }, [story, stories, hl]);

  // ── touch: tap = next/previous, hold = pause, swipe down = close ──
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const press = {
    onPressIn: () => { held.current = false; holdTimer.current = setTimeout(() => { held.current = true; setHolding(true); }, HOLD_MS); },
    onPressOut: () => { if (holdTimer.current) clearTimeout(holdTimer.current); if (held.current) setHolding(false); },
  };
  const onBackgroundPress = (x: number) => {
    if (held.current) return;
    if (tapZone(x, width) === 'previous') setIndex(previousIndex(index)); else advance();
  };
  // ── pull down to close, like Instagram: the whole viewer follows the finger, shrinks a little and shows the screen behind it; let go far
  // enough (or fast enough) and it slides away and closes; otherwise it springs back. A sideways move is never a pull (failOffsetX), so the
  // taps and holds on the story keep working.
  const dragY = useSharedValue(0);
  const dismiss = useMemo(() => Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetY(-12)
    .failOffsetX([-24, 24])
    .onStart(() => { runOnJS(setDragging)(true); })
    .onUpdate((e) => { dragY.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (dragY.value > 140 || e.velocityY > 900) {
        dragY.value = withTiming(height, { duration: 220 }, (done) => { if (done) runOnJS(goBack)(); });
      } else {
        dragY.value = withSpring(0, { damping: 20, stiffness: 240 });
        runOnJS(setDragging)(false);
      }
    }), [dragY, height, goBack]);
  const viewerStyle = useAnimatedStyle(() => {
    const p = Math.min(1, dragY.value / height);
    return { transform: [{ translateY: dragY.value }, { scale: 1 - p * 0.18 }], borderRadius: p * 36 };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, dragY.value / height) * 0.9 }));

  if (!story) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.emptyTitle}>{t('There are no stories right now.')}</Text>
        <Pressable onPress={goBack} accessibilityRole="button" style={styles.emptyBtn}><Text style={styles.emptyBtnText}>{t('Back')}</Text></Pressable>
      </View>
    );
  }

  const post = story.post_id ? feed?.posts.find((p) => p.id === story.post_id) : undefined;
  const target = story.kind === 'share' ? shareTarget(story, post) : null;
  // Opening a post or a reel from here CLOSES the story first, then opens it (never the two on top of each other, each with its own video and
  // timer alive); back from the post returns to Our Work. A breadcrumb is written first, so if the app dies here the next launch can say so.
  const openAfterClosing = (what: string, href: { pathname: string; params: Record<string, string> }) => {
    markStep(what);
    goBack();
    setTimeout(() => router.push(href as any), 150);
  };
  const openTarget = () => {
    if (held.current || !target) return;   // a hold only shows the hint; a short tap opens
    if (target.type === 'video') openAfterClosing('opening a reel from a story', { pathname: `${base}/work-video`, params: { post: target.postId, media: target.mediaId } });
    else openAfterClosing('opening a project from a story', { pathname: `${base}/work-post`, params: { id: target.postId } });
  };

  // Inside a highlight, a small button at the bottom opens the post (or reel) the picture came from.
  const openFrame = () => {
    if (!post) return;
    if (story.kind === 'video' && story.media_id) openAfterClosing('opening a reel from a highlight', { pathname: `${base}/work-video`, params: { post: post.id, media: story.media_id } });
    else openAfterClosing('opening a project from a highlight', { pathname: `${base}/work-post`, params: { id: post.id } });
  };

  return (
    <View style={styles.stage}>
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} pointerEvents="none" />
      <GestureDetector gesture={dismiss}>
      <Reanimated.View style={[styles.screen, viewerStyle]}>
      <StoryLayer key={story.id} story={story} post={post} width={width} height={height} playing={playing} sound={sound} holding={holding} onHold={press} onTap={onBackgroundPress} onOpen={openTarget} />

      {hl && post ? (
        <Pressable onPress={openFrame} accessibilityRole="button" style={({ pressed }) => [styles.seePill, { bottom: insets.bottom + 28 }, pressed && { opacity: 0.85 }]}>
          <Text style={styles.seeText}>{story.kind === 'video' ? t('See reel') : t('See project')}</Text>
        </Pressable>
      ) : null}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.segments} pointerEvents="none">
          {stories.map((s, i) => (
            <View key={s.id} style={styles.segment}>
              {i < index ? <View style={[styles.segmentFill, { width: '100%' }]} /> : null}
              {i === index ? <Animated.View style={[styles.segmentFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} /> : null}
            </View>
          ))}
        </View>
        <View style={styles.who}>
          <ProfileAvatar uri={feed?.profile.avatar_url} size={34} />
          <Text style={styles.handle}>{hl ? hl.name : feed?.profile.handle ?? 'brightonlawn'}</Text>
          {hl ? null : <Text style={styles.ago}>{agoLabel(story.created_at, Date.now())}</Text>}
          <View style={{ flex: 1 }} />
          {story.kind === 'video' ? (
            <Pressable onPress={() => setSound((s) => !s)} accessibilityRole="button" accessibilityLabel={sound ? t('Sound on, tap to turn off') : t('Sound off, tap to turn on')} style={styles.roundBtn}>
              <MaterialCommunityIcons name={sound ? 'volume-high' : 'volume-off'} size={22} color="#FFFFFF" />
            </Pressable>
          ) : null}
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={t('Close')} style={styles.roundBtn}><MaterialCommunityIcons name="close" size={24} color="#FFFFFF" /></Pressable>
        </View>
      </View>
      </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

/** What fills the screen for one story: the photo, the video, or the owner's framed card over its background. */
function StoryLayer({ story, post, width, height, playing, sound, holding, onHold, onTap, onOpen }: {
  story: PortfolioStory; post: PortfolioPost | undefined; width: number; height: number; playing: boolean; sound: boolean; holding: boolean;
  onHold: { onPressIn: () => void; onPressOut: () => void }; onTap: (x: number) => void; onOpen: () => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const background = (
    <Pressable style={StyleSheet.absoluteFill} {...onHold} onPress={(e) => onTap(e.nativeEvent.locationX)} accessibilityRole="button" accessibilityLabel={t('Next story')}>
      {story.kind === 'photo' && story.media_url ? <OptimizedImage source={story.media_url} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {story.kind === 'video' && story.media_url ? <StoryVideo url={story.media_url} playing={playing} sound={sound} /> : null}
    </Pressable>
  );
  if (story.kind !== 'share') return <View style={StyleSheet.absoluteFill}>{background}</View>;

  const design = normalizeDesign(story.design);
  const cover = post ? postGridUrl(post) : null;
  const isVideo = !!post?.media.some((m) => m.kind === 'video') && post.kind === 'video';
  return (
    <View style={StyleSheet.absoluteFill}>
      <StoryBackdrop design={design} coverUrl={cover} />
      {background}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingTop: insets.top + 40 }]} pointerEvents="box-none">
        <Pressable {...onHold} onPress={onOpen} accessibilityRole="button" accessibilityLabel={isVideo ? t('Tap to see reel') : t('Tap to see project')}>
          <StoryCard design={design} coverUrl={cover} isVideo={isVideo} width={width} />
        </Pressable>
        {holding ? (
          <View style={styles.hint} pointerEvents="none"><MaterialCommunityIcons name="gesture-tap" size={18} color="#0F2A17" /><Text style={styles.hintText}>{isVideo ? t('Tap to see reel') : t('Tap to see project')}</Text></View>
        ) : null}
      </View>
    </View>
  );
}

/** A story video: a fresh player for each one, played from the start, paused (not reset) when held or when the screen is covered. */
function StoryVideo({ url, playing, sound }: { url: string; playing: boolean; sound: boolean }) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; p.muted = true; });
  useEffect(() => { try { player.muted = !sound; } catch { /* released */ } }, [player, sound]);
  useEffect(() => { try { if (playing) player.play(); else player.pause(); } catch { /* released */ } }, [player, playing]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsVideoFrameAnalysis={false} />;
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  dim: { backgroundColor: '#000000' },
  screen: { flex: 1, backgroundColor: '#0E1A12', overflow: 'hidden' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 30, backgroundColor: '#F7FAF4' },
  emptyTitle: { color: '#0B4736', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyBtn: { minHeight: 44, paddingHorizontal: 24, borderRadius: 99, backgroundColor: '#E3F1DC', alignItems: 'center', justifyContent: 'center' },
  emptyBtnText: { color: '#17301F', fontSize: 15, fontWeight: '700' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10 },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  segmentFill: { height: '100%', backgroundColor: '#FFFFFF' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E6F0DE', alignItems: 'center', justifyContent: 'center' },
  handle: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  ago: { color: '#FFFFFF', fontSize: 13, opacity: 0.8 },
  roundBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  seePill: { position: 'absolute', alignSelf: 'center', minHeight: 44, paddingHorizontal: 22, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  seeText: { color: '#0F2A17', fontSize: 15, fontWeight: '800' },
  hint: { position: 'absolute', bottom: 130, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 99, backgroundColor: '#FFFFFF' },
  hintText: { color: '#0F2A17', fontSize: 15, fontWeight: '800' },
});
