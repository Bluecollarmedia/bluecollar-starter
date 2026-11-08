/**
 * Stories on Our Work (update 115): the rules, as pure functions (no React, no network), so they are tested without a phone.
 * A story lasts 24 hours. Three kinds: a photo, a video (up to 60 seconds) and a "share": a designed card that frames one of the posts and
 * opens it when tapped. The ring around the profile picture is coloured while there is something not yet watched and grey once everything has been.
 */

export type StoryKind = 'photo' | 'video' | 'share';

export type StoryBackground = 'solid' | 'gradient' | 'blur';
export type TextPlace = 'top' | 'bottom';

/** How a shared card looks. Everything is the owner's choice and is kept within safe limits (see normalizeDesign). */
export interface StoryDesign {
  background: StoryBackground;
  color: string;
  color2: string;
  frameColor: string;
  frameWidth: number;
  radius: number;
  scale: number;
  text: string;
  textColor: string;
  textPlace: TextPlace;
}

export interface PortfolioStory {
  id: string;
  kind: StoryKind;
  media_url: string | null;
  media_thumb_url: string | null;
  duration_s: number | null;
  post_id: string | null;
  media_id: string | null;
  design: Partial<StoryDesign> | null;
  created_at: string;
  expires_at: string;
}

export const STORY_HOURS = 24;
export const PHOTO_MS = 5000;
export const SHARE_MS = 6000;
export const MAX_STORY_VIDEO_S = 60;
export const TEXT_MAX = 80;
export const FRAME_WIDTH_MAX = 24;
export const RADIUS_MAX = 40;
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 0.95;

/** The colours the owner can pick from (brand greens first). */
export const STORY_COLORS = ['#2E5E34', '#8CCB63', '#17301F', '#FBFDF8', '#F2B632', '#1D5F9A', '#1B2740', '#B3261E'] as const;

export const DEFAULT_DESIGN: StoryDesign = {
  background: 'gradient',
  color: '#2E5E34',
  color2: '#17301F',
  frameColor: '#FBFDF8',
  frameWidth: 10,
  radius: 22,
  scale: 0.78,
  text: '',
  textColor: '#FBFDF8',
  textPlace: 'bottom',
};

