import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, Share, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ViewToken } from 'react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { OptimizedImage } from '@/components/ui';
import { WX } from '@/components/weather/WeatherUI';
import { ProfileAvatar } from '@/components/work/ProfileAvatar';
import { useClipMusic } from '@/components/work/useClipMusic';
import { useAppActive } from '@/hooks/useAppActive';
import { getLoadedPortfolio, getLoadedPost } from '@/data/portfolio';
import { usePublicPortfolio } from '@/hooks/usePortfolio';
import { config } from '@/lib/config';
import { Image as ExpoImage } from 'expo-image';
import { feedPosts, formatDuration, postGridUrl, requestNoteFor, shouldLoadSlide, sortedMedia, type PortfolioMedia, type PortfolioPost, shareLinkFor, shareTextFor } from '@/lib/portfolio';
import { markStep } from '@/lib/errorReporting';
import { useWorkBase } from '@/lib/workRoutes';
import { BRIGHTON_PHONE_LINK } from '@/lib/serviceRequest';

const INK = '#17301F';

/**
 * Projects, as a feed you scroll down through (like Instagram's home feed): every post one after another, opened on the one that was tapped.
 * A project shows its photos and videos side by side (swipe), with the owner's music playing under it while it is the post on screen. A reel
 * sits in the feed as a square preview (playing quietly, never full screen by itself); tapping it opens the full-screen reels, and coming back
 * lands on the same spot in the feed. Leaving the feed stops the music. The tap on the music chip mutes it. "Want something like this?" opens
 * the Request form already filled in.
 */
export default function WeatherWorkPost() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const base = useWorkBase();
  // Opened from a shared link with nothing loaded yet: the feed is fetched first (usePublicPortfolio), then the post is looked up.
  const { view } = usePublicPortfolio();
  const feed = getLoadedPortfolio();
  const posts = useMemo(() => feedPosts(feed?.posts ?? [], id), [feed, id]);
  const startAt = Math.max(0, posts.findIndex((p) => p.id === id));
  const post = getLoadedPost(id);
  const stillLoading = !post && view.status === 'loading';
  // "On screen" also means the app is in front: switching apps pauses the music and any video, and they carry on when the person returns.
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  const focused = isFocused && appActive;
  // Opening the full-screen reels: the feed CLOSES first (its players go with it) and the reels open a moment later, exactly like a story
  // opening a project. A third screen stacked on the feed (grid -> feed -> reels) kept closing the app even with every player taken down first,
  // while a second screen never does. The reels are told which post they came from (returnTo), so closing them reopens the feed on that post.
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { if (isFocused) setLeaving(false); }, [isFocused]);
  const live = focused && !leaving;
  const openReel = useCallback((p: PortfolioPost, mediaId: string) => {
    markStep('opening a reel from the feed');
    setLeaving(true);
    setTimeout(() => router.push({ pathname: `${base}/work-video`, params: { post: p.id, media: mediaId } } as any), 150);
  }, [router, base]);
  // The post that is mostly on screen is the one that plays (its music, its video); the others sit still.
  const [activeId, setActiveId] = useState<string | undefined>(id);
  // The post after the one on screen gets its music ready in the background (one only), so scrolling on never waits for the song.
  const activeIndex = posts.findIndex((p) => p.id === activeId);
  const nextId = activeIndex >= 0 ? posts[activeIndex + 1]?.id : undefined;
  const viewability = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first) setActiveId((first.item as PortfolioPost).id);
  }).current;

  if (!post) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>{stillLoading ? t('Loading…') : t('This project is not available.')}</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.back}><Text style={styles.backText}>{t('Back')}</Text></Pressable>
      </View>
    );
  }

  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace(`${base}/work` as any); };
  // The tapped post is put at the top of the feed, fully in view, using the cards' REAL heights (no guessed height): once the list has its
  // content, it scrolls to that post; if the post has not been drawn yet, it jumps near it first and then settles exactly on it.
  const listRef = useRef<FlatList<PortfolioPost>>(null);
  const placed = useRef(false);
  const placeStart = () => {
    if (placed.current || startAt <= 0) return;
    placed.current = true;
    try { listRef.current?.scrollToIndex({ index: startAt, animated: false, viewPosition: 0 }); } catch { /* handled by onScrollToIndexFailed */ }
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 6 }}>
      <View style={styles.top}>
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={t('Back')} style={styles.iconBtn}><MaterialCommunityIcons name="chevron-left" size={28} color={INK} /></Pressable>
        <Text style={styles.topTitle}>{t('Projects')}</Text>
        <View style={{ width: 44 }} />
      </View>
      <FlatList
        ref={listRef}
        data={posts}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PostCard post={item} width={width} active={live && item.id === activeId} warm={live && item.id === nextId} focused={live} onOpenReel={openReel} />}
        onContentSizeChange={placeStart}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 }), 120);
        }}
        initialNumToRender={Math.min(posts.length, Math.max(2, startAt + 2))}
        maxToRenderPerBatch={2}
        windowSize={5}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        viewabilityConfig={viewability}
        onViewableItemsChanged={onViewable}
        contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

