import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { WX, WeatherBackground } from '@/components/weather/WeatherUI';
import WeatherWork from '../weather/(tabs)/work';

/** Our Work inside the signed-in customer's own area: the same profile, feed, reels and stories, with a Back button instead of the public tab bar. */
export default function CustomerWork() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: WX.page }}>
      <WeatherBackground />
      <WeatherWork />
      <Pressable
        onPress={() => { if (router.canGoBack()) router.back(); }}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        style={{ position: 'absolute', top: insets.top + 6, left: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }}
      >
        <MaterialCommunityIcons name="chevron-left" size={28} color="#17301F" />
      </Pressable>
    </View>
  );
}
