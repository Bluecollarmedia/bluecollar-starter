import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Linking, Pressable, Share, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useWorkBase } from '@/lib/workRoutes';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { OptimizedImage } from '@/components/ui';
import { WX } from '@/components/weather/WeatherUI';
import { EDGE_ZONE, ScrubBar } from '@/components/work/ScrubBar';
import { ProfileAvatar } from '@/components/work/ProfileAvatar';
import { useClipMusic } from '@/components/work/useClipMusic';
import { getLoadedPortfolio } from '@/data/portfolio';
import { usePublicPortfolio } from '@/hooks/usePortfolio';
import { config } from '@/lib/config';
import { useAppActive } from '@/hooks/useAppActive';
import { formatDuration, postGridUrl, reelIndexOf, reelMode, reelToPreload, requestNoteFor, videoEntries, type ReelMode, type VideoEntry, shareLinkFor, shareTextFor } from '@/lib/portfolio';
import { BRIGHTON_PHONE_LINK } from '@/lib/serviceRequest';

/**
 * Reels, full screen, like Instagram: a video opens tall and uncropped, loops, and you swipe UP for the next reel (and down to go back). Sound is
 * off to start (one speaker button for all of them); tap the picture to pause. The seek bar is thin until a finger touches it, then it grows and the
 * rest dims. Only the reel on screen plays; once it has started, just the NEXT one is prepared in the background (never two at once), and every
 * reel gets a fresh player that starts at 0. If a post has the owner's music and the video's own sound is not kept, the music plays in its place.
 */
export default function WeatherWorkVideo() {
  const t = useT();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{ post?: string; media?: string }>();
  const base = useWorkBase();
  // Opened from a shared link with nothing loaded yet: the feed is fetched first (usePublicPortfolio), then the reel is looked up.
  const { view } = usePublicPortfolio();
  const feed = view.status === 'ready' || view.status === 'loading' ? getLoadedPortfolio() : getLoadedPortfolio();
  const entries = useMemo(() => (feed ? videoEntries(feed.posts) : []), [feed]);
  const startAt = reelIndexOf(entries, params.media);
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  const focused = isFocused && appActive;
  const [active, setActive] = useState(Math.max(0, startAt));
  const [started, setStarted] = useState(false);
  const [sound, setSound] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  // While a reel is held (2x) the list does not scroll, so the finger can wander anywhere and the hold stays.
  const [holding, setHolding] = useState(false);

  const goBack = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace(`${base}/work` as any); }, [router, base]);
  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / height);
    setActive((cur) => { if (cur !== i) setStarted(false); return i; });
  }, [height]);
  const onStarted = useCallback(() => setStarted(true), []);
  const preload = reelToPreload(active, started, entries.length);

  if (startAt < 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{t('This video is not available.')}</Text>
        <Pressable onPress={goBack} accessibilityRole="button" style={styles.emptyBtn}><Text style={styles.emptyBtnText}>{t('Back')}</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <EdgeClose onClose={goBack} />
      <FlatList
        data={entries}
        keyExtractor={(e) => e.media.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        scrollEnabled={!scrubbing && !holding}
        initialScrollIndex={Math.max(0, startAt)}
        getItemLayout={(_d, i) => ({ length: height, offset: height * i, index: i })}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        onMomentumScrollEnd={onScrollEnd}
        renderItem={({ item, index }) => (
          <Reel
            entry={item}
            mode={reelMode(index, active, preload)}
            height={height}
            sound={sound}
            focused={focused}
            scrubbing={scrubbing}
            onSound={() => setSound((s) => !s)}
            onStarted={onStarted}
            onScrubChange={setScrubbing}
            onHoldChange={setHolding}
            onClose={goBack}
            onRequest={(note) => router.push({ pathname: `${base}/request`, params: { services: note.services.join('|'), note: note.note } } as any)}
          />
        )}
      />
    </View>
  );
}

/**
 * The only swipe that closes the reels: a drag to the right that STARTS in the strip along the left edge (EDGE_ZONE wide, about 5% of the
 * screen). The phone's own back gesture is switched off for this screen, so a scrub on the seek bar, or a swipe anywhere else, never closes it.
 * The strip starts below the header so the Close button is never covered.
 */
function EdgeClose({ onClose }: { onClose: () => void }) {
  const g = useMemo(() => Gesture.Pan().activeOffsetX(8).failOffsetY([-20, 20])
    .onEnd((e) => { if (e.translationX > 50 || e.velocityX > 600) runOnJS(onClose)(); }), [onClose]);
  return <GestureDetector gesture={g}><View style={styles.edge} /></GestureDetector>;
}

