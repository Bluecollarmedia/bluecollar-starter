import { locationLabel } from '@/data/maintenance';
import type { LocationStatus } from '@/types/maintenance';
import { tr } from '@/i18n';

/** locationLabel() speaks of "the property"; day starts are checked against the yard. */
export function yardLocationLabel(status?: LocationStatus): string {
  if (status === 'outside_radius') return tr('Not at the yard (GPS)');
  if (status === 'no_target_location') return tr('Yard not on the map');
  return tr(locationLabel(status));
}

/**
 * What to tell a maintenance worker before saving a check-in whose location
 * can't be verified. Null when the reading is verified and nothing needs
 * saying. Check-ins are never blocked: every prompt offers to continue, and
 * the record keeps its real location status so the owner can review it.
 */
export function unverifiedPrompt(
  status: LocationStatus,
  placeName: string,
  kind: 'day' | 'stop',
): { title: string; message: string; openSettings?: boolean } | null {
  const tail = kind === 'day'
    ? tr('You can still start your day. It will be saved as not GPS verified so the office can review it.')
    : tr('You can still check in. It will be saved as not GPS verified so the office can review it.');
  switch (status) {
    case 'verified':
      return null;
    case 'outside_radius':
      return {
        title: kind === 'day' ? tr('You’re not at the yard') : tr('You’re not at this property'),
        message: `${tr('Your phone doesn’t place you at {place}.', { place: placeName })} ${tail}`,
      };
    case 'low_accuracy':
      return { title: tr('GPS signal is weak'), message: `${tr('Your phone can’t tell exactly where you are right now.')} ${tail}` };
    case 'denied':
      return { title: tr('Location is off'), message: `${tr('Brighton Lawn can’t see your location.')} ${tail}`, openSettings: true };
    case 'no_target_location':
      return { title: tr('Location can’t be checked'), message: `${tr('{place} isn’t pinned on the map yet.', { place: placeName })} ${tail}` };
    case 'unavailable':
    case 'not_checked':
    default:
      return { title: tr('Can’t find your location'), message: `${tr('Your phone couldn’t get a GPS fix.')} ${tail}` };
  }
}
