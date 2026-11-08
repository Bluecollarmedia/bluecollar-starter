/**
 * The version shown in Settings: the app's real version from the app config (app.json "version"), never a typed copy.
 * When the app is running an over-the-air update, a short form of it is added ("1.2.0 · update 3f9c2a1b (production)"),
 * so it is easy to tell which update a phone has.
 */
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export function appVersionText(): string {
  const version = Constants.expoConfig?.version ?? '';
  let update = '';
  try {
    if (Updates.isEnabled && !Updates.isEmbeddedLaunch && Updates.updateId) {
      update = ` · update ${Updates.updateId.slice(0, 8)}${Updates.channel ? ` (${Updates.channel})` : ''}`;
    }
  } catch { /* expo-updates is not available here (web, Expo Go): just the version */ }
  return (version || '—') + update;
}