const HEX = /^#[0-9A-Fa-f]{6}$/;
const clamp = (n: unknown, lo: number, hi: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

/** Takes whatever is stored and returns a design that is always safe to draw (bad or missing parts fall back to the default). */
export function normalizeDesign(raw: Partial<StoryDesign> | null | undefined): StoryDesign {
  const d = raw ?? {};
  const d0 = DEFAULT_DESIGN;
  return {
    background: d.background === 'solid' || d.background === 'gradient' || d.background === 'blur' ? d.background : d0.background,
    color: typeof d.color === 'string' && HEX.test(d.color) ? d.color : d0.color,
    color2: typeof d.color2 === 'string' && HEX.test(d.color2) ? d.color2 : d0.color2,
    frameColor: typeof d.frameColor === 'string' && HEX.test(d.frameColor) ? d.frameColor : d0.frameColor,
    frameWidth: Math.round(clamp(d.frameWidth, 0, FRAME_WIDTH_MAX, d0.frameWidth)),
    radius: Math.round(clamp(d.radius, 0, RADIUS_MAX, d0.radius)),
    scale: Math.round(clamp(d.scale, SCALE_MIN, SCALE_MAX, d0.scale) * 100) / 100,
    text: typeof d.text === 'string' ? d.text.slice(0, TEXT_MAX) : '',
    textColor: typeof d.textColor === 'string' && HEX.test(d.textColor) ? d.textColor : d0.textColor,
    textPlace: d.textPlace === 'top' ? 'top' : 'bottom',
  };
}

/** One step up or down for the owner's + / - buttons, kept inside the limits. */
export function stepValue(value: number, delta: number, lo: number, hi: number): number {
  return Math.round(Math.min(hi, Math.max(lo, value + delta)) * 100) / 100;
}

/** The stories still inside their 24 hours, oldest first (the order they play in). */
export function activeStories(stories: PortfolioStory[] | undefined, now: number): PortfolioStory[] {
  return (stories ?? []).filter((s) => Date.parse(s.expires_at) > now).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** When a story made at `createdAt` stops showing. */
export const expiresAtFor = (createdAt: number): string => new Date(createdAt + STORY_HOURS * 3_600_000).toISOString();

/** "18h left", "35m left", or "" once it is over (what the owner sees next to each story). */
export function timeLeftLabel(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return '';
  const minutes = Math.ceil(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h left` : `${minutes}m left`;
}

/** How long a story stays up before it moves on by itself: a photo and a card a few seconds, a video its own length. */
export function storyDurationMs(s: Pick<PortfolioStory, 'kind' | 'duration_s'>): number {
  if (s.kind === 'video') {
    const sec = typeof s.duration_s === 'number' && s.duration_s > 0 ? Math.min(s.duration_s, MAX_STORY_VIDEO_S) : 8;
    return Math.round(sec * 1000);
  }
  return s.kind === 'share' ? SHARE_MS : PHOTO_MS;
}

// ── moving through the stories ───────────────────────────────────────────────────────────────────────────────────────────────────

export type TapZone = 'previous' | 'next';

/** A tap on the left third goes back, anywhere else goes on (like Instagram). */
export const tapZone = (x: number, width: number): TapZone => (width > 0 && x < width * 0.3 ? 'previous' : 'next');

/** The story to show after this one finishes or is tapped past: the next, or null when the last one is done (then the viewer closes). */
export const nextIndex = (index: number, count: number): number | null => (index + 1 < count ? index + 1 : null);

/** Going back from the first story restarts it (it does not close). */
export const previousIndex = (index: number): number => Math.max(0, index - 1);

// ── the ring and what has been watched ────────────────────────────────────────────────────────────────────────────────────────

export type RingState = 'none' | 'unseen' | 'seen';

/** The ring around the profile picture: none without stories, coloured while any is unwatched, grey when all have been watched. */
export function ringState(stories: PortfolioStory[], seen: ReadonlySet<string>): RingState {
  if (stories.length === 0) return 'none';
  return stories.every((s) => seen.has(s.id)) ? 'seen' : 'unseen';
}

/** Opening the stories starts at the first one not watched yet; when everything was watched, it starts again from the beginning. */
export function startIndex(stories: PortfolioStory[], seen: ReadonlySet<string>): number {
  const i = stories.findIndex((s) => !seen.has(s.id));
  return i < 0 ? 0 : i;
}

/** The remembered "watched" list after watching `id`: no duplicates, and only stories that still exist are kept (it never grows without end). */
export function markSeen(seen: readonly string[], id: string, stillExisting: readonly string[]): string[] {
  const keep = new Set(stillExisting);
  const out = seen.filter((x) => keep.has(x) && x !== id);
  if (keep.has(id)) out.push(id);
  return out;
}

// ── the owner adding a story ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StoryDraft {
  kind: StoryKind;
  mediaUrl?: string | null;
  durationS?: number | null;
  postId?: string | null;
  design?: Partial<StoryDesign> | null;
}

/** The first thing wrong with a story, in plain words, or null when it can be added. */
export function storyProblem(d: StoryDraft): string | null {
  if (d.kind === 'share') {
    if (!d.postId) return 'Choose the project or video to share.';
    if ((d.design?.text ?? '').length > TEXT_MAX) return `The text can be up to ${TEXT_MAX} characters.`;
    return null;
  }
  if (!d.mediaUrl) return d.kind === 'video' ? 'Choose a video.' : 'Choose a photo.';
  if (d.kind === 'video' && (!(typeof d.durationS === 'number') || d.durationS <= 0)) return 'That video has no length.';
  if (d.kind === 'video' && (d.durationS as number) > MAX_STORY_VIDEO_S) return `A story video can be up to ${MAX_STORY_VIDEO_S} seconds.`;
  return null;
}

/** What opens when the shared card is tapped: the video full screen when the post is a video post, otherwise the project. */
export function shareTarget(s: Pick<PortfolioStory, 'post_id' | 'media_id'>, post: { kind: 'post' | 'video'; media: { id: string; kind: 'photo' | 'video' }[] } | undefined):
  { type: 'video'; postId: string; mediaId: string } | { type: 'post'; postId: string } | null {
  if (!s.post_id || !post) return null;
  const video = post.kind === 'video' ? post.media.find((m) => m.kind === 'video') : undefined;
  const chosen = s.media_id ? post.media.find((m) => m.id === s.media_id && m.kind === 'video') : undefined;
  const v = chosen ?? video;
  return v ? { type: 'video', postId: s.post_id, mediaId: v.id } : { type: 'post', postId: s.post_id };
}

/** "now", "5m", "3h": how long ago a story was added, shown next to the name at the top of the viewer. */
export function agoLabel(createdAt: string, now: number): string {
  const min = Math.floor((now - Date.parse(createdAt)) / 60_000);
  if (!(min >= 1)) return 'now';
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h`;
}
