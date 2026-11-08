/**
 * Video file formats by name or type (pure: no phone, no network): which content type a stored video file gets.
 * Every normal, popular format that the phone's own player can play is listed.
 */

export interface Format { ext: string; contentType: string }

// ── Video: MP4, MOV (iPhone), M4V, 3GP ──
const VIDEO: { exts: string[]; mimes: string[]; format: Format }[] = [
  { exts: ['mp4'], mimes: ['video/mp4'], format: { ext: 'mp4', contentType: 'video/mp4' } },
  { exts: ['mov', 'qt'], mimes: ['video/quicktime'], format: { ext: 'mov', contentType: 'video/quicktime' } },
  { exts: ['m4v'], mimes: ['video/x-m4v', 'video/m4v'], format: { ext: 'm4v', contentType: 'video/x-m4v' } },
  { exts: ['3gp', '3gpp', '3g2'], mimes: ['video/3gpp', 'video/3gpp2'], format: { ext: '3gp', contentType: 'video/3gpp' } },
];

const extOf = (name: string): string => (name.split('?')[0].toLowerCase().split('.').pop() ?? '').trim();
const mimeOf = (mime?: string | null): string => (mime ?? '').toLowerCase().split(';')[0].trim();

function find(list: typeof VIDEO, name: string, mime?: string | null): Format | null {
  const e = extOf(name);
  const m = mimeOf(mime);
  return (list.find((f) => f.exts.includes(e)) ?? list.find((f) => m && f.mimes.includes(m)))?.format ?? null;
}

/** The video format of a file, or null. */
export const videoFormatOf = (name: string, mime?: string | null): Format | null => find(VIDEO, name, mime);

