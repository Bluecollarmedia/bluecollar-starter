import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * True while the app is in front. Swiping up to the app switcher, locking the phone or opening another app makes it false, so video and music
 * can PAUSE where they are (not be torn down) and carry on from the same spot when the person comes back.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}
