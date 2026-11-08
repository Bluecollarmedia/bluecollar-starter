// Pure helpers for the Snow worker's Route screen: the header line, the progress numbers, how an address is split for the Next Stop card,
// and the words shown for each stop. No network, no screens.

export type StopState = 'pending' | 'arrived' | 'completed' | 'skipped';

/** "Main Route · Plowing" (or "Plowing + Salting"). The storm's name is not repeated here. */
export function routeHeaderLine(routeName: string, serviceLabels: string[]): string {
  const services = serviceLabels.filter(Boolean).join(' + ');
  return [routeName.trim(), services].filter(Boolean).join(' · ');
}

export interface RouteProgress { completed: number; skipped: number; total: number; percent: number; text: string }

/** Stops completed out of all stops. A skipped stop is not "completed", but it is finished with, so the bar moves for it too. */
export function routeProgress(states: StopState[]): RouteProgress {
  const total = states.length;
  const completed = states.filter((s) => s === 'completed').length;
  const skipped = states.filter((s) => s === 'skipped').length;
  const percent = total ? Math.round(((completed + skipped) / total) * 100) : 0;
  const base = `${completed} of ${total} ${total === 1 ? 'stop' : 'stops'} completed`;
  return { completed, skipped, total, percent, text: skipped ? `${base} · ${skipped} skipped` : base };
}

/**
 * The Next Stop card shows the property name big, then the street, then "City, ST 12345" smaller. A stop's address is stored as one line
 * ("205 Cathy Ln, Lakewood, NJ 08701"). When the property's name is just its street, the street is not shown twice.
 */
export function splitAddress(name: string, address: string): { street?: string; place?: string } {
  const parts = (address ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  const street = parts[0];
  const place = parts.slice(1).join(', ') || undefined;
  const sameAsName = street.toLowerCase() === (name ?? '').trim().toLowerCase();
  return { street: sameAsName ? undefined : street, place };
}

/** The big blue button: "I'm Here" until the arrival is saved, then "Complete Stop". */
export const primaryActionFor = (state: StopState): 'arrive' | 'complete' | null =>
  state === 'pending' ? 'arrive' : state === 'arrived' ? 'complete' : null;

/** The word beside each row in All Stops. */
export function stopStatusWord(state: StopState, isCurrent: boolean): 'Completed' | 'Arrived' | 'Skipped' | 'Next' | 'Upcoming' {
  if (state === 'completed') return 'Completed';
  if (state === 'skipped') return 'Skipped';
  if (state === 'arrived') return 'Arrived';
  return isCurrent ? 'Next' : 'Upcoming';
}

/** The small status at the top right of the Next Stop card. */
export const cardStatusWord = (state: StopState): 'NOT STARTED' | 'ARRIVED' | 'COMPLETED' | 'SKIPPED' =>
  state === 'pending' ? 'NOT STARTED' : state === 'arrived' ? 'ARRIVED' : state === 'completed' ? 'COMPLETED' : 'SKIPPED';
