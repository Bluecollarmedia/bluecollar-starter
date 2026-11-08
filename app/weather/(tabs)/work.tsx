import React, { useCallback, useRef, useState } from 'react';
import { useScrollToTop } from '@/lib/scrollTop';
import { useWorkBase } from '@/lib/workRoutes';
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { OptimizedImage } from '@/components/ui';
import { Panel, WX } from '@/components/weather/WeatherUI';
import { LinearGradient } from 'expo-linear-gradient';
import { ProfileAvatar } from '@/components/work/ProfileAvatar';
import { useSeenStories } from '@/data/portfolioStories';
import { usePublicPortfolio } from '@/hooks/usePortfolio';
import { activeStories, ringState, startIndex } from '@/lib/portfolioStories';
import {
  formatDuration, GRID_PAGE, gridPosts, growCount, highlightCoverUrl, portfolioCounts, postGridUrl, videoEntries, visibleHighlights,
  type PortfolioPost, type PublicPortfolio,
} from '@/lib/portfolio';
import { BRIGHTON_PHONE_LINK } from '@/lib/serviceRequest';
import { websiteHref } from '@/lib/portfolio';

const INK = '#17301F';
const GAP = 2;

/**
 * Our Work: the owner's portfolio, laid out like a photo feed. A profile with three counts, the circles at the top (highlights), and two pages
 * side by side: the photo grid and, one swipe to the left, the videos. Tap a photo to open the project; tap a video to watch it full screen.
 * It only exists while the owner's Our Work switch is on.
 */
