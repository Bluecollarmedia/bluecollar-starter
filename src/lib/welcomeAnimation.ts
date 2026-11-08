/**
 * Tiny shared switch for the sign-in welcome animation.
 * The login screen starts it when Sign In is tapped; the overlay in the root
 * layout plays it and hides itself.
 */
import { useSyncExternalStore } from 'react';

export type WelcomePhase = 'idle' | 'verifying' | 'cancelled';

let phase: WelcomePhase = 'idle';
let startedAt = 0;
const listeners = new Set<() => void>();

function set(next: WelcomePhase) {
  phase = next;
  listeners.forEach((l) => l());
}

/** Show the leaf while the password is being checked. */
export function startWelcome() {
  startedAt = Date.now();
  set('verifying');
}

/** Sign-in failed: fade the leaf away so the error shows. */
export function cancelWelcome() {
  if (phase === 'verifying') set('cancelled');
}

/** Called by the overlay once it has finished (or faded out). */
export function resetWelcome() {
  set('idle');
}

export function welcomeStartedAt() {
  return startedAt;
}

export function useWelcomePhase(): WelcomePhase {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => phase,
    () => phase,
  );
}
