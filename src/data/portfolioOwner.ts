/**
 * Our Work, the owner's side (update 115): read everything, edit the profile text, create / change / hide / delete posts and their photos and
 * videos. Only the owner and admins can do any of it (the database refuses everyone else). Every call returns a plain result and never throws.
 * The master on/off switch lives in data/portfolio.ts (owner only).
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { removeMedia } from '@/lib/media';
import { db } from '@/data/store';
import { portfolioFolder } from '@/lib/portfolioMedia';
import { config } from '@/lib/config';
import { highlightFileKeys, mediaFileKeys, postFileKeys } from '@/lib/portfolioFiles';

/** Deletes stored files, best effort and one by one (a file that is already gone is not an error). */
export function removeStoredFiles(keys: string[]): void {
  for (const k of keys) void removeMedia(k);
}
import { highlightProblem, postProblem, type MediaKind, type PortfolioHighlight, type PortfolioMedia, type PortfolioPost, type PostKind } from '@/lib/portfolio';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";
const NOT_INSTALLED = 'Our Work is not installed on the database yet.';
const friendly = (m: string) => (/relation .* does not exist|schema cache|could not find/i.test(m) ? NOT_INSTALLED : m);

/** A saved photo or video, with where its file is stored (so removing it from the post can also remove the file). */
export interface OwnerMedia extends PortfolioMedia { storage_key?: string | null }
export interface OwnerPost extends PortfolioPost { visible: boolean; media: OwnerMedia[] }
export interface OwnerSettings { enabled: boolean; handle: string; bio: string; website: string; avatar_url?: string | null }
export interface OwnerPortfolio { settings: OwnerSettings; posts: OwnerPost[]; highlights: PortfolioHighlight[] }

const DEFAULT_SETTINGS: OwnerSettings = { enabled: false, handle: 'brightonlawn', bio: '', website: '' };
const POST_COLUMNS = 'id, kind, caption, town, taken_on, tags, show_in_grid, visible, posted_at, cover_url, cover_thumb_url, music_url, music_title, music_start_s, music_end_s, music_fade, keep_video_sound, media:portfolio_media(id, kind, url, thumb_url, duration_s, position, storage_key)';

