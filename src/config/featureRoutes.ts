/**
 * Which screens belong to which feature switch (src/config/brand.js, features). Pure: no React.
 *
 * Turning a feature off hides its buttons, tabs and menu rows in the screens themselves. This list is the safety net for everything
 * else: a link from an old notification, a typed web address, a deep link. The root layout (app/_layout.tsx) covers any screen listed
 * here with a plain "Not available in this app" page while its feature is off.
 *
 * Each entry is a route written as its folder path under app/, group names included, e.g. '(owner)/(tabs)/more/trucks'.
 * A route matches itself and everything below it.
 */
import { isFeatureOn, type FeatureName } from './brand';

export const FEATURE_ROUTES: Record<FeatureName, string[]> = {
  weather: ['(owner)/weather', '(worker)/weather', '(customer)/weather', 'weather'],
  publicVisitorArea: ['weather'],
  widgets: [],
  uniformSize: [],
  workerIdPhoto: [],
  repeatJobs: [],
  timeClock: [
    '(worker)/(tabs)/clock',
    '(owner)/(tabs)/more/labor',
    '(owner)/(tabs)/more/labor-day',
    '(owner)/(tabs)/more/labor-properties',
    '(owner)/(tabs)/more/labor-property',
    '(owner)/(tabs)/more/labor-review',
    '(owner)/(tabs)/more/labor-settings',
    '(owner)/(tabs)/more/labor-visit',
    '(owner)/(tabs)/more/labor-week',
    '(owner)/(tabs)/more/hours',
    '(owner)/(tabs)/more/attendance',
    '(owner)/(tabs)/more/payroll',
    '(owner)/(tabs)/more/yard-alerts',
  ],
  clockInAlerts: ['(owner)/(tabs)/more/yard-alerts'],
  financials: [
    '(owner)/document',
    '(owner)/document-new',
    '(owner)/document-edit',
    '(owner)/(tabs)/more/financials',
    '(owner)/(tabs)/more/document-defaults',
    '(customer)/document',
    'approve',
  ],
  materials: ['(owner)/(tabs)/more/materials'],
  trucks: ['(owner)/(tabs)/more/trucks'],
  requests: ['(owner)/service-requests', '(customer)/request', 'weather/(tabs)/request'],
  issues: ['(owner)/issues', '(owner)/issue-detail', '(worker)/report-issue'],
  reports: ['(owner)/reports'],
  announcements: ['(owner)/(tabs)/more/announcements'],
  messages: ['(customer)/(tabs)/messages'],
  customerPortal: ['(customer)'],
  addressSuggestions: [],
  maps: [],
  spanish: [],
  otaUpdates: [],
};

/** The first switched-off feature that owns this route, or null when the route is open. */
export function blockedFeature(segments: readonly string[], isOn: (f: FeatureName) => boolean = isFeatureOn): FeatureName | null {
  const path = segments.filter(Boolean).join('/');
  for (const [feature, routes] of Object.entries(FEATURE_ROUTES) as [FeatureName, string[]][]) {
    if (isOn(feature)) continue;
    if (routes.some((r) => path === r || path.startsWith(`${r}/`))) return feature;
  }
  return null;
}
