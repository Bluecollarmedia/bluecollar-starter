// Wording and small helpers for deleting a storm for good (Snow More -> Manage storms). Pure, no network.

export interface StormCounts { routes: number; stops: number; completedStops: number; media: number }

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What the person is about to lose, in plain words, from the real counts. */
export function whatWillGo(c: StormCounts): string {
  if (c.routes === 0 && c.stops === 0) return 'It has no routes or stops.';
  const parts = [n(c.routes, 'route'), n(c.stops, 'stop')];
  const tail = c.completedStops > 0 ? ` (${c.completedStops} completed)` : '';
  const media = c.media > 0 ? `, and the records of ${n(c.media, 'completion photo or video', 'completion photos and videos')}` : '';
  return `It has ${parts.join(' and ')}${tail}${media}.`;
}

export function deleteConfirmation(name: string, status: string, c: StormCounts): { title: string; message: string; confirm: string } {
  const worked = c.completedStops > 0 || c.media > 0;
  const state = status === 'draft' ? 'a storm plan that was never dispatched' : status === 'ended' ? 'an ended storm' : 'a storm that is still active';
  return {
    title: `Delete ${name} for good?`,
    message: `${name} is ${state}. ${whatWillGo(c)}${worked ? ' Customers can no longer see photos from it.' : ''} Hours people clocked stay, and the Activity log keeps a note that it was deleted. This can't be undone.`,
    confirm: 'Delete storm',
  };
}

/** Message for a database that hasn't had update 50 yet. */
export const NEEDS_UPDATE_50 = 'Deleting a storm that has already been dispatched needs database update 50, which has not been installed yet.';

/** The database says the function isn't there. */
export const isMissingFunction = (msg: string | undefined) => /could not find the function|schema cache/i.test(msg ?? '');
