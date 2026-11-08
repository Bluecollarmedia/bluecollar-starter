/**
 * An ADMIN who is on a Snow route (leading it or on its crew) works it from the worker Snow screens (Route, Time Clock). The app keeps
 * people in the area that matches their role, so this remembers, for this session, that the admin chose to open their route and may stay
 * in the worker Snow area until they go back. Nothing here changes what anyone is allowed to do in the database.
 */
import { useSyncExternalStore } from 'react';

let on = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setAdminWorksSnow(next: boolean) {
  if (on === next) return;
  on = next;
  emit();
}

export const adminWorksSnow = () => on;

export function useAdminWorksSnow(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => on, () => false);
}
