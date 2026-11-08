/**
 * The file formats Our Work accepts (pure: no phone, no network). The rule: every normal, popular format that the phone's own player can actually
 * play, so a visitor on any phone sees and hears it. A format that only some phones can play (WebM, OGG, MKV, AVI, WMA) is turned away with a plain
 * message instead of being accepted and then failing for people later.
 *
 * Pictures are re-saved as high-quality JPEG on the phone before they go up (see data/portfolioUpload.ts), so any picture the phone can open works;
 * the lists here are for naming them and for turning away things that are not pictures at all.
 */

export interface Format { ext: string; contentType: string }

// ── Audio: MP3, M4A (also Apple Lossless), AAC, WAV, AIFF, CAF, FLAC ──
const AUDIO: { exts: string[]; mimes: string[]; format: Format }[] = [
  { exts: ['mp3'], mimes: ['audio/mpeg', 'audio/mp3'], format: { ext: 'mp3', contentType: 'audio/mpeg' } },
  { exts: ['m4a', 'mp4a', 'alac'], mimes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'], format: { ext: 'm4a', contentType: 'audio/mp4' } },
  { exts: ['aac'], mimes: ['audio/aac', 'audio/x-aac'], format: { ext: 'aac', contentType: 'audio/aac' } },
  { exts: ['wav', 'wave'], mimes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'], format: { ext: 'wav', contentType: 'audio/wav' } },
  { exts: ['aif', 'aiff', 'aifc'], mimes: ['audio/aiff', 'audio/x-aiff'], format: { ext: 'aiff', contentType: 'audio/aiff' } },
  { exts: ['caf'], mimes: ['audio/x-caf'], format: { ext: 'caf', contentType: 'audio/x-caf' } },
  { exts: ['flac'], mimes: ['audio/flac', 'audio/x-flac'], format: { ext: 'flac', contentType: 'audio/flac' } },
];
export const AUDIO_HELP = 'MP3, M4A, AAC, WAV, AIFF, CAF or FLAC';

// ── Video: MP4, MOV (iPhone), M4V, 3GP ──
const VIDEO: { exts: string[]; mimes: string[]; format: Format }[] = [
  { exts: ['mp4'], mimes: ['video/mp4'], format: { ext: 'mp4', contentType: 'video/mp4' } },
  { exts: ['mov', 'qt'], mimes: ['video/quicktime'], format: { ext: 'mov', contentType: 'video/quicktime' } },
  { exts: ['m4v'], mimes: ['video/x-m4v', 'video/m4v'], format: { ext: 'm4v', contentType: 'video/x-m4v' } },
  { exts: ['3gp', '3gpp', '3g2'], mimes: ['video/3gpp', 'video/3gpp2'], format: { ext: '3gp', contentType: 'video/3gpp' } },
];
export const VIDEO_HELP = 'MP4, MOV, M4V or 3GP';
/** Video formats that only some phones can play: turned away, with a message, rather than failing for visitors later. */
const VIDEO_REFUSED = ['webm', 'mkv', 'avi', 'flv', 'wmv', 'ogv', 'mpg', 'mpeg', 'ts'];
const AUDIO_REFUSED = ['ogg', 'oga', 'opus', 'wma', 'webm', 'mka', 'amr', 'mid', 'midi'];

// ── Pictures: JPEG, PNG, WebP, HEIC/HEIF, GIF (first frame), BMP, TIFF, AVIF ──
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'jpe', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'tif', 'tiff', 'avif'] as const;
export const IMAGE_HELP = 'JPEG, PNG, WebP, HEIC, GIF, BMP, TIFF or AVIF';

const extOf = (name: string): string => (name.split('?')[0].toLowerCase().split('.').pop() ?? '').trim();
const mimeOf = (mime?: string | null): string => (mime ?? '').toLowerCase().split(';')[0].trim();

function find(list: typeof AUDIO, name: string, mime?: string | null): Format | null {
  const e = extOf(name);
  const m = mimeOf(mime);
  return (list.find((f) => f.exts.includes(e)) ?? list.find((f) => m && f.mimes.includes(m)))?.format ?? null;
}

/** The audio format of a file (by its name, else its type), or null when it is not one Our Work accepts. */
export const audioFormatOf = (name: string, mime?: string | null): Format | null => find(AUDIO, name, mime);

/** The video format of a file, or null. */
export const videoFormatOf = (name: string, mime?: string | null): Format | null => find(VIDEO, name, mime);

/**
 * Can this video be used? Yes for the formats every phone plays. A file whose name and type are not known is allowed (the phone's own library
 * only holds normal videos); one that is clearly a format only some phones play is refused.
 */
export function videoProblem(name: string | null | undefined, mime?: string | null): string | null {
  const e = extOf(name ?? '');
  if (VIDEO_REFUSED.includes(e)) return `${e.toUpperCase()} videos do not play on every phone. Use ${VIDEO_HELP}.`;
  if (videoFormatOf(name ?? '', mime)) return null;
  const m = mimeOf(mime);
  if (!e && !m) return null;
  if (m.startsWith('video/') && !VIDEO_REFUSED.includes(e)) return null;
  return e || m ? `That video format is not supported. Use ${VIDEO_HELP}.` : null;
}

/** Can this audio file be used as music? */
export function audioProblem(name: string, mime?: string | null): string | null {
  if (audioFormatOf(name, mime)) return null;
  const e = extOf(name);
  if (AUDIO_REFUSED.includes(e)) return `${e.toUpperCase()} music does not play on every phone. Use ${AUDIO_HELP}.`;
  return `Choose an audio file (${AUDIO_HELP}).`;
}

/** Can this be used as a picture? (Anything that is plainly not a picture is turned away; everything else is opened and re-saved as JPEG.) */
export function imageProblem(name: string | null | undefined, mime?: string | null): string | null {
  const e = extOf(name ?? '');
  const m = mimeOf(mime);
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(e) || m.startsWith('image/')) return null;
  if (!e && !m) return null;
  return `Choose a picture (${IMAGE_HELP}).`;
}
