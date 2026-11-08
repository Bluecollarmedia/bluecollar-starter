/**
 * The owner's own music for a post (phone only): pick an audio file from the phone, read how long it is, and upload it. The whole track is saved
 * once (shrunk to a small AAC file so it starts fast) together with the part chosen (start and end); the app plays just that part. Nothing here talks to a music service.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { keepPicked } from '@/lib/keepPickedFile';
import { uploadImage } from '@/lib/media';
import { portfolioFolder } from '@/lib/portfolioMedia';
import { audioProblem } from '@/lib/mediaFormats';
import { MAX_TRACK_MB } from '@/lib/portfolio';

export interface PickedTrack { uri: string; fileName: string; mimeType: string | null; sizeBytes: number | null; /** Already a small AAC file made by the app (the audio taken from a video): sent as it is. */ ready?: boolean }

/**
 * Takes the sound out of a video on the phone and saves it as a small AAC file (.m4a, 128 kbps), using the audio tool already in the app
 * (it reads a video file's audio track like any other). Null when the phone cannot do it.
 */
export async function extractAudioFromVideo(videoUri: string): Promise<string | null> {
  try {
    const compressor = require('react-native-compressor') as { Audio?: { compress: (uri: string, o: { bitrate?: number }) => Promise<string> } };
    if (!compressor.Audio) return null;
    const out = await compressor.Audio.compress(videoUri, { bitrate: 128000 });
    return out || null;
  } catch {
    return null;
  }
}

/** Opens the phone's videos and takes the sound out of the chosen one, as a track to use for a post. Null when cancelled, or an error in plain words. */
export async function pickTrackFromVideo(): Promise<{ ok: true; track: PickedTrack } | { ok: false; error: string } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, error: 'Turn on photo access for Brighton Lawn in the Settings app.' };
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false, quality: 1 });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  // The picked file is copied somewhere safe at once (the phone may remove its temporary copy).
  const kept = await keepPicked(a.uri, 'video');
  const audio = await extractAudioFromVideo(kept);
  if (!audio) return { ok: false, error: "Couldn't take the sound out of that video. Try another one." };
  const base = (a.fileName ?? 'video').replace(/\.[^.]+$/, '');
  return { ok: true, track: { uri: audio, fileName: `${base} (from video).m4a`, mimeType: 'audio/mp4', sizeBytes: a.fileSize ?? null, ready: true } };
}

/** Opens the phone's Files picker for an audio file. Returns null when cancelled, or an error in plain words. */
export async function pickTrack(): Promise<{ ok: true; track: PickedTrack } | { ok: false; error: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const bad = audioProblem(a.name, a.mimeType);
  if (bad) return { ok: false, error: bad };
  if (a.size && a.size > MAX_TRACK_MB * 1024 * 1024) return { ok: false, error: `That track is bigger than ${MAX_TRACK_MB} MB. Choose a smaller one.` };
  return { ok: true, track: { uri: a.uri, fileName: a.name, mimeType: a.mimeType ?? null, sizeBytes: a.size ?? null } };
}

/** How long a track is, in seconds (null when the phone cannot read it in a few seconds). */
export async function readTrackDuration(uri: string): Promise<number | null> {
  try {
    const { createVideoPlayer } = require('expo-video') as typeof import('expo-video');
    const player = createVideoPlayer(uri);
    return await new Promise<number | null>((resolve) => {
      let done = false;
      const finish = (v: number | null) => { if (done) return; done = true; sub.remove(); clearTimeout(timer); try { player.release(); } catch { /* already gone */ } resolve(v); };
      const sub = player.addListener('sourceLoad', ({ duration }) => finish(duration > 0 ? duration : null));
      const timer = setTimeout(() => finish(player.duration > 0 ? player.duration : null), 6000);
    });
  } catch {
    return null;
  }
}

/**
 * Shrinks the track on the phone (AAC in an .m4a at 128 kbps: a 10 MB song becomes about 3 MB, which is what makes the music start fast
 * in a post), then sends it. If the phone cannot shrink it, the track goes up as it is.
 */
export async function shrinkTrack(track: PickedTrack): Promise<{ uri: string; mimeType: string | null }> {
  if (track.ready) return { uri: track.uri, mimeType: track.mimeType };
  try {
    const compressor = require('react-native-compressor') as { Audio?: { compress: (uri: string, o: { quality?: 'low' | 'medium' | 'high'; bitrate?: number }) => Promise<string> } };
    if (!compressor.Audio) return { uri: track.uri, mimeType: track.mimeType };
    const out = await compressor.Audio.compress(track.uri, { bitrate: 128000 });
    return out ? { uri: out, mimeType: 'audio/mp4' } : { uri: track.uri, mimeType: track.mimeType };
  } catch {
    return { uri: track.uri, mimeType: track.mimeType };
  }
}

/**
 * Cuts the track down to just the chosen part (a small AAC file of about 30 seconds) with the phone's own audio tool (the AudioTrim module,
 * which is part of build 25 and later). Null when this build does not have the module or the phone cannot do it: the whole track goes up then.
 */
export async function trimTrack(uri: string, startS: number, endS: number): Promise<string | null> {
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
    const mod = requireOptionalNativeModule<{ trim: (uri: string, startS: number, endS: number) => Promise<string> }>('AudioTrim');
    if (!mod) return null;
    return (await mod.trim(uri, startS, endS)) || null;
  } catch {
    return null;
  }
}

/**
 * Sends the track. When it can be cut, ONLY the chosen part goes up and the part to play becomes 0 to its length; otherwise the whole track goes
 * up (shrunk) and the chosen start and end stay as they were.
 */
export async function uploadTrack(track: PickedTrack, companyId: string, onProgress?: (p: number) => void, part?: { startS: number; endS: number }): Promise<{ url: string; key: string; clip: { startS: number; endS: number } | null }> {
  const cut = part ? await trimTrack(track.uri, part.startS, part.endS) : null;
  if (cut && part) {
    const up = await uploadImage(cut, portfolioFolder(companyId, 'music'), 'audio/mp4', onProgress, { raw: true });
    return { ...up, clip: { startS: 0, endS: Math.max(1, part.endS - part.startS) } };
  }
  const small = await shrinkTrack(track);
  const up = await uploadImage(small.uri, portfolioFolder(companyId, 'music'), small.mimeType ?? undefined, onProgress, { raw: true });
  return { ...up, clip: null };
}