/** One reel. Idle reels are a still picture; the active one plays; the next one (preload) is buffered and waits, silent, out of sight. */
function Reel({ entry, mode, height, sound, focused, scrubbing, onSound, onStarted, onScrubChange, onHoldChange, onClose, onRequest }: {
  entry: VideoEntry; mode: ReelMode; height: number; sound: boolean; focused: boolean; scrubbing: boolean;
  onSound: () => void; onStarted: () => void; onScrubChange: (s: boolean) => void; onHoldChange: (h: boolean) => void; onClose: () => void; onRequest: (n: { services: string[]; note: string }) => void;
}) {
  // The owner's chosen cover first; otherwise the frame the app took when the video was posted.
  const poster = postGridUrl(entry.post) ?? entry.media.thumb_url;
  if (mode === 'idle') {
    return <View style={{ height, backgroundColor: '#0E1A12' }}>{poster ? <OptimizedImage source={poster} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>;
  }
  return <ReelPlayer entry={entry} live={mode === 'active'} height={height} sound={sound} focused={focused} scrubbing={scrubbing} onSound={onSound} onStarted={onStarted} onScrubChange={onScrubChange} onHoldChange={onHoldChange} onClose={onClose} onRequest={onRequest} />;
}

function ReelPlayer({ entry, live, height, sound, focused, scrubbing, onSound, onStarted, onScrubChange, onHoldChange, onClose, onRequest }: {
  entry: VideoEntry; live: boolean; height: number; sound: boolean; focused: boolean; scrubbing: boolean;
  onSound: () => void; onStarted: () => void; onScrubChange: (s: boolean) => void; onHoldChange: (h: boolean) => void; onClose: () => void; onRequest: (n: { services: string[]; note: string }) => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { post, media: item } = entry;
  const [paused, setPaused] = useState(false);
  // Hold the reel to watch it at 2x; let go and it is back to normal. The hold is a gesture-handler long press with no distance limit, and the
  // list stops scrolling while it is held (onHoldChange), so the finger can move anywhere and the 2x stays until it lifts.
  const [fast, setFast] = useState(false);
  const setHold = useCallback((h: boolean) => { setFast(h); onHoldChange(h); }, [onHoldChange]);
  const hold = useMemo(() => Gesture.LongPress().minDuration(200).maxDistance(100000).enabled(live)
    .onStart(() => { runOnJS(setHold)(true); })
    .onEnd(() => { runOnJS(setHold)(false); })
    .onFinalize(() => { runOnJS(setHold)(false); }), [live, setHold]);
  const [now, setNow] = useState(0);
  const [length, setLength] = useState(item.duration_s ?? 0);
  const musicReplaces = !!post.music_url && !post.keep_video_sound;
  const playing = live && focused && !paused;

  // A fresh player for this reel, starting at 0. Its picture and sound are only used while it is the reel on screen.
  const player = useVideoPlayer(item.url, (p) => { p.loop = true; p.muted = true; p.timeUpdateEventInterval = 0.25; });
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (!live) return;
      if (!scrubbing) setNow(currentTime);
      if (currentTime > 0.1) onStarted();
    });
    return () => { try { sub.remove(); } catch { /* already gone */ } };
  }, [player, live, scrubbing, onStarted]);
  // Every touch of the player is guarded: once the reel is gone the player is released, and touching it then would close the app.
  useEffect(() => { try { if (player.duration > 0) setLength((l) => l || player.duration); } catch { /* released */ } });
  useEffect(() => { try { player.muted = !live || !sound || musicReplaces; } catch { /* released */ } }, [player, live, sound, musicReplaces]);
  useEffect(() => { try { if (playing) player.play(); else player.pause(); } catch { /* released */ } }, [player, playing]);
  useEffect(() => { try { player.playbackRate = fast && playing ? 2 : 1; } catch { /* released */ } }, [player, fast, playing]);
  // A hold always plays: holding a paused reel resumes it at 2x.
  useEffect(() => { if (fast) setPaused(false); }, [fast]);
  useEffect(() => { if (!live) setHold(false); }, [live, setHold]);

  const clip = post.music_url && post.music_start_s != null && post.music_end_s != null ? { startS: post.music_start_s, endS: post.music_end_s } : null;
  // A reel that keeps its own sound plays its music lowered underneath it; otherwise the music replaces the reel's sound.
  useClipMusic(post.music_url ?? null, clip, { active: playing && !!post.music_url, muted: !sound, fade: post.music_fade, duck: !musicReplaces });

  const seek = useCallback((s: number) => { try { player.currentTime = s; } catch { /* released */ } setNow(s); }, [player]);
  const ask = requestNoteFor(post);
  // The share sheet gets the words and the LINK to this reel (iOS shares the link itself; the message carries it too for the rest).
  const share = () => {
    const link = shareLinkFor(config.webUrl, post, item.id);
    void Share.share(link ? { message: `${shareTextFor(post)}\n${link}`, url: link } : { message: `${shareTextFor(post)}  brightonlawn.com` });
  };

  return (
    <View style={{ height, backgroundColor: '#0E1A12' }}>
      <GestureDetector gesture={hold}>
        <Pressable
          style={StyleSheet.absoluteFill}
          disabled={!live}
          onPress={() => setPaused((p) => !p)}
          accessibilityRole="button"
          accessibilityLabel={paused ? t('Play') : t('Pause')}
          accessibilityHint={t('Hold to watch at double speed')}
        >
          <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsVideoFrameAnalysis={false} />
        </Pressable>
      </GestureDetector>
      {!live ? null : (
        <>
          {/* The video plays on top at full brightness, edge to edge. Only a short soft fade sits at the very bottom, behind the words and the seek bar. */}
          <LinearGradient colors={['transparent', 'rgba(8,16,12,0.55)']} style={[styles.shade, { height: Math.min(300, height * 0.3) }]} pointerEvents="none" />
          {paused ? <View style={styles.pauseWrap} pointerEvents="none"><View style={styles.pauseDot}><MaterialCommunityIcons name="play" size={40} color="#FFFFFF" /></View></View> : null}
          {fast ? <View style={styles.fastWrap} pointerEvents="none"><View style={styles.fastPill}><MaterialCommunityIcons name="fast-forward" size={16} color="#FFFFFF" /><Text style={styles.fastText}>2x</Text></View></View> : null}

          <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close')} style={styles.roundBtn}><MaterialCommunityIcons name="close" size={24} color="#FFFFFF" /></Pressable>
            <View style={styles.pill}><Text style={styles.pillText}>{formatDuration(now)} / {formatDuration(length)}</Text></View>
            <View style={{ width: 44 }} />
          </View>

          <View style={[styles.side, { bottom: insets.bottom + 250 }]}>
            <Pressable onPress={onSound} accessibilityRole="button" accessibilityLabel={sound ? t('Sound on, tap to turn off') : t('Sound off, tap to turn on')} style={styles.sideBtn}>
              <MaterialCommunityIcons name={sound ? 'volume-high' : 'volume-off'} size={24} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => { void Linking.openURL(BRIGHTON_PHONE_LINK); }} accessibilityRole="button" accessibilityLabel={t('Call us')} style={styles.sideBtn}><MaterialCommunityIcons name="phone-outline" size={23} color="#FFFFFF" /></Pressable>
            <Pressable onPress={share} accessibilityRole="button" accessibilityLabel={t('Share')} style={styles.sideBtn}><MaterialCommunityIcons name="send-outline" size={23} color="#FFFFFF" /></Pressable>
          </View>

          {scrubbing ? <View style={styles.dim} pointerEvents="none" /> : null}

          <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
            <View style={styles.captionBox} pointerEvents="none">
              <View style={styles.authorRow}>
                <ProfileAvatar uri={getLoadedPortfolio()?.profile.avatar_url} size={34} />
                <Text style={styles.handle}>brightonlawn</Text>
                {post.town ? <Text style={styles.town}>{post.town}</Text> : null}
              </View>
              {post.caption ? <Text style={styles.caption} numberOfLines={3}>{post.caption}</Text> : null}
              {post.tags.length ? <View style={styles.tags}>{post.tags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{t(tag)}</Text></View>)}</View> : null}
            </View>
            <ScrubBar currentS={now} durationS={length || item.duration_s || 0} onSeek={seek} onScrubChange={onScrubChange} />
            <Pressable onPress={() => onRequest(ask)} accessibilityRole="button" style={({ pressed }) => [styles.request, pressed && { opacity: 0.85 }]}>
              <Text style={styles.requestText}>{t('Want something like this? Request a quote')}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', left: 0, top: 120, bottom: 0, width: EDGE_ZONE, zIndex: 5 },
  fastWrap: { position: 'absolute', top: 110, left: 0, right: 0, alignItems: 'center' },
  fastPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: 'rgba(8,16,12,0.6)' },
  fastText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  screen: { flex: 1, backgroundColor: '#0E1A12' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 30, backgroundColor: WX.page },
  emptyTitle: { color: WX.deep, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyBtn: { minHeight: 44, paddingHorizontal: 24, borderRadius: 99, backgroundColor: WX.leafTint, alignItems: 'center', justifyContent: 'center' },
  emptyBtnText: { color: '#17301F', fontSize: 15, fontWeight: '700' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(8,16,12,0.45)', alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: 'rgba(8,16,12,0.45)' },
  pillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  pauseWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  pauseDot: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(8,16,12,0.5)', alignItems: 'center', justifyContent: 'center' },
  side: { position: 'absolute', right: 12, gap: 10 },
  sideBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(8,16,12,0.5)', alignItems: 'center', justifyContent: 'center' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,16,12,0.55)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  captionBox: { paddingHorizontal: 16, paddingRight: 76, marginBottom: 6 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E6F0DE', alignItems: 'center', justifyContent: 'center' },
  handle: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
  town: { color: '#FFFFFF', fontSize: 12.5, opacity: 0.85 },
  caption: { color: '#FFFFFF', fontSize: 14.5, lineHeight: 21, marginTop: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)' },
  tagText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '600' },
  request: { marginHorizontal: 16, marginTop: 6, minHeight: 50, borderRadius: 14, backgroundColor: '#8CCB63', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  requestText: { color: '#0F2A17', fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
