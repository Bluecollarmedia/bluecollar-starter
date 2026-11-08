import { useCallback, useEffect, useRef } from 'react';
import { useNavigation, useRouter } from 'expo-router';

/**
 * A screen that shows a view inside itself (a section of a project, a history list) is not a separate page, so the phone's back swipe would
 * leave the whole screen and land far away (the dashboard). While such a view is open, the back swipe steps back INSIDE the screen instead.
 * Only a back gesture / back button is caught: replacing or resetting the screen (signing out, switching area) is never blocked.
 *
 * Returns `leave`: for the screen's own arrow, which really does leave the screen.
 */
export function useBackStep(active: boolean, stepBack: () => void): { leave: () => void } {
  const navigation = useNavigation();
  const router = useRouter();
  const activeRef = useRef(active);
  const stepRef = useRef(stepBack);
  const leaving = useRef(false);
  activeRef.current = active;
  stepRef.current = stepBack;

  useEffect(() => navigation.addListener('beforeRemove', (e: any) => {
    const type = e?.data?.action?.type;
    if (leaving.current || !activeRef.current) return;
    if (type !== 'POP' && type !== 'GO_BACK') return;
    e.preventDefault();
    stepRef.current();
  }), [navigation]);

  const leave = useCallback(() => { leaving.current = true; router.back(); }, [router]);
  return { leave };
}
