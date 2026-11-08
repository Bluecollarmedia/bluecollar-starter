// Pure helpers for the extras someone fills in while creating an account (profile photo, birthday, hoodie size, ID photo).
// When the account needs email confirmation there is no sign-in yet, so these are kept on the phone and saved the first time the
// person is signed in. No storage or network here.
import type { HoodieSize } from '@/lib/workerDetails';

export interface PendingSignup {
  email: string;
  photoUri?: string | null;
  birthdayIso?: string | null;
  hoodieSize?: HoodieSize | null;
  idUri?: string | null;
}

export const pendingKey = (email: string) => `pending-signup:${email.trim().toLowerCase()}`;

/** True when there is anything to save. */
export function hasPending(p: Partial<PendingSignup> | null | undefined): boolean {
  return !!p && !!(p.photoUri || p.birthdayIso || p.hoodieSize || p.idUri);
}

export type PendingPart = 'photo' | 'birthday' | 'details';

/** What is left to save after some parts worked: only the parts that did not succeed stay, so they are tried again next time. */
export function remainingAfter(p: PendingSignup, saved: PendingPart[]): PendingSignup | null {
  const left: PendingSignup = {
    email: p.email,
    photoUri: saved.includes('photo') ? null : p.photoUri,
    birthdayIso: saved.includes('birthday') ? null : p.birthdayIso,
    hoodieSize: saved.includes('details') ? null : p.hoodieSize,
    idUri: saved.includes('details') ? null : p.idUri,
  };
  return hasPending(left) ? left : null;
}
