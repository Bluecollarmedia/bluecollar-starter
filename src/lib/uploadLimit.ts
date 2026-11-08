// The biggest single file (photo or video) the owner lets people upload. Pure, no network.

/** The upload service itself never accepts more than this. */
export const SERVER_MAX_FILE_MB = 200;
/** What the owner sees as quick choices. */
export const MAX_FILE_PRESETS_MB = [5, 10, 25, 50, 100, 200] as const;

const MB = 1024 * 1024;

/** The limit in effect: what the owner saved, kept within 1 MB and what the server accepts; else the server maximum. */
export function effectiveMaxFileMb(saved?: number | null): number {
  if (saved == null || !Number.isFinite(saved) || saved <= 0) return SERVER_MAX_FILE_MB;
  return Math.min(SERVER_MAX_FILE_MB, Math.max(1, Math.floor(saved)));
}

export const maxFileBytes = (savedMb?: number | null) => effectiveMaxFileMb(savedMb) * MB;

/** Whether typed text is an allowed limit (a whole number of MB from 1 to the server maximum). */
export function parseMaxFileMb(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= SERVER_MAX_FILE_MB ? n : null;
}

/** "25 MB". */
export const mbLabel = (mb: number) => `${mb} MB`;

/** The sentence shown when a file is over the limit; null when it fits (or its size is unknown). */
export function tooLargeMessage(sizeBytes: number | undefined, savedMb?: number | null): string | null {
  if (!sizeBytes || sizeBytes <= maxFileBytes(savedMb)) return null;
  const size = sizeBytes / MB;
  return `This file is ${size >= 10 ? Math.round(size) : size.toFixed(1)} MB, and the largest file allowed is ${effectiveMaxFileMb(savedMb)} MB. Pick a smaller file, or ask the owner to raise the limit in More → Storage.`;
}
