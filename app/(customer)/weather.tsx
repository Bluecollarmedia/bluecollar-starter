import React from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { WX, WeatherBackground } from '@/components/weather/WeatherUI';
import { WeatherHomeScreen } from '../weather/(tabs)/index';

/** The full forecast for a signed-in person, opened from the little weather button on their home. It slides up over the screen they were on. */
export default function SignedInWeather() {
  return (
    <View style={{ flex: 1, backgroundColor: WX.page }}>
      <WeatherBackground />
      <Animated.View style={{ flex: 1 }} entering={FadeIn.duration(380)}>
        <WeatherHomeScreen embedded />
      </Animated.View>
    </View>
  );
}
