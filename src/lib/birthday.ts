// Birthday helpers for the optional profile field. Pure functions, no network.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

function validDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

/** Turns what the person typed (MM/DD/YYYY, M-D-YYYY or YYYY-MM-DD) into YYYY-MM-DD, or null when it is not a real date. */
export function parseBirthday(text: string): string | null {
  const t = (text ?? '').trim();
  let m = t.match(/^(\d{1,2})[\/.\-\s](\d{1,2})[\/.\-\s](\d{4})$/);
  let y: number, mo: number, d: number;
  if (m) { mo = Number(m[1]); d = Number(m[2]); y = Number(m[3]); }
  else {
    m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  }
  if (!validDate(y, mo, d) || y < 1900) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Problem with a typed birthday, or '' when it is fine. Empty is fine: the field is optional. */
export function birthdayProblem(text: string, today: Date = new Date()): string {
  if (!(text ?? '').trim()) return '';
  const iso = parseBirthday(text);
  if (!iso) return 'Use the form MM/DD/YYYY, like 04/23/1990';
  const t = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (iso > t) return 'That date is in the future';
  return '';
}

/** What the edit box shows for a saved birthday: MM/DD/YYYY. */
export function birthdayInputText(iso?: string | null): string {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

/** Friendly display, like "Apr 23, 1990". */
export function formatBirthday(iso?: string | null): string {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Whole days until the next birthday (0 = today). Feb 29 birthdays are counted on Feb 28 in non-leap years. */
export function daysUntilBirthday(iso: string, today: Date = new Date()): number | null {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const mo = Number(m[2]); const d = Number(m[3]);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = (year: number) => {
    const leap = new Date(Date.UTC(year, 2, 0)).getUTCDate() === 29;
    return Date.UTC(year, mo - 1, mo === 2 && d === 29 && !leap ? 28 : d);
  };
  let t = target(today.getFullYear());
  if (t < start) t = target(today.getFullYear() + 1);
  return Math.round((t - start) / 86400000);
}

/** Short note for the owner: "Birthday today", "Birthday in 5 days", or '' when it is not close. */
export function birthdaySoon(iso: string, today: Date = new Date(), withinDays = 14): string {
  const n = daysUntilBirthday(iso, today);
  if (n === null || n > withinDays) return '';
  if (n === 0) return 'Birthday today';
  if (n === 1) return 'Birthday tomorrow';
  return `Birthday in ${n} days`;
}