/**
 * One post in the feed: header, the square (pictures to swipe, or a reel preview), the buttons and the words.
 * While another screen is on top (the full-screen reels), the card shows stills instead of video players (`focused` false): two screens of live
 * players stacked on each other closed the app. The feed itself stays where it was, so coming back lands on the same spot.
 */
function PostCard({ post, width, active, warm, focused, onOpenReel }: { post: PortfolioPost; width: number; active: boolean; warm: boolean; focused: boolean; onOpenReel: (post: PortfolioPost, mediaId: string) => void }) {
  const t = useT();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  // Videos start silent; the speaker button at the bottom right of the square turns their own sound on.
  const [sound, setSound] = useState(false);
  const media = sortedMedia(post);
  const isReel = post.kind === 'video';
  const reel = isReel ? media.find((m) => m.kind === 'video') : undefined;
  const onVideo = media[index]?.kind === 'video';
  const clip = post.music_url && post.music_start_s != null && post.music_end_s != null ? { startS: post.music_start_s, endS: post.music_end_s } : null;
  // While a video with its own sound is on screen the music is lowered (not stopped) and comes back up after; the video's sound is off whenever the music replaces it.
  // A reel's preview in the feed plays quietly: its music waits for the full-screen reels.
  const musicActive = active && !isReel && !!post?.music_url;
  const duck = !!post?.keep_video_sound && onVideo;

  // The picture on screen and its neighbours are drawn (shouldLoadSlide), so a swipe never lands on an empty square. Once the screen has had
  // a moment, the one AFTER the next is fetched quietly into the cache too, so it is ready by the time it becomes a neighbour.
  React.useEffect(() => {
    const ahead = media[index + 2];
    if (!active || !ahead || ahead.kind !== 'photo') return;
    const timer = setTimeout(() => { void ExpoImage.prefetch(ahead.url); }, 500);
    return () => clearTimeout(timer);
  }, [active, index, media]);

  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width)), [width]);
  const ask = requestNoteFor(post);
  const base = useWorkBase();
  const openRequest = () => router.push({ pathname: `${base}/request`, params: { services: ask.services.join('|'), note: ask.note } } as any);
  const openReel = () => { if (reel) onOpenReel(post, reel.id); };
  const videoSound = sound && (!post.music_url || !!post.keep_video_sound);
  // The share sheet gets the words and the LINK to this project (iOS shares the link itself; the message carries it too for the rest).
  const share = () => {
    const link = shareLinkFor(config.webUrl, post);
    void Share.share(link ? { message: `${shareTextFor(post)}\n${link}`, url: link } : { message: `${shareTextFor(post)}  brightonlawn.com` });
  };

  return (
    <View>
      {/* The music is its own small component: it exists only for the post on screen and the one after it (warmed up, silent), and like the
          video players it is UNMOUNTED (player released) while another screen is on top. Other posts' songs are never loaded. */}
      {focused && post.music_url && (active || warm) ? <CardMusic url={post.music_url} clip={clip} active={musicActive} muted={muted} fade={post.music_fade ?? true} duck={duck} /> : null}
      <View style={styles.author}>
        <ProfileAvatar uri={getLoadedPortfolio()?.profile.avatar_url} size={38} />
        <View style={{ flex: 1 }}>
          <Text style={styles.handle}>brightonlawn</Text>
          {post.town ? <Text style={styles.town}>{post.town}</Text> : null}
        </View>
      </View>

      <View style={{ width, height: width, backgroundColor: WX.leafTint }}>
        {isReel && reel ? (
          // A reel in the feed: a square, quiet preview. Tap it to watch it full screen (and swipe up through the other reels).
          <Pressable onPress={openReel} accessibilityRole="button" accessibilityLabel={t('Watch this reel')} style={StyleSheet.absoluteFill}>
            {focused ? <SlideVideo media={reel} size={width} playing={active} sound={sound} /> : <Still url={postGridUrl(post) ?? reel.thumb_url} size={width} />}
            <View style={styles.reelMark} pointerEvents="none">
              <MaterialCommunityIcons name="play-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.reelMarkText}>{t('Reel')}{reel.duration_s ? ` · ${formatDuration(reel.duration_s)}` : ''}</Text>
            </View>
          </Pressable>
        ) : (
          <>
            <FlatList
              data={media}
              keyExtractor={(m) => m.id}
              horizontal
              pagingEnabled
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={3}
              getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
              onMomentumScrollEnd={onScrollEnd}
              renderItem={({ item, index: i }) => <Slide media={item} size={width} load={shouldLoadSlide(i, index)} playing={active && i === index} sound={videoSound} live={focused} />}
            />
            {media.length > 1 ? <View style={styles.counter}><Text style={styles.counterText}>{index + 1}/{media.length}</Text></View> : null}
            {/* Music: just a note icon (the mute button). The track's name is never shown, since it is often a file name. */}
            {post.music_url ? (
              <Pressable onPress={() => setMuted((m) => !m)} accessibilityRole="button" accessibilityLabel={muted ? t('Music is off. Tap to turn it on') : t('Music is playing. Tap to mute')} style={styles.music} hitSlop={8}>
                <MaterialCommunityIcons name={muted ? 'music-off' : 'music-note'} size={20} color="#FFFFFF" />
              </Pressable>
            ) : null}
            {media.length > 1 ? (
              <View style={styles.dots} pointerEvents="none">
                {media.map((m, i) => <View key={m.id} style={[styles.dot, i === index && styles.dotOn]} />)}
              </View>
            ) : null}
          </>
        )}
        {isReel || onVideo ? (
          <Pressable onPress={() => setSound((s) => !s)} accessibilityRole="button" accessibilityLabel={sound ? t('Sound on, tap to turn off') : t('Sound off, tap to turn on')} style={styles.soundBtn} hitSlop={8}>
            <MaterialCommunityIcons name={sound ? 'volume-high' : 'volume-off'} size={20} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={() => { void Linking.openURL(BRIGHTON_PHONE_LINK); }} accessibilityRole="button" accessibilityLabel={t('Call us')} style={styles.iconBtn}><MaterialCommunityIcons name="phone-outline" size={25} color={INK} /></Pressable>
        <Pressable onPress={share} accessibilityRole="button" accessibilityLabel={t('Share')} style={styles.iconBtn}><MaterialCommunityIcons name="send-outline" size={25} color={INK} /></Pressable>
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        {post.caption ? <Text style={styles.caption}><Text style={{ fontWeight: '700' }}>brightonlawn </Text>{post.caption}</Text> : null}
        {post.tags.length ? (
          <View style={styles.tags}>{post.tags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{t(tag)}</Text></View>)}</View>
        ) : null}
        {post.taken_on ? <Text style={styles.date}>{post.taken_on.toUpperCase()}</Text> : null}
        <Pressable onPress={openRequest} accessibilityRole="button" style={({ pressed }) => [styles.request, pressed && { opacity: 0.85 }]}>
          <Text style={styles.requestText}>{t('Want something like this? Request a quote')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The post's music, alive only while the card is mounted with `focused` (see PostCard). */
function CardMusic({ url, clip, active, muted, fade, duck }: { url: string; clip: { startS: number; endS: number } | null; active: boolean; muted: boolean; fade: boolean; duck: boolean }) {
  useClipMusic(url, clip, { active, muted, fade, duck });
  return null;
}

/** One picture or video in the swipe row. A video plays (muted unless it is allowed sound) only while it is the one on screen. */
function Slide({ media, size, load, playing, sound, live }: { media: PortfolioMedia; size: number; load: boolean; playing: boolean; sound: boolean; live: boolean }) {
  // A slide that is not the one on screen stays an empty square: it does not ask for its picture or video.
  if (!load) return <View style={{ width: size, height: size, backgroundColor: WX.leafTint }} />;
  if (media.kind === 'photo') return <OptimizedImage source={media.url} style={{ width: size, height: size }} contentFit="cover" />;
  if (!live) return <Still url={media.thumb_url} size={size} />;
  return <SlideVideo media={media} size={size} playing={playing} sound={sound} />;
}

/** A video's still picture, shown in place of its player while another screen is on top. */
function Still({ url, size }: { url: string | null | undefined; size: number }) {
  return url ? <OptimizedImage source={url} style={{ width: size, height: size }} contentFit="cover" /> : <View style={{ width: size, height: size, backgroundColor: '#0E1A12' }} />;
}

function SlideVideo({ media, size, playing, sound }: { media: PortfolioMedia; size: number; playing: boolean; sound: boolean }) {
  const player = useVideoPlayer(media.url, (p) => { p.loop = true; p.muted = true; });
  // Every touch of the player is guarded: once the slide is gone the player is released, and touching it then would close the app.
  React.useEffect(() => { try { player.muted = !sound; } catch { /* released */ } }, [player, sound]);
  React.useEffect(() => { try { if (playing) player.play(); else player.pause(); } catch { /* released */ } }, [player, playing]);
  return <VideoView player={player} style={{ width: size, height: size }} contentFit="cover" nativeControls={false} allowsVideoFrameAnalysis={false} />;
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, gap: 14 },
  title: { color: WX.deep, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  back: { minHeight: 44, paddingHorizontal: 24, borderRadius: 99, backgroundColor: WX.leafTint, alignItems: 'center', justifyContent: 'center' },
  backText: { color: INK, fontSize: 15, fontWeight: '700' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  topTitle: { color: INK, fontSize: 17, fontWeight: '700' },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  separator: { height: 18 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  handle: { color: INK, fontSize: 14.5, fontWeight: '700' },
  town: { color: WX.soft, fontSize: 12.5 },
  counter: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: 'rgba(23,48,31,0.72)' },
  counterText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '600' },
  reelMark: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: 'rgba(23,48,31,0.72)' },
  reelMarkText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  soundBtn: { position: 'absolute', right: 12, bottom: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(23,48,31,0.72)', alignItems: 'center', justifyContent: 'center' },
  music: { position: 'absolute', top: 12, left: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(23,48,31,0.72)', alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', left: 0, right: 0, bottom: 14, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { backgroundColor: '#FFFFFF' },
  actions: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 4 },
  caption: { color: INK, fontSize: 14.5, lineHeight: 21 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99, backgroundColor: WX.leafTint },
  tagText: { color: '#2E5E34', fontSize: 12.5, fontWeight: '600' },
  date: { color: WX.soft, fontSize: 12, letterSpacing: 0.4, marginTop: 8 },
  request: { marginTop: 16, minHeight: 50, borderRadius: 14, backgroundColor: '#2E5E34', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  requestText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
