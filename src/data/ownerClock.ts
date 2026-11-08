/**
 * The owner clocks a worker in or out by hand (a forgotten clock-in, a dead phone, sending someone home). This uses the owner's EXISTING,
 * audited time functions (update 64): time_staff_add_workday starts a day, time_staff_edit_workday closes one. Both need a reason, are
 * written to the time history, refuse the same unsafe things the worker's own clock refuses (a running property timer or break, an
 * overlapping day), and never touch an approved or flagged day. Nothing new in the database.
 */
import { addWorkday, editWorkday, type Result } from '@/data/timeTracking';
import { todayKey } from '@/lib/ids';

/** The database's raw refusals, said plainly. Its own readable messages are passed through. */
export function plainClockError(message: string): string {
  if (/uq_time_workday_open|duplicate key/i.test(message)) return 'They are already clocked in.';
  if (/overlaps another workday/i.test(message)) return 'They are already clocked in, or that overlaps another day. Check their last day first.';
  return message;
}

async function plain(r: Result): Promise<Result> {
  return r.ok ? r : { ...r, error: plainClockError(r.error) };
}

/** Starts a workday for the person right now. */
export const ownerClockIn = (personId: string, reason: string): Promise<Result> =>
  addWorkday(personId, todayKey(), new Date(), null, reason).then(plain);

/** Ends the person's running workday right now. */
export const ownerClockOut = (workdayId: string, reason: string): Promise<Result> =>
  editWorkday(workdayId, null, new Date(), reason).then(plain);
