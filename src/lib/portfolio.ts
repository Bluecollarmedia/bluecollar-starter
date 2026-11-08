/**
 * "Our Work" (the portfolio): everything that decides what visitors see and how the owner's choices behave, as pure functions (no React, no
 * network), so it is tested without a phone. The data comes from update 115 (public_portfolio for visitors, the portfolio_* tables for the owner).
 */

import { audioFormatOf } from '@/lib/mediaFormats';
import type { PortfolioStory } from '@/lib/portfolioStories';

export type MediaKind = 'photo' | 'video';
export type PostKind = 'post' | 'video';

export interface PortfolioMedia {
  id: string;
  kind: MediaKind;
  url: string;
  thumb_url: string | null;
  duration_s: number | null;
  position: number;
}

export interface PortfolioPost {
  id: string;
  kind: PostKind;
  caption: string;
  town: string;
  taken_on: string;
  tags: string[];
  show_in_grid: boolean;
  posted_at: string;
  cover_url: string | null;
  /** A small (about 360 px) copy of the cover for the grid, made when the owner saves the post. */
  cover_thumb_url?: string | null;
  music_url: string | null;
  music_title: string | null;
  music_start_s: number | null;
  music_end_s: number | null;
  music_fade: boolean;
  keep_video_sound: boolean;
  media: PortfolioMedia[];
}

export interface PortfolioHighlight {
  id: string;
  name: string;
  cover_url: string | null;
  mode: 'tag' | 'manual';
  tag: string | null;
  position: number;
  post_ids: string[];
}

export interface PortfolioProfile { handle: string; bio: string; website: string; /** The picture the owner chose for the profile (the leaf logo when empty). */ avatar_url?: string | null }

export interface PublicPortfolio {
  enabled: boolean;
  profile: PortfolioProfile;
  posts: PortfolioPost[];
  highlights: PortfolioHighlight[];
  /** Stories still inside their 24 hours (missing in a feed saved before stories existed). */
  stories?: PortfolioStory[];
}

/** The tags an owner can put on a post (the same words as the circles at the top). */
export const TAG_CHOICES = ['Pavers', 'Turf', 'Lighting', 'Planting', 'Commercial', 'Snow'] as const;

export const MAX_VIDEO_S = 180;
/** A post holds up to 10 photos and videos (like Instagram). */
export const MAX_POST_MEDIA = 10;
export const MIN_CLIP_S = 5;
export const MAX_CLIP_S = 60;
export const CAPTION_MAX = 2200;

/** "0:24", "1:05". Nothing (empty) when there is no length. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const sortedMedia = (post: Pick<PortfolioPost, 'media'>): PortfolioMedia[] =>
  [...post.media].sort((a, b) => a.position - b.position);

const newestFirst = (a: PortfolioPost, b: PortfolioPost) => Date.parse(b.posted_at) - Date.parse(a.posted_at);

/** The picture the grid shows for a post: the owner's chosen cover, else the first photo, else the first video's frame. */
export function postCoverUrl(post: PortfolioPost): string | null {
  if (post.cover_url) return post.cover_url;
  const media = sortedMedia(post);
  return media.find((m) => m.kind === 'photo')?.url ?? media.find((m) => m.kind === 'video')?.thumb_url ?? null;
}

/**
 * The SMALL picture for a grid tile (so a screen of tiles is light to load): the small copy of the cover, else the first photo's small copy,
 * else the full-size picture as a last resort, else the video's frame.
 */
export function postGridUrl(post: PortfolioPost): string | null {
  if (post.cover_thumb_url) return post.cover_thumb_url;
  if (post.cover_url) return post.cover_url;
  const media = sortedMedia(post);
  const photo = media.find((m) => m.kind === 'photo');
  return photo ? photo.thumb_url ?? photo.url : media.find((m) => m.kind === 'video')?.thumb_url ?? null;
}

/** How many grid tiles are drawn at first, and how many more each time the person scrolls near the end. */
export const GRID_PAGE = 30;
export const growCount = (count: number, total: number): number => Math.min(total, count + GRID_PAGE);