export default function WeatherWork() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { view, refresh } = usePublicPortfolio();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  // Only the first page of tiles is drawn; more are drawn as the person scrolls near the end (a long feed never loads all at once).
  const [gridCount, setGridCount] = useState(GRID_PAGE);
  const [videoCount, setVideoCount] = useState(GRID_PAGE);
  const base = useWorkBase();
  const pager = useRef<ScrollView>(null);
  const pageRef = useRef<ScrollView>(null);
  useScrollToTop('/weather/work', useCallback(() => { pageRef.current?.scrollTo({ y: 0, animated: true }); }, []));
  const seen = useSeenStories();

  const onRefresh = useCallback(async () => { setRefreshing(true); await refresh(); setRefreshing(false); }, [refresh]);
  const goPage = (i: number) => { setPage(i); pager.current?.scrollTo({ x: i * width, animated: true }); };
  const onPagerEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  const top = insets.top + 10;
  const pad = { paddingTop: top, paddingBottom: insets.bottom + 130 };

  if (view.status === 'loading') {
    return <View style={[styles.center, pad]}><Text style={styles.soft}>{t('Loading…')}</Text></View>;
  }
  if (view.status !== 'ready') {
    return (
      <View style={[styles.center, pad]}>
        <Text style={styles.title}>{view.status === 'off' ? t('Our Work is not available right now') : t("Couldn't load Our Work")}</Text>
        <Text style={[styles.soft, { textAlign: 'center', marginTop: 6 }]}>{t('Check back soon, or call us.')}</Text>
        <Pressable onPress={onRefresh} accessibilityRole="button" style={[styles.secondary, { marginTop: 18, alignSelf: 'center', paddingHorizontal: 26 }]}><Text style={styles.secondaryText}>{t('Try again')}</Text></Pressable>
      </View>
    );
  }

  const data: PublicPortfolio = view.data;
  const counts = portfolioCounts(data.posts);
  const grid = gridPosts(data.posts);
  const videos = videoEntries(data.posts);
  const circles = visibleHighlights(data.highlights, data.posts);
  const tile = (width - GAP * 2) / 3;
  // The ring around the profile picture: coloured while a story is unwatched, grey when all are watched, none without stories.
  const stories = activeStories(data.stories, Date.now());
  const ring = ringState(stories, seen);
  const openStories = () => router.push({ pathname: `${base}/work-story`, params: { start: String(startIndex(stories, seen)) } } as any);
  const openVideo = (p: PortfolioPost, mediaId: string) => router.push({ pathname: `${base}/work-video`, params: { post: p.id, media: mediaId } } as any);
  // Every tile in the grid opens the feed on that post (a reel sits in the feed as a square preview; tapping it there goes full screen).
  // The Videos tab opens the full-screen reels straight away.
  const openPost = (p: PortfolioPost) => router.push({ pathname: `${base}/work-post`, params: { id: p.id } } as any);

  return (
    <ScrollView
      ref={pageRef}
      scrollEventThrottle={100}
      onScroll={(e) => {
        const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
        if (contentOffset.y + layoutMeasurement.height > contentSize.height - 700) {
          setGridCount((c) => growCount(c, grid.length));
          setVideoCount((c) => growCount(c, videos.length));
        }
      }}
      contentContainerStyle={{ paddingTop: top, paddingBottom: insets.bottom + 130 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={INK} />}>
      <Text style={styles.handle}>{data.profile.handle}</Text>

      <View style={styles.profileRow}>
        <Pressable onPress={openStories} disabled={ring === 'none'} accessibilityRole={ring === 'none' ? 'image' : 'button'} accessibilityLabel={ring === 'none' ? 'Brighton' : t('Watch our story')}>
          {ring === 'unseen' ? (
            <LinearGradient colors={['#8CCB63', '#2E5E34', '#F2B632']} style={styles.ring}>
              <View style={styles.ringInner}><ProfileAvatar uri={data.profile.avatar_url} size={80} /></View>
            </LinearGradient>
          ) : (
            <View style={[styles.ring, { backgroundColor: ring === 'seen' ? '#C5D2C0' : 'transparent' }]}>
              <View style={styles.ringInner}><ProfileAvatar uri={data.profile.avatar_url} size={80} /></View>
            </View>
          )}
        </Pressable>
        <View style={styles.counts}>
          <Count n={counts.projects} label={t('Projects')} />
          <Count n={counts.photos} label={t('Photos')} />
          <Count n={counts.services} label={t('Services')} />
        </View>
      </View>

      <View style={styles.bioBox}>
        <Text style={styles.name}>Brighton Lawn &amp; Landscape</Text>
        {data.profile.bio ? <Text style={styles.bio}>{data.profile.bio}</Text> : null}
        {data.profile.website ? (
          <Pressable onPress={() => { void Linking.openURL(websiteHref(data.profile.website)); }} accessibilityRole="link" accessibilityLabel={t('Open {site}', { site: data.profile.website })} hitSlop={8}>
            <Text style={styles.link}>{data.profile.website}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.buttons}>
        <Pressable onPress={() => router.push(`${base}/request` as any)} accessibilityRole="button" style={({ pressed }) => [styles.primary, { flex: 1 }, pressed && { opacity: 0.85 }]}><Text style={styles.primaryText}>{t('Request a quote')}</Text></Pressable>
        <Pressable onPress={() => { void Linking.openURL(BRIGHTON_PHONE_LINK); }} accessibilityRole="button" style={({ pressed }) => [styles.secondary, { flex: 1 }, pressed && { opacity: 0.85 }]}><Text style={styles.secondaryText}>{t('Call')}</Text></Pressable>
      </View>

      {circles.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circles}>
          {circles.map((h) => {
            const uri = highlightCoverUrl(h, data.posts);   // a circle is 64 points wide: its picture comes from the small copy when there is one
            return (
              <Pressable key={h.id} onPress={() => router.push({ pathname: `${base}/work-story`, params: { highlight: h.id } } as any)} accessibilityRole="button" accessibilityLabel={h.name} style={styles.circleItem}>
                <View style={styles.circleRing}>{uri ? <OptimizedImage source={uri} style={styles.circleImg} /> : <View style={[styles.circleImg, { backgroundColor: WX.leafTint }]} />}</View>
                <Text style={styles.circleLabel} numberOfLines={1}>{h.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.tabs}>
        <Pressable onPress={() => goPage(0)} accessibilityRole="button" accessibilityState={{ selected: page === 0 }} accessibilityLabel={t('Photos and projects')} style={[styles.tab, page === 0 && styles.tabOn]}>
          <MaterialCommunityIcons name="view-grid-outline" size={24} color={page === 0 ? INK : WX.faint} />
        </Pressable>
        <Pressable onPress={() => goPage(1)} accessibilityRole="button" accessibilityState={{ selected: page === 1 }} accessibilityLabel={t('Videos')} style={[styles.tab, page === 1 && styles.tabOn]}>
          <MaterialCommunityIcons name="play-box-outline" size={25} color={page === 1 ? INK : WX.faint} />
        </Pressable>
      </View>

      <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onPagerEnd} scrollEventThrottle={16}>
        <View style={{ width }}>
          {grid.length === 0 ? <Text style={[styles.soft, styles.empty]}>{t('No projects yet.')}</Text> : (
            <View style={styles.grid}>
              {grid.slice(0, gridCount).map((p) => <Tile key={p.id} post={p} size={tile} onPress={() => openPost(p)} />)}
            </View>
          )}
        </View>
        <View style={{ width }}>
          {videos.length === 0 ? <Text style={[styles.soft, styles.empty]}>{t('No videos yet.')}</Text> : (
            <View style={styles.grid}>
              {videos.slice(0, videoCount).map((v) => <VideoTile key={v.media.id} post={v.post} url={postGridUrl(v.post) ?? v.media.thumb_url} seconds={v.media.duration_s} size={tile} onPress={() => openVideo(v.post, v.media.id)} />)}
            </View>
          )}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.countN}>{n}</Text>
      <Text style={styles.countL}>{label}</Text>
    </View>
  );
}

/** A square in the photo grid: the cover, with a small icon when the post has several pictures or a video. */
function Tile({ post, size, onPress }: { post: PortfolioPost; size: number; onPress: () => void }) {
  const uri = postGridUrl(post);
  const many = post.media.length > 1;
  const video = post.media.some((m) => m.kind === 'video');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={post.caption || post.town || 'Project'} style={{ width: size, height: size, backgroundColor: WX.leafTint }}>
      {uri ? <OptimizedImage source={uri} style={{ width: size, height: size }} /> : null}
      {many || video ? <MaterialCommunityIcons name={video && !many ? 'play' : 'checkbox-multiple-blank'} size={18} color="#FFFFFF" style={styles.badge} /> : null}
    </Pressable>
  );
}

/** A tall tile in the Videos page, with the video's length in the corner. */
function VideoTile({ url, seconds, size, onPress }: { post: PortfolioPost; url: string | null; seconds: number | null; size: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Video ${formatDuration(seconds)}`} style={{ width: size, height: size * (16 / 9), backgroundColor: '#1B2740' }}>
      {url ? <OptimizedImage source={url} style={{ width: size, height: size * (16 / 9) }} /> : null}
      <Text style={styles.duration}>{formatDuration(seconds)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  title: { color: WX.deep, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  soft: { color: WX.soft, fontSize: 14.5 },
  handle: { color: INK, fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 22, paddingHorizontal: 18, marginTop: 14 },
  ring: { width: 92, height: 92, borderRadius: 46, padding: 3 },
  ringInner: { flex: 1, borderRadius: 46, backgroundColor: WX.page, padding: 3 },
  avatar: { flex: 1, borderRadius: 46, backgroundColor: WX.leafTint, alignItems: 'center', justifyContent: 'center' },
  counts: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  countN: { color: INK, fontSize: 18, fontWeight: '700' },
  countL: { color: WX.soft, fontSize: 13 },
  bioBox: { paddingHorizontal: 18, marginTop: 12 },
  name: { color: INK, fontSize: 15, fontWeight: '700' },
  bio: { color: INK, fontSize: 14.5, lineHeight: 20, marginTop: 2 },
  link: { color: '#1D5F9A', fontSize: 14.5, fontWeight: '600', marginTop: 2 },
  buttons: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, marginTop: 14 },
  primary: { minHeight: 44, borderRadius: 12, backgroundColor: '#2E5E34', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  secondary: { minHeight: 44, borderRadius: 12, backgroundColor: WX.leafTint, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: INK, fontSize: 15, fontWeight: '700' },
  circles: { gap: 16, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 4 },
  circleItem: { width: 64, alignItems: 'center' },
  circleRing: { width: 64, height: 64, borderRadius: 32, padding: 2, borderWidth: 1.5, borderColor: WX.line },
  circleImg: { width: '100%', height: '100%', borderRadius: 30 },
  circleLabel: { color: INK, fontSize: 12, marginTop: 5 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: WX.line, marginTop: 12 },
  tab: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderTopWidth: 2, borderTopColor: 'transparent', marginTop: -1 },
  tabOn: { borderTopColor: INK },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  empty: { textAlign: 'center', marginTop: 40 },
  badge: { position: 'absolute', top: 6, right: 6 },
  duration: { position: 'absolute', left: 7, bottom: 6, color: '#FFFFFF', fontSize: 12.5, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16 },
  sheetTitle: { color: INK, fontSize: 18, fontWeight: '700' },
  sheetClose: { minHeight: 44, justifyContent: 'center' },
  sheetCloseText: { color: '#2E5E34', fontSize: 16, fontWeight: '700' },
});
