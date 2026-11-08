/**
 * Sends one local file to a short-lived upload link (an HTTP PUT), the way each platform does it best.
 *
 * On a PHONE the file goes up through the operating system's own file upload (expo-file-system: the file is streamed straight from
 * disk by the native networking layer). It never goes through JavaScript's fetch + Blob, which is the unreliable part on a phone: a
 * Blob made from a file address can arrive empty or never send, with a vague "network request failed". On the WEB the browser's
 * fetch with a Blob is the right tool and is what already works there.
 *
 * Returns what the storage server answered, so the caller can show its real reason. Never throws for an HTTP answer; throws only
 * when the request could not be made at all (and says what failed).
 */
import { Platform } from 'react-native';
import { withTimeout } from './mediaQueue';

export interface PutResult { status: number; body: string }

/** Waits between tries (so a dropped connection is tried up to three times in all). */
const RETRY_DELAYS_MS = [800, 2500];
/** A connection that dropped or never connected, as the phone words it. */
export function isDroppedConnection(message: string): boolean {
  return /network connection was lost|network request failed|connection (was )?(lost|reset|closed|aborted)|not connected to the internet|could not connect|offline|socket|econn|fetch failed/i.test(message);
}
/** A hiccup on the storage server's side (never a refusal like 400/403). */
export function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export async function putFile(localUri: string, url: string, contentType: string, timeoutMs: number, onProgress?: (p: number) => void): Promise<PutResult> {
  if (Platform.OS === 'web') {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), timeoutMs);
    try {
      const blob = await (await fetch(localUri)).blob();
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob, signal: stop.signal });
      return { status: res.status, body: await res.text().catch(() => '') };
    } catch (err) {
      throw new Error(stop.signal.aborted ? `Sending the file timed out after ${Math.round(timeoutMs / 1000)} seconds` : `Sending the file failed (${err instanceof Error ? err.message : String(err)})`);
    } finally {
      clearTimeout(timer);
    }
  }

  // The LEGACY file API, on purpose: on some phones the new File API cannot read files the photo picker hands over (.exists says
  // false on a file that is right there), which showed up as "the file is gone" on perfectly good photos.
  const legacy = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  try {
    const info = await legacy.getInfoAsync(localUri);
    if (!info.exists) throw new Error('the file is gone');
  } catch (err) {
    throw new Error(`The phone could not read the file (${err instanceof Error ? err.message : String(err)}) ...${localUri.slice(-48)}`);
  }
  // A phone's connection drops for a moment all the time (walking between wifi and cellular, a tunnel, a weak signal): "the network
  // connection was lost". That is not a reason to lose a photo, so a dropped connection or a server hiccup is tried again, with a fresh
  // upload each time, before giving up. A timeout or a refusal from the server (4xx) is never repeated.
  let lastError = 'unknown';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    const task = legacy.createUploadTask(url, localUri, {
      httpMethod: 'PUT',
      headers: { 'Content-Type': contentType },
      uploadType: legacy.FileSystemUploadType.BINARY_CONTENT,
    }, (sent) => {
      if (onProgress && sent.totalBytesExpectedToSend > 0) onProgress(sent.totalBytesSent / sent.totalBytesExpectedToSend);
    });
    try {
      const res = await withTimeout(task.uploadAsync(), timeoutMs, () => {
        void task.cancelAsync().catch(() => undefined);
        return new Error(`Sending the file timed out after ${Math.round(timeoutMs / 1000)} seconds`);
      });
      if (!res) { lastError = 'the upload was cancelled'; continue; }
      if (shouldRetryStatus(res.status) && attempt < RETRY_DELAYS_MS.length) { lastError = `the server answered ${res.status}`; continue; }
      return { status: res.status, body: res.body ?? '' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timed out/.test(msg)) throw new Error(msg);
      lastError = msg;
      if (!isDroppedConnection(msg) || attempt >= RETRY_DELAYS_MS.length) throw new Error(`Sending the file failed (${msg})`);
    }
  }
  throw new Error(`Sending the file failed (${lastError})`);
}

/** The size of a local file in bytes, or undefined when it cannot be read. Phone: from disk; web: from the Blob. */
export async function localFileSize(localUri: string): Promise<number | undefined> {
  try {
    if (Platform.OS === 'web') return (await (await fetch(localUri)).blob()).size;
    {
      const legacy = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
      const info = await legacy.getInfoAsync(localUri);
      if (info.exists && typeof info.size === 'number') return info.size;
    }
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    return new File(localUri).size ?? undefined;
  } catch {
    return undefined;
  }
}