/**
 * Which pictures in a swipe row are drawn: the one on screen and its two neighbours, so a swipe lands on a picture that is already there
 * (never on an empty green square). The one after that is fetched quietly by the screen. A post with 10 photos asks for 2 when it opens, not 10.
 */
export const shouldLoadSlide = (slideIndex: number, currentIndex: number): boolean => Math.abs(slideIndex - currentIndex) <= 1;

export const hasVideo = (post: PortfolioPost): boolean => post.media.some((m) => m.kind === 'video');

/** The posts in the photo grid: every project post, and a video post only when the owner chose to show it there. Newest first. */
export function gridPosts(posts: PortfolioPost[]): PortfolioPost[] {
  // Every post with something in it, reels included (a reel always shows here; the old "also show in the grid" switch is gone).
  return posts.filter((p) => p.media.length > 0).sort(newestFirst);
}

/** One entry per reel, for the Videos tab and the swipe-up reels feed. Only reels (a post that is a single video) go here; the videos inside a photo post stay in that post. Newest first. */
export interface VideoEntry { post: PortfolioPost; media: PortfolioMedia }
export function videoEntries(posts: PortfolioPost[]): VideoEntry[] {
  const out: VideoEntry[] = [];
  for (const post of [...posts].sort(newestFirst)) {
    if (post.kind !== 'video') continue;
    for (const media of sortedMedia(post)) if (media.kind === 'video') out.push({ post, media });
  }
  return out;
}

/** The three numbers under the profile picture. Counted from what is shown, never typed in by hand. */
export function portfolioCounts(posts: PortfolioPost[]): { projects: number; photos: number; services: number } {
  const tags = new Set<string>();
  let photos = 0;
  for (const p of posts) {
    for (const t of p.tags) tags.add(t);
    photos += p.media.filter((m) => m.kind === 'photo').length;
  }
  return { projects: posts.filter((p) => p.kind === 'post').length, photos, services: tags.size };
}

/** The posts inside a highlight: automatic ones follow a tag (new posts join on their own), manual ones are the owner's picks in their order. */
export function postsForHighlight(h: PortfolioHighlight, posts: PortfolioPost[]): PortfolioPost[] {
  if (h.mode === 'tag') return h.tag ? posts.filter((p) => p.tags.includes(h.tag as string)).sort(newestFirst) : [];
  const byId = new Map(posts.map((p) => [p.id, p]));
  return h.post_ids.map((id) => byId.get(id)).filter((p): p is PortfolioPost => !!p);
}

/** The circle's picture: the owner's chosen one, else the cover of the first post inside it. */
export function highlightCoverUrl(h: PortfolioHighlight, posts: PortfolioPost[]): string | null {
  if (h.cover_url) return h.cover_url;
  const first = postsForHighlight(h, posts)[0];
  return first ? postGridUrl(first) : null;
}

/** A highlight with nothing in it is not shown to visitors. */
export const visibleHighlights = (hs: PortfolioHighlight[], posts: PortfolioPost[]): PortfolioHighlight[] =>
  [...hs].sort((a, b) => a.position - b.position).filter((h) => postsForHighlight(h, posts).length > 0);

// ── Music: the part of the track that plays ─────────────────────────────────────────────────────────────────────────────────────────

export interface Clip { startS: number; endS: number }

/**
 * Keeps a chosen part of a track sensible: inside the track, between 5 and 60 seconds long (a track shorter than 5 seconds plays whole).
 * When the part is too long the end is pulled in; too short, the end is pushed out (or the start pulled back at the end of the track).
 */
