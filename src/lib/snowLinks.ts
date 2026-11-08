import type { Href } from 'expo-router';
import type { SnowTarget } from '@/data/snowDashboard';

/**
 * Where a Snow dashboard item opens. Visits open their route, where the stop
 * is listed in order; there's no separate visit screen. Employees open Snow
 * Hours, the owner's view of snow shifts.
 */
export function snowDashboardHref(target: SnowTarget): Href {
  switch (target.kind) {
    case 'storm':
      return { pathname: '/snow/owner/storm/[id]', params: { id: target.stormId } };
    // A route (or one of its stops) opens the storm: the route is edited right there, on the one screen.
    case 'route':
    case 'visit':
      return { pathname: '/snow/owner/storm/[id]', params: { id: target.stormId } };
    // The employee's own shifts, over the last 30 days, so an old shift they never clocked out of is on the screen when you arrive.
    case 'employee':
      return { pathname: '/snow/owner/hours', params: { person: target.personId } };
    case 'media_review':
      return '/snow/owner/review';
  }
}
