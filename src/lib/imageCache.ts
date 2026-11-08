/**
 * The pictures worth keeping on the phone so screens open instantly and cost
 * no repeat downloads: everyone's profile pictures, the owner's dashboard
 * header, the workers' home header, and each project's cover photo. Big
 * galleries (job photos, Snow media) are NOT here; they load when opened.
 */

import { useEffect, useRef } from 'react';
import { Image } from 'expo-image';
import { db, useDb } from '@/data/store';

/** Every remote image URL on the keep-on-phone list (deduped, https only). */
export function keyImageUrls(): string[] {
  const urls = new Set<string>();
  const add = (u?: string | null) => {
    if (u && /^https?:\/\//i.test(u)) urls.add(u);
  };
  for (const person of Object.values(db.people)) add(person.avatarUrl);
  add(db.company?.coverPhotoUrl);
  add(db.company?.workerCoverPhotoUrl);
  for (const project of db.projects) add(project.coverPhotoUrl);
  return [...urls];
}

/** Downloads any key images not seen yet into the disk cache (once each). */
export function usePrefetchKeyImages(): void {
  const version = useDb();
  const done = useRef(new Set<string>());
  useEffect(() => {
    const fresh = keyImageUrls().filter((u) => !done.current.has(u));
    if (fresh.length === 0) return;
    fresh.forEach((u) => done.current.add(u));
    Image.prefetch(fresh, 'memory-disk').catch(() => {
      fresh.forEach((u) => done.current.delete(u));
    });
  }, [version]);
}
