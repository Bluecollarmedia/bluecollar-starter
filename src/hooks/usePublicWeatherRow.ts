import { useCallback, useEffect, useState } from 'react';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { readPublicWeatherSetting, setPublicWeatherEnabled } from '@/data/publicWeather';
import { db } from '@/data/store';

/**
 * The owner's "Public weather" row in Settings. Only the company OWNER sees it (an admin does not, and the database refuses an admin too).
 * Turning it on asks first, because it changes what every signed-out visitor sees when they open the app.
 */
export function usePublicWeatherRow() {
  const canChange = db.role === 'owner';
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (canChange) readPublicWeatherSetting().then(setEnabled); }, [canChange]);

  const change = useCallback(async (next: boolean) => {
    setBusy(true);
    const r = await setPublicWeatherEnabled(next);
    setBusy(false);
    if (!r.ok) { showMessage("Couldn't change Brighton Weather", r.error); return; }
    setEnabled(next);
  }, []);

  const confirm = useCallback(() => {
    if (!canChange || busy || enabled === null) return;
    if (enabled) {
      confirmAction('Turn off Brighton Weather?', 'Visitors who are not signed in will see the usual welcome and sign-in screen again, and shared storm links stop showing storm updates.', 'Turn off', () => change(false));
    } else {
      confirmAction('Turn on Brighton Weather?', 'Anyone who opens the app without being signed in will see Brighton Weather (local forecasts) instead of the welcome screen, with a Sign In button. People who are signed in are not affected.', 'Turn on', () => change(true));
    }
  }, [canChange, busy, enabled, change]);

  return {
    canChange,
    title: 'Public weather',
    subtitle: 'Show local weather to people who are not signed in',
    value: enabled === null ? '…' : enabled ? 'On' : 'Off',
    confirm,
  };
}
