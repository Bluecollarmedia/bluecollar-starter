import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadMySnowProperties } from '@/data/snowNotifications';

export interface MySnowProperty { id: string; name: string; address: string }

// The last list that loaded, kept for the rest of the session: a screen that opens after Home shows it at once instead of waiting.
let remembered: MySnowProperty[] | null = null;

/**
 * The Snow properties linked to the signed-in customer. Empty while loading and if the check
 * fails, so a customer who is not enrolled never sees Snow. Re-checked every time the screen
 * comes into view.
 */
export function useMySnowProperties(): MySnowProperty[] {
  return useMySnowPropertyList().list;
}

/** Same list, plus whether it has loaded yet, so a screen can tell "still loading" from "they really have none". */
export function useMySnowPropertyList(): { list: MySnowProperty[]; loaded: boolean } {
  const [state, setState] = useState<{ list: MySnowProperty[]; loaded: boolean }>({ list: remembered ?? [], loaded: remembered !== null });
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadMySnowProperties().then((res) => {
        if (!alive) return;
        const list = res.ok ? res.data : [];
        if (res.ok) remembered = list;
        setState({ list, loaded: true });
      });
      return () => { alive = false; };
    }, []),
  );
  return state;
}

/**
 * Does the signed-in customer have at least one Snow property linked to their
 * account? False while loading and if the check fails, so a landscaping-only
 * customer never sees a Snow section. Re-checked every time the screen comes
 * into view, so a property the owner has just linked shows up without signing out.
 */
export function useHasSnow(): boolean {
  const [has, setHas] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadMySnowProperties().then((res) => {
        if (alive) setHas(res.ok && res.data.length > 0);
      });
      return () => { alive = false; };
    }, []),
  );
  return has;
}
