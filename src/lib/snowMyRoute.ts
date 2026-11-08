/**
 * Which of a worker's routes are current work and which are past work.
 * Only a route on a dispatched storm that hasn't been cancelled is current;
 * everything else (ended storms) is history. A draft or cancelled route is
 * never offered to the worker at all.
 */

export interface RouteLike {
  id: string;
  stormStatus: 'draft' | 'dispatched' | 'ended';
}

export function splitMyRoutes<T extends RouteLike>(routes: T[]): { active: T[]; history: T[] } {
  return {
    active: routes.filter((r) => r.stormStatus === 'dispatched'),
    history: routes.filter((r) => r.stormStatus === 'ended'),
  };
}

/** The route to show as current: the one already chosen if it is still active, else the first active one, else none. */
export function pickActiveRoute<T extends RouteLike>(active: T[], chosenId: string | null): string | null {
  if (chosenId && active.some((r) => r.id === chosenId)) return chosenId;
  return active[0]?.id ?? null;
}
