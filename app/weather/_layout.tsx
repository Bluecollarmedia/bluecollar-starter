import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { weatherSwitch } from '@/data/publicWeather';
import { WX, WeatherBackground } from '@/components/weather/WeatherUI';
import { WEATHER_ON_THIS_DEVICE } from '@/lib/weatherPlatform';
import { PUBLIC_AREA_IN_APP } from '@/hooks/usePublicWeatherSwitch';

/**
 * The public Weather area: one light page behind its screens. The three tabs (Weather, Request, Contact) live in (tabs).
 * While it is open the app re-asks the owner's switch every 60 seconds; if Weather has been switched off, the app's launch routing
 * moves the visitor to the welcome screen.
 */
export default function WeatherLayout() {
  useEffect(() => {
    if (!PUBLIC_AREA_IN_APP) return;
    const id = setInterval(() => { void weatherSwitch.refresh(); }, 60_000);
    return () => clearInterval(id);
  }, []);
  // The website has no public weather: anyone who types a weather address there goes to the normal entry.
  // So does everyone while the settings file has no public visitor area (features.publicVisitorArea).
  if (!WEATHER_ON_THIS_DEVICE || !PUBLIC_AREA_IN_APP) return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, backgroundColor: WX.page }}>
      <WeatherBackground />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </View>
  );
}
