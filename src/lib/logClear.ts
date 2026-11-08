// Clearing an activity log (Snow Activity, and a project's Activity Log): which period, what it does, what we ask. Pure, no network.

export type ClearScope =
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'older30' }
  | { kind: 'year'; year: number }
  | { kind: 'all' };

/** archive = move to history (kept, hidden); restore = bring back from history; delete = gone for good. */
export type ClearMode = 'archive' | 'restore' | 'delete';

export interface ClearRange { from: string | null; to: string | null }

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The time range a scope covers: [from, to). A null end is open. Uses the phone's own days. */
export function scopeRange(scope: ClearScope, now: Date = new Date()): ClearRange {
  const today = startOfDay(now);
  switch (scope.kind) {
    case 'today': return { from: today.toISOString(), to: addDays(today, 1).toISOString() };
    case 'yesterday': return { from: addDays(today, -1).toISOString(), to: today.toISOString() };
    case 'older30': return { from: null, to: addDays(today, -30).toISOString() };
    case 'year': return { from: new Date(scope.year, 0, 1).toISOString(), to: new Date(scope.year + 1, 0, 1).toISOString() };
    case 'all': return { from: null, to: null };
  }
}

export function scopeLabel(scope: ClearScope): string {
  switch (scope.kind) {
    case 'today': return 'Today';
    case 'yesterday': return 'Yesterday';
    case 'older30': return 'Older than 30 days';
    case 'year': return `All of ${scope.year}`;
    case 'all': return 'All time';
  }
}

/** The choices to offer: the simple ones, then one per year that actually has entries. */
export function scopeChoices(years: number[], now: Date = new Date()): ClearScope[] {
  const out: ClearScope[] = [{ kind: 'today' }, { kind: 'yesterday' }, { kind: 'older30' }];
  for (const y of [...new Set(years)].sort((a, b) => b - a)) out.push({ kind: 'year', year: y });
  out.push({ kind: 'all' });
  return out;
}

export const MODE_LABEL: Record<ClearMode, string> = {
  archive: 'Move to history',
  restore: 'Restore',
  delete: 'Delete for good',
};

export const MODE_HELP: Record<ClearMode, string> = {
  archive: 'Hides them from the log but keeps them. You can look at them or restore them any time under Archived.',
  restore: 'Puts them back in the normal log.',
  delete: 'Removes them for good. This can\'t be undone.',
};

const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** The question asked before anything changes, with the real count. */
export function clearConfirmation(scope: ClearScope, mode: ClearMode, count: number, what = 'log'): { title: string; message: string; confirm: string } | { nothing: string } {
  if (count === 0) {
    return { nothing: mode === 'restore' ? `Nothing archived for ${scopeLabel(scope).toLowerCase()}.` : `No entries for ${scopeLabel(scope).toLowerCase()}.` };
  }
  const when = scopeLabel(scope).toLowerCase();
  if (mode === 'archive') {
    return { title: `Move ${entries(count)} to history?`, message: `${scopeLabel(scope)}: ${entries(count)} will leave the ${what} but stay saved under Archived. A short note is added to the ${what}.`, confirm: 'Move to history' };
  }
  if (mode === 'restore') {
    return { title: `Restore ${entries(count)}?`, message: `${scopeLabel(scope)}: ${entries(count)} will go back into the ${what}.`, confirm: 'Restore' };
  }
  return {
    title: `Delete ${entries(count)} for good?`,
    message: `${scopeLabel(scope)} (${when}): ${entries(count)} will be removed from the ${what} permanently. This can't be undone.${what === 'log' ? ' A short note that you cleared it stays.' : ''}`,
    confirm: 'Delete for good',
  };
}

/** Message for a database that hasn't had update 51 yet. */
export const NEEDS_UPDATE_51 = 'Clearing the log needs database update 51, which has not been installed yet.';
export const isMissingFunction = (msg: string | undefined) => /could not find the function|schema cache/i.test(msg ?? '');
