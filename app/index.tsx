/**
 * App Index — Entry Redirect
 *
 * expo-router needs an index route. The root _layout handles
 * auth-based routing, so this just redirects to the auth group
 * (the layout will bounce authenticated users to their role group).
 *
 * The one exception: a signed-out visitor goes to the public Weather area instead, but only while the owner's Weather switch is ON
 * (see src/lib/weatherSwitch.ts). With the switch OFF, or when it cannot be read, this is exactly the redirect it always was.
 */

import { Redirect } from 'expo-router';
import { useAuth } from '@/providers/AuthProvider';
import { weatherSwitch } from '@/data/publicWeather';
import { effectiveWeatherOn, entryRedirect } from '@/lib/launchRoute';
import { WEATHER_ON_THIS_DEVICE } from '@/lib/weatherPlatform';

export default function AppIndex() {
  const { isAuthenticated } = useAuth();
  const weatherOn = effectiveWeatherOn(WEATHER_ON_THIS_DEVICE, weatherSwitch.getEnabled());
  return <Redirect href={entryRedirect({ isAuthenticated, weatherOn })} />;
}
