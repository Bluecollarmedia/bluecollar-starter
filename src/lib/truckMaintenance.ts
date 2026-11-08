// A truck's Maintenance log: pure helpers (no network, no phone APIs), so the rules are tested on their own.

export const TITLE_MAX = 120;
export const NOTES_MAX = 2000;
/** Titles the owner can tap to fill in the title quickly (they can type anything). */
export const TITLE_SUGGESTIONS = ['Oil change', 'Tires', 'Brakes', 'Inspection', 'Repair'];

const isKey = (v: string | undefined | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Why a record can't be saved yet, or '' when it can. */
export function maintenanceProblem(input: { title: string; servicedOn?: string; dueOn?: string; notes?: string }): string {
  if (!input.title.trim()) return 'Give it a title, like "Oil change".';
  if (input.title.trim().length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  if (!isKey(input.servicedOn)) return 'Pick the date the service was done.';
  if (input.dueOn && !isKey(input.dueOn)) return 'The due date is not a real date.';
  if (input.dueOn && input.dueOn < (input.servicedOn as string)) return "The next service can't be due before the service date.";
  if ((input.notes ?? '').length > NOTES_MAX) return `Keep the notes under ${NOTES_MAX} characters.`;
  return '';
}

export type DueState = 'none' | 'ok' | 'soon' | 'today' | 'overdue';
export const SOON_DAYS = 14;

export interface DueInfo { state: DueState; days?: number; label: string }

const fmt = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** How a due date looks today: overdue, due today, due within two weeks, fine, or no date. `todayKey` is YYYY-MM-DD in the phone's own day. */
export function dueInfo(dueOn: string | undefined | null, todayKey: string): DueInfo {
  if (!isKey(dueOn)) return { state: 'none', label: '' };
  const a = Date.UTC(Number(dueOn.slice(0, 4)), Number(dueOn.slice(5, 7)) - 1, Number(dueOn.slice(8, 10)));
  const b = Date.UTC(Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, Number(todayKey.slice(8, 10)));
  const days = Math.round((a - b) / 86400000);
  if (days < 0) return { state: 'overdue', days, label: `Overdue since ${fmt(dueOn)}` };
  if (days === 0) return { state: 'today', days, label: 'Due today' };
  if (days <= SOON_DAYS) return { state: 'soon', days, label: `Due in ${days} ${days === 1 ? 'day' : 'days'} (${fmt(dueOn)})` };
  return { state: 'ok', days, label: `Due ${fmt(dueOn)}` };
}

export const servicedLabel = (servicedOn: string) => (isKey(servicedOn) ? `Serviced ${fmt(servicedOn)}` : '');

/** When the reminder fires: 8:00 in the morning, in the phone's own time zone, on the due date. */
export function reminderTime(dueOn: string): Date {
  return new Date(Number(dueOn.slice(0, 4)), Number(dueOn.slice(5, 7)) - 1, Number(dueOn.slice(8, 10)), 8, 0, 0, 0);
}

export interface ReminderSource { id: string; truckId: string; truckName: string; title: string; dueOn?: string | null }

/**
 * Which records get a reminder: those with a due date whose reminder time has not passed yet. Soonest first, at most `limit`
 * (phones keep only a limited number of scheduled notifications; the later ones are scheduled the next time the app opens).
 */
export function remindersToSchedule(records: ReminderSource[], now: Date, limit = 40): (ReminderSource & { at: Date })[] {
  return records
    .filter((r) => isKey(r.dueOn))
    .map((r) => ({ ...r, at: reminderTime(r.dueOn as string) }))
    .filter((r) => r.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, limit);
}
