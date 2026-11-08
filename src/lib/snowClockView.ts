// Pure helpers for the Snow worker's Clock In screen (the full-screen gate before the Route screen).

export type ClockGateState = 'loading' | 'route' | 'ready' | 'none';

/**
 * Which screen the Route tab shows. Clocked in -> the real Route screen. Not clocked in but allowed to (on a route in a dispatched
 * storm) -> the full-screen Clock In. Not allowed -> "No active storm assignment". The answer always comes from the database's clock,
 * never from a screen's own memory.
 */
export function clockGateState(input: { loading: boolean; clockedIn: boolean; allowed: boolean }): ClockGateState {
  if (input.loading) return 'loading';
  if (input.clockedIn) return 'route';
  return input.allowed ? 'ready' : 'none';
}

/**
 * A plain sentence for a failed clock-in. Never shows technical text (stack traces, database words) to the worker.
 */
export function clockInErrorText(raw: unknown): string {
  const text = (raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '').toLowerCase();
  if (/network|failed to fetch|timeout|timed out|offline|connection|econn/.test(text)) return "Couldn't clock in. Check your connection and try again.";
  if (/not allowed|not on a|no active|assignment|dispatched|route/.test(text)) return "Couldn't clock in. You're not on a dispatched route right now.";
  return "Couldn't clock in. Please try again.";
}

/** "Oct 21 Plowing · North Route". Either part can be missing; a long name is left for the screen to shorten. */
export function stormRouteLine(stormName: string | undefined, routeName: string | undefined): string {
  return [stormName?.trim(), routeName?.trim()].filter(Boolean).join(' · ');
}
