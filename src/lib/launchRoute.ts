/**
 * Where a SIGNED-OUT visitor belongs at launch. Pure: no React, no network.
 *
 * With the public Weather experience OFF this is exactly the app's original behavior: everything except the sign-in area goes to the
 * welcome screen. Only when Weather is ON do signed-out visitors go to /weather instead. Signed-in people never use this.
 */

/**
 * The Weather screens exist (Phase 2). Whether visitors actually see them is the owner's switch in Settings, which is OFF until the owner
 * turns it on. Setting this to false would make the app behave as if Weather were OFF whatever the server says.
 */
export const WEATHER_EXPERIENCE_BUILT = true;

export type SignedOutDestination = '/(auth)/welcome' | '/weather';

/** The place a signed-out visitor should be moved to, or null to leave them where they are. */
export function signedOutRedirect(input: { firstSegment: string | undefined; weatherOn: boolean }): SignedOutDestination | null {
  const inAuth = input.firstSegment === '(auth)';
  if (input.weatherOn) return inAuth || input.firstSegment === 'weather' ? null : '/weather';
  return inAuth ? null : '/(auth)/welcome';
}

/**
 * Where the app's root route (app/index.tsx) sends someone. Today that is always the login screen; the ONLY exception is a signed-out
 * visitor while Weather is on. A signed-in person always gets the original redirect (the layout then moves them to their own area).
 */
export function entryRedirect(input: { isAuthenticated: boolean; weatherOn: boolean }): '/(auth)/login' | '/weather' {
  return !input.isAuthenticated && input.weatherOn ? '/weather' : '/(auth)/login';
}

/** What the app treats as "Weather is on": the answer AND the experience actually being built. */
export const effectiveWeatherOn = (built: boolean, decided: boolean): boolean => built && decided;
