// A safety net for errors nobody caught. Without it, one uncaught error closes the whole app instantly and
// leaves no trace of what went wrong (a TestFlight crash report shows no message). With it, the person sees a
// short note with the real error text, the app stays open, and the text can be sent to us.
import { Alert, Platform } from 'react-native';

export const ERROR_ALERT_COOLDOWN_MS = 15000;

/** A short, readable description of whatever was thrown. */
export function describeError(error: unknown): { message: string; where: string } {
  const e = error as { message?: unknown; stack?: unknown } | string | null | undefined;
  const message = typeof e === 'string' ? e : typeof e?.message === 'string' && e.message ? e.message : 'Unknown error';
  const stack = typeof e === 'object' && e && typeof e.stack === 'string' ? e.stack : '';
  // First couple of stack lines that name a place; the rest is noise for a person.
  const where = stack.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith(message)).slice(0, 3).join('\n');
  return { message: message.slice(0, 300), where: where.slice(0, 400) };
}

let installed = false;
let lastShown = 0;
let ours: ((e: unknown, fatal?: boolean) => void) | null = null;

const LAST_ERROR_KEY = 'lastFatalError.v1';
const storage = (): { setItem: (k: string, v: string) => Promise<void>; getItem: (k: string) => Promise<string | null>; removeItem: (k: string) => Promise<void> } | null => {
  try { return require('@react-native-async-storage/async-storage').default; } catch { return null; }
};

/** Keeps the text of the last uncaught error, so that if the app still closes, the next launch can say why. */
function rememberError(text: string): void {
  try { void storage()?.setItem(LAST_ERROR_KEY, `${new Date().toISOString()}
${text}`).catch(() => {}); } catch { /* nothing to do */ }
}

const LAST_STEP_KEY = 'lastStep.v1';
const STEP_TTL_MS = 8000;
let stepTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A breadcrumb for crashes the safety net cannot catch (native ones): written just before a risky step, and wiped a few seconds later if the
 * app is still alive. If the app dies in between, the next launch can say what it was doing.
 */
export function markStep(name: string): void {
  try {
    const s = storage();
    if (!s) return;
    if (stepTimer) clearTimeout(stepTimer);
    void s.setItem(LAST_STEP_KEY, `${new Date().toISOString()} ${name}`).catch(() => {});
    stepTimer = setTimeout(() => { void s.removeItem(LAST_STEP_KEY).catch(() => {}); }, STEP_TTL_MS);
  } catch { /* nothing to do */ }
}

/** On launch: if the last run ended on an uncaught error (or died right after a marked step), say so once (then forget it). */
export async function showLastErrorIfAny(): Promise<void> {
  try {
    const s = storage();
    const text = await s?.getItem(LAST_ERROR_KEY);
    const step = await s?.getItem(LAST_STEP_KEY);
    if (text) await s?.removeItem(LAST_ERROR_KEY);
    if (step) await s?.removeItem(LAST_STEP_KEY);
    if (Platform.OS === 'web') return;
    if (text) Alert.alert('The app hit a problem last time', `${text.slice(0, 700)}

Please screenshot this and send it to support.`);
    else if (step) Alert.alert('The app closed last time', `It closed right after: ${step.slice(0, 300)}

Please screenshot this and send it to support.`);
  } catch { /* never block launch */ }
}

/** Puts the safety net back if another library replaced it after launch. Cheap; safe to call more than once. */
export function ensureGlobalErrorHandler(): void {
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler?: () => unknown; setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (!ours || !utils?.setGlobalHandler || utils.getGlobalHandler?.() === ours) return;
  const replacement = utils.getGlobalHandler?.() as ((e: unknown, fatal?: boolean) => void) | undefined;
  const mine = ours;
  const wrapped = (error: unknown, isFatal?: boolean) => { if (isFatal) mine(error, isFatal); else replacement?.(error, isFatal); };
  utils.setGlobalHandler(wrapped);
}

export function installGlobalErrorHandler(now: () => number = Date.now): void {
  const utils = (globalThis as { ErrorUtils?: { getGlobalHandler?: () => unknown; setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (installed || !utils?.setGlobalHandler) return;
  installed = true;
  const previous = utils.getGlobalHandler?.() as ((e: unknown, fatal?: boolean) => void) | undefined;
  ours = (error, isFatal) => {
    if (!isFatal) { previous?.(error, isFatal); return; }
    const { message, where } = describeError(error);
    console.warn('[error] caught instead of crashing:', message, where);
    rememberError(`${message}${where ? `
${where}` : ''}`);
    if (now() - lastShown < ERROR_ALERT_COOLDOWN_MS) return;
    lastShown = now();
    const text = `${message}${where ? `\n\n${where}` : ''}\n\nTell support what you were doing. You can keep using the app; if something looks wrong, close and reopen it.`;
    if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`Something went wrong\n\n${text}`);
    else Alert.alert('Something went wrong', text);
  };
  utils.setGlobalHandler(ours);
}

/** For tests. */
export function _resetErrorHandlerForTests() { installed = false; lastShown = 0; ours = null; }