export function normalizeClip(startS: number, endS: number, trackS: number): Clip {
  const track = Math.max(0, Number.isFinite(trackS) ? trackS : 0);
  if (track <= MIN_CLIP_S) return { startS: 0, endS: track };
  let start = Math.min(Math.max(0, Number.isFinite(startS) ? startS : 0), track - MIN_CLIP_S);
  let end = Number.isFinite(endS) ? endS : start + MAX_CLIP_S;
  end = Math.min(end, track, start + MAX_CLIP_S);
  if (end - start < MIN_CLIP_S) end = Math.min(track, start + MIN_CLIP_S);
  if (end - start < MIN_CLIP_S) start = Math.max(0, end - MIN_CLIP_S);
  return { startS: round1(start), endS: round1(end) };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

export const clipLengthS = (c: Clip): number => Math.max(0, c.endS - c.startS);

/** While a post is open the part loops: once playback reaches the end of the part it jumps back to the start. */
export function nextLoopPosition(currentS: number, c: Clip): number | null {
  return currentS >= c.endS || currentS < c.startS - 0.5 ? c.startS : null;
}

/** The volume at a moment of the part, with the fade-out (the last 2 seconds) when it is on. 1 = full. */
export function clipVolume(currentS: number, c: Clip, fade: boolean): number {
  if (!fade) return 1;
  const left = c.endS - currentS;
  return left >= 2 ? 1 : Math.max(0, left / 2);
}

// ── The scrub bar ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const fractionOf = (timeS: number, durationS: number): number =>
  durationS > 0 && Number.isFinite(timeS) ? Math.min(1, Math.max(0, timeS / durationS)) : 0;

export const timeAtFraction = (fraction: number, durationS: number): number =>
  durationS > 0 ? Math.min(durationS, Math.max(0, fraction * durationS)) : 0;

/** The bar is thin at rest and thick while a finger is on it (easier to aim); the numbers are in points. */
export const SCRUB_BAR_HEIGHT = { resting: 3, scrubbing: 12 } as const;

// ── Owner: what a post needs before it can be saved ──────────────────────────────────────────────────────────────────────────────

export interface PostDraft {
  kind: PostKind;
  caption: string;
  town: string;
  tags: string[];
  media: { kind: MediaKind; duration_s: number | null }[];
  music?: { url: string; startS: number; endS: number } | null;
}

/** The first thing wrong with a post, in plain words, or null when it can be saved. */
export function postProblem(d: PostDraft): string | null {
  if (d.media.length < 1) return d.kind === 'video' ? 'Choose a video.' : 'Add at least one photo or video.';
  if (d.kind === 'video' && (d.media.length !== 1 || d.media[0].kind !== 'video')) return 'A video post holds exactly one video.';
  if (d.media.length > MAX_POST_MEDIA) return `A post holds up to ${MAX_POST_MEDIA} photos and videos.`;
  if (d.media.some((m) => m.kind === 'video' && (m.duration_s == null || m.duration_s > MAX_VIDEO_S))) return `Videos can be up to ${MAX_VIDEO_S} seconds.`;
  if (d.caption.length > CAPTION_MAX) return 'The caption is too long.';
  if (d.town.length > 80) return 'The town is too long.';
  if (d.tags.length > 8 || d.tags.some((t) => !(TAG_CHOICES as readonly string[]).includes(t))) return 'Choose tags from the list.';
  if (d.music && !(d.music.endS > d.music.startS)) return 'Choose the part of the music that plays.';
  return null;
}

/** Moves one item in a list (drag to reorder). Out-of-range moves leave the list as it was. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The pre-filled note on the Request form when someone taps "Want something like this?". */
export function requestNoteFor(post: Pick<PortfolioPost, 'town' | 'caption' | 'tags'>): { services: string[]; note: string } {
  const map: Record<string, string> = {
    Pavers: 'Pavers, Patios & Walkways', Turf: 'Turf & Sod Installation', Lighting: 'Lighting & Planting', Planting: 'Lighting & Planting',
    Commercial: 'Commercial Maintenance', Snow: 'Snow & Storm Response',
  };
  const services = [...new Set(post.tags.map((t) => map[t]).filter(Boolean))];
  const where = post.town ? ` in ${post.town}` : '';
  return { services, note: `Something like your project${where}.` };
}

// ── The reels feed (swipe up through the videos) ─────────────────────────────────────────────────────────────────────────────────

/** Where a reel sits in the list of reels (0 when it is not found, so the viewer still opens on the first one). -1 means "no reels at all". */
export function reelIndexOf(entries: VideoEntry[], mediaId: string | undefined): number {
  if (entries.length === 0) return -1;
  const i = mediaId ? entries.findIndex((e) => e.media.id === mediaId) : -1;
  return i < 0 ? 0 : i;
}

/**
 * Which reel gets prepared in the background: only the NEXT one, and only once the one on screen has actually started playing; never two at once.
 * Everything else stays as a still picture, so scrolling a long list never loads a pile of videos.
 */
export function reelToPreload(activeIndex: number, activeStarted: boolean, count: number): number | null {
  return activeStarted && activeIndex + 1 < count ? activeIndex + 1 : null;
}

export type ReelMode = 'active' | 'preload' | 'idle';
export function reelMode(index: number, activeIndex: number, preloadIndex: number | null): ReelMode {
  return index === activeIndex ? 'active' : index === preloadIndex ? 'preload' : 'idle';
}

/** A post that is only a video opens as a reel; a post with photos opens as a project. */
export const opensAsReel = (post: Pick<PortfolioPost, 'kind'>): boolean => post.kind === 'video';

// ── Owner: highlights (the circles) ──────────────────────────────────────────────────────────────────────────────────────────

export const HIGHLIGHT_NAME_MAX = 14;

export interface HighlightDraft { name: string; mode: 'tag' | 'manual'; tag: string | null; postIds: string[] }

/** The first thing wrong with a highlight, in plain words, or null when it can be saved. */
export function highlightProblem(d: HighlightDraft): string | null {
  const name = d.name.trim();
  if (!name) return 'Give the highlight a name.';
  if (name.length > HIGHLIGHT_NAME_MAX) return `Keep the name to ${HIGHLIGHT_NAME_MAX} letters so it fits under the circle.`;
  if (d.mode === 'tag' && (!d.tag || !(TAG_CHOICES as readonly string[]).includes(d.tag))) return 'Choose the tag this highlight follows.';
  if (d.mode === 'manual' && d.postIds.length === 0) return 'Choose at least one post.';
  return null;
}

// ── Music: the owner's track, the timeline and the handles ─────────────────────────────────────────────────────────────────────

export const MAX_TRACK_MB = 30;
export const DEFAULT_CLIP_S = 30;

/** "Sunset-Drive_final.mp3" → "Sunset Drive final" (the name shown on the music chip; the owner can change it). */
export function trackTitleFromFile(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.slice(0, 60) || 'My track';
}

/** Is this a file Our Work can use as music (by its name or type)? */
export function isUsableTrack(fileName: string, mimeType?: string | null): boolean {
  return audioFormatOf(fileName, mimeType) !== null;
}

/** Where the part starts when a track is first chosen: about a quarter in for a long track (skipping a slow intro), the beginning for a short one. */
export function defaultClip(trackS: number): Clip {
  const start = trackS > 2 * DEFAULT_CLIP_S ? Math.round(trackS * 0.25) : 0;
  return normalizeClip(start, start + DEFAULT_CLIP_S, trackS);
}

/** The handles' places along the timeline, as fractions 0 to 1. */
export function clipFractions(c: Clip, trackS: number): { start: number; end: number } {
  return trackS > 0 ? { start: Math.min(1, c.startS / trackS), end: Math.min(1, c.endS / trackS) } : { start: 0, end: 0 };
}

/** Dragging the whole part along the track: it keeps its length and stops at the ends of the track. */
export function moveClip(c: Clip, trackS: number, newStartS: number): Clip {
  const len = c.endS - c.startS;
  const start = Math.min(Math.max(0, newStartS), Math.max(0, trackS - len));
  return { startS: Math.round(start * 10) / 10, endS: Math.round((start + len) * 10) / 10 };
}

/** Dragging the left handle: the end stays, and the length stays between 5 and 60 seconds. */
export function dragClipStart(c: Clip, trackS: number, newStartS: number): Clip {
  void trackS;
  const start = Math.max(0, c.endS - MAX_CLIP_S, Math.min(Math.max(0, newStartS), c.endS - MIN_CLIP_S));
  return { startS: Math.round(start * 10) / 10, endS: c.endS };
}

/** Dragging the right handle: the start stays, the length stays between 5 and 60 seconds, and it cannot go past the end of the track. */
export function dragClipEnd(c: Clip, trackS: number, newEndS: number): Clip {
  return normalizeClip(c.startS, Math.max(newEndS, c.startS + MIN_CLIP_S), trackS);
}

/** The ruler marks under the timeline (every 10, 30 or 60 seconds depending on the track's length). */
export function rulerMarks(trackS: number): number[] {
  if (!(trackS > 0)) return [];
  const step = trackS > 360 ? 60 : trackS > 120 ? 30 : 10;
  const out: number[] = [];
  for (let t = 0; t <= trackS; t += step) out.push(t);
  return out;
}

// ── Cover: choosing a frame of a video ───────────────────────────────────────────────────────────────────────────────────────

/** `count` moments spread along a video, for the strip of small frames (each in the middle of its slice, so none is a black first frame). */
export function frameTimes(durationS: number, count: number): number[] {
  if (!(durationS > 0) || count < 1) return [];
  return Array.from({ length: count }, (_, i) => Math.round(((i + 0.5) / count) * durationS * 10) / 10);
}

// ── Highlights play like a story that never expires ──────────────────────────────────────────────────────────────────────────────

export const MAX_HIGHLIGHT_FRAMES = 60;

/**
 * What a highlight plays: every photo and video of its posts, one after another, in the story viewer (the circle opens a story, not a grid).
 * A photo shows a few seconds, a video its own length. They never expire. Capped so one circle never plays for ages.
 */
export function highlightFrames(h: PortfolioHighlight, posts: PortfolioPost[]): PortfolioStory[] {
  const out: PortfolioStory[] = [];
  for (const post of postsForHighlight(h, posts)) {
    for (const m of sortedMedia(post)) {
      if (out.length >= MAX_HIGHLIGHT_FRAMES) return out;
      out.push({
        id: `${post.id}:${m.id}`, kind: m.kind === 'video' ? 'video' : 'photo', media_url: m.url, media_thumb_url: m.thumb_url, duration_s: m.duration_s,
        post_id: post.id, media_id: m.id, design: null, created_at: post.posted_at, expires_at: '9999-12-31T00:00:00.000Z',
      });
    }
  }
  return out;
}

/** The address to open for the website shown on the profile: "brightonlawn.com" becomes "https://brightonlawn.com"; a full address is kept. */
export function websiteHref(site: string | null | undefined): string {
  const s = (site ?? '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`;
}

/**
 * The link shared for a project or a reel: the website address the app claims (associatedDomains), so on a phone with the app it opens the
 * project or reel itself; anyone else lands on the website. Empty when the app has no website address.
 */
export function shareLinkFor(webUrl: string, post: Pick<PortfolioPost, 'id'>, mediaId?: string | null): string {
  const base = (webUrl ?? '').replace(/\/+$/, '');
  if (!base) return '';
  return mediaId ? `${base}/weather/work-video?post=${encodeURIComponent(post.id)}&media=${encodeURIComponent(mediaId)}` : `${base}/weather/work-post?id=${encodeURIComponent(post.id)}`;
}

/** The words that go with the link: the caption (and town), or the company name. */
export function shareTextFor(post: Pick<PortfolioPost, 'caption' | 'town'>): string {
  const caption = (post.caption ?? '').trim();
  const town = (post.town ?? '').trim();
  return `${caption || 'Brighton Lawn & Landscape'}${town ? ` (${town})` : ''}`;
}

/**
 * The posts of the feed, in the grid's order (every project post, and the reels the owner shows in the grid), newest first. The post that was
 * tapped is always in it: a reel kept out of the grid, opened from the Videos tab or a link, is put first.
 */
export function feedPosts(posts: PortfolioPost[], openedId: string | undefined): PortfolioPost[] {
  const list = gridPosts(posts);
  if (!openedId || list.some((p) => p.id === openedId)) return list;
  const opened = posts.find((p) => p.id === openedId);
  return opened ? [opened, ...list] : list;
}