/** Everything the owner manages, in one go. */
export async function loadOwnerPortfolio(): Promise<Result<OwnerPortfolio>> {
  if (!isSupabaseConfigured) return { ok: false, error: UNREACHABLE };
  try {
    const [s, p, h] = await Promise.all([
      supabase.from('portfolio_settings').select('enabled, handle, bio, website, avatar_url').maybeSingle(),
      supabase.from('portfolio_posts').select(POST_COLUMNS).order('posted_at', { ascending: false }).limit(200),
      supabase.from('portfolio_highlights').select('id, name, cover_url, mode, tag, position, post_ids:portfolio_highlight_posts(post_id, position)').order('position', { ascending: true }),
    ]);
    const err = s.error ?? p.error ?? h.error;
    if (err) return { ok: false, error: friendly(err.message) };
    const highlights = ((h.data ?? []) as unknown as Array<Omit<PortfolioHighlight, 'post_ids'> & { post_ids: { post_id: string; position: number }[] }>).map((x) => ({
      ...x, post_ids: [...(x.post_ids ?? [])].sort((a, b) => a.position - b.position).map((r) => r.post_id),
    }));
    return { ok: true, data: { settings: (s.data as OwnerSettings | null) ?? DEFAULT_SETTINGS, posts: (p.data ?? []) as unknown as OwnerPost[], highlights } };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** The text under the name on Our Work. */
export async function saveProfile(input: { bio: string; website: string; /** undefined: leave as is; null: back to the leaf logo; text: the picture's address */ avatarUrl?: string | null }): Promise<Result<null>> {
  const companyId = db.companyId;
  if (!companyId) return { ok: false, error: 'Sign in again.' };
  const bio = input.bio.trim().slice(0, 300);
  const website = input.website.trim().slice(0, 120);
  try {
    const upd = await supabase.from('portfolio_settings').update({ bio, website, ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}), updated_by: db.personId ?? null, updated_at: new Date().toISOString() }).eq('company_id', companyId).select('company_id');
    if (upd.error) return { ok: false, error: friendly(upd.error.message) };
    if (!upd.data?.length) {
      const ins = await supabase.from('portfolio_settings').insert({ company_id: companyId, bio, website, avatar_url: input.avatarUrl ?? null, updated_by: db.personId ?? null });
      if (ins.error) return { ok: false, error: friendly(ins.error.message) };
    }
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** A photo or video already uploaded (or already on the web, like a project's photo) that goes into a post. */
export interface MediaInput {
  /** Set for one that is already saved in the post. */
  id?: string;
  kind: MediaKind;
  url: string;
  key?: string | null;
  thumbUrl?: string | null;
  durationS?: number | null;
}

export interface NewPostInput {
  kind: PostKind;
  caption: string;
  town: string;
  takenOn: string;
  tags: string[];
  showInGrid: boolean;
  visible: boolean;
  projectId?: string | null;
  coverUrl?: string | null;
  coverThumbUrl?: string | null;
  /** The owner's own track and the part of it that plays (update 115). */
  music?: { url: string; title: string; startS: number; endS: number; fade: boolean; keepVideoSound: boolean } | null;
  media: MediaInput[];
}

/** The small grid picture for a new post: its first photo's small copy, or its first video's frame. */
function gridThumbOf(media: MediaInput[]): string | null {
  const first = media[0];
  return first ? first.thumbUrl ?? null : null;
}

/** Creates a post with its photos and videos. If the pictures cannot be saved the post is not left behind half made. */
export async function createPost(input: NewPostInput): Promise<Result<string>> {
  const companyId = db.companyId;
  if (!companyId) return { ok: false, error: 'Sign in again.' };
  const bad = postProblem({ kind: input.kind, caption: input.caption, town: input.town, tags: input.tags, media: input.media.map((m) => ({ kind: m.kind, duration_s: m.durationS ?? null })) });
  if (bad) return { ok: false, error: bad };
  try {
    const { data, error } = await supabase.from('portfolio_posts').insert({
      company_id: companyId, kind: input.kind, project_id: input.projectId ?? null, caption: input.caption.trim(), town: input.town.trim(), taken_on: input.takenOn.trim().slice(0, 30),
      tags: input.tags, show_in_grid: input.kind === 'video' ? input.showInGrid : true, visible: input.visible,
      cover_url: input.coverUrl ?? null, cover_thumb_url: input.coverThumbUrl ?? gridThumbOf(input.media),
      music_url: input.music?.url ?? null, music_title: input.music?.title ?? null, music_start_s: input.music?.startS ?? null, music_end_s: input.music?.endS ?? null,
      music_fade: input.music?.fade ?? true, keep_video_sound: input.music?.keepVideoSound ?? false,
    }).select('id').single();
    if (error || !data) return { ok: false, error: friendly(error?.message ?? UNREACHABLE) };
    const postId = (data as { id: string }).id;
    const rows = input.media.map((m, i) => ({ post_id: postId, company_id: companyId, kind: m.kind, url: m.url, storage_key: m.key ?? null, thumb_url: m.thumbUrl ?? null, duration_s: m.kind === 'video' ? m.durationS ?? null : null, position: i }));
    const ins = await supabase.from('portfolio_media').insert(rows);
    if (ins.error) {
      await supabase.from('portfolio_posts').delete().eq('id', postId);
      return { ok: false, error: friendly(ins.error.message) };
    }
    return { ok: true, data: postId };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export interface PostPatch {
  caption?: string; town?: string; taken_on?: string; tags?: string[]; show_in_grid?: boolean; visible?: boolean; posted_at?: string;
  cover_url?: string | null; cover_thumb_url?: string | null;
  music_url?: string | null; music_title?: string | null; music_start_s?: number | null; music_end_s?: number | null; music_fade?: boolean; keep_video_sound?: boolean;
}

/** Changes a post's text, tags, switches, cover or music. */
export async function updatePost(id: string, patch: PostPatch): Promise<Result<null>> {
  try {
    const { error } = await supabase.from('portfolio_posts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Show or hide a post without losing it ("take down"). */
export const setPostVisible = (id: string, visible: boolean): Promise<Result<null>> => updatePost(id, { visible });

/**
 * Saves the photos and videos of a post exactly as the owner arranged them: the ones left out are removed, new ones are added, and every one
 * gets its place in the order. Files the owner uploaded for Our Work are deleted from storage; a picture that came from somewhere else (a
 * project's photo) is only taken out of the post, never deleted.
 */
export async function saveMedia(postId: string, items: MediaInput[], before: Pick<PortfolioMedia, 'id' | 'url' | 'thumb_url'>[], keysByMediaId: Record<string, string | null | undefined>): Promise<Result<null>> {
  const companyId = db.companyId;
  if (!companyId) return { ok: false, error: 'Sign in again.' };
  try {
    const keep = new Set(items.map((m) => m.id).filter((x): x is string => !!x));
    const removed = before.filter((m) => !keep.has(m.id));
    if (removed.length) {
      const del = await supabase.from('portfolio_media').delete().in('id', removed.map((m) => m.id));
      if (del.error) return { ok: false, error: friendly(del.error.message) };
      // The removed picture's file AND its small grid copy / still frame.
      for (const m of removed) {
        const keys = new Set(mediaFileKeys({ url: (m as PortfolioMedia).url, thumb_url: (m as PortfolioMedia).thumb_url, storage_key: keysByMediaId[m.id] }, config.r2PublicUrl, companyId));
        removeStoredFiles([...keys]);
      }
    }
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      if (m.id) {
        const up = await supabase.from('portfolio_media').update({ position: i }).eq('id', m.id);
        if (up.error) return { ok: false, error: friendly(up.error.message) };
      } else {
        const ins = await supabase.from('portfolio_media').insert({ post_id: postId, company_id: companyId, kind: m.kind, url: m.url, storage_key: m.key ?? null, thumb_url: m.thumbUrl ?? null, duration_s: m.kind === 'video' ? m.durationS ?? null : null, position: i });
        if (ins.error) return { ok: false, error: friendly(ins.error.message) };
      }
    }
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Deletes a post for good (its photos and videos too). Files the owner uploaded are removed from storage. */
/** Deletes a post and EVERY stored file of it: its photos and videos with their small copies and still frames, its cover, its music. */
export async function deletePost(id: string, post: { media: (PortfolioMedia & { storage_key?: string | null })[]; cover_url?: string | null; cover_thumb_url?: string | null; music_url?: string | null }): Promise<Result<null>> {
  const companyId = db.companyId;
  try {
    const { error } = await supabase.from('portfolio_posts').delete().eq('id', id);
    if (error) return { ok: false, error: friendly(error.message) };
    if (companyId) removeStoredFiles(postFileKeys(post, config.r2PublicUrl, companyId));
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

// ── Highlights ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HighlightInput { name: string; mode: 'tag' | 'manual'; tag: string | null; coverUrl: string | null; postIds: string[] }

/** Creates a highlight (id null) or changes one. Hand-picked posts are saved in the order given; an automatic one keeps no picks. */
export async function saveHighlight(id: string | null, input: HighlightInput, position: number): Promise<Result<string>> {
  const companyId = db.companyId;
  if (!companyId) return { ok: false, error: 'Sign in again.' };
  const bad = highlightProblem({ name: input.name, mode: input.mode, tag: input.tag, postIds: input.postIds });
  if (bad) return { ok: false, error: bad };
  try {
    const fields = { name: input.name.trim(), mode: input.mode, tag: input.mode === 'tag' ? input.tag : null, cover_url: input.coverUrl };
    let hid = id;
    if (hid) {
      const { error } = await supabase.from('portfolio_highlights').update(fields).eq('id', hid);
      if (error) return { ok: false, error: friendly(error.message) };
    } else {
      const { data, error } = await supabase.from('portfolio_highlights').insert({ ...fields, company_id: companyId, position }).select('id').single();
      if (error || !data) return { ok: false, error: friendly(error?.message ?? UNREACHABLE) };
      hid = (data as { id: string }).id;
    }
    const clear = await supabase.from('portfolio_highlight_posts').delete().eq('highlight_id', hid);
    if (clear.error) return { ok: false, error: friendly(clear.error.message) };
    if (input.mode === 'manual') {
      const ins = await supabase.from('portfolio_highlight_posts').insert(input.postIds.map((post_id, i) => ({ highlight_id: hid, post_id, position: i })));
      if (ins.error) return { ok: false, error: friendly(ins.error.message) };
    }
    return { ok: true, data: hid as string };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function deleteHighlight(id: string): Promise<Result<null>> {
  try {
    const companyId = db.companyId;
    // The circle's own picture (if the owner uploaded one) goes with it.
    const { data: row } = await supabase.from('portfolio_highlights').select('cover_url').eq('id', id).maybeSingle();
    const { error } = await supabase.from('portfolio_highlights').delete().eq('id', id);
    if (error) return { ok: false, error: friendly(error.message) };
    if (companyId && row) removeStoredFiles(highlightFileKeys(row as { cover_url?: string | null }, config.r2PublicUrl, companyId));
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Saves the order of the circles (the first id is the first circle). */
export async function saveHighlightOrder(ids: string[]): Promise<Result<null>> {
  try {
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from('portfolio_highlights').update({ position: i }).eq('id', ids[i]);
      if (error) return { ok: false, error: friendly(error.message) };
    }
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
