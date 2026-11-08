import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { usePublicWeatherSwitch } from '@/hooks/usePublicWeatherSwitch';
import { useWeatherGlance } from '@/hooks/useWeatherGlance';
import { WxPicture } from '@/components/weather/WeatherUI';
import { typeScale } from '@/theme/typography';

/**
 * The little weather button on the owner's, the customer's and every worker's home. It shows today's picture and temperature; tapping it
 * opens the full forecast (the route passed in `to`, which lives inside that person's own area) with the screen's slide-up. It springs in
 * when pressed. It is only there while the owner's Weather switch is on (the same switch as the public Weather), so it is never a dead button.
 */
export function WeatherButton({ to }: { to: string }) {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const on = usePublicWeatherSwitch(false);
  const glance = useWeatherGlance();
  const scale = useSharedValue(1);
  const spring = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  if (!on) return null;
  return (
    <Animated.View style={spring}>
      <Pressable
        onPress={() => router.push(to as any)}
        onPressIn={() => { scale.value = withSpring(0.9, { damping: 14, stiffness: 300 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 10, stiffness: 220 }); }}
        accessibilityRole="button"
        accessibilityLabel={glance.temp ? t('Weather, {temp}', { temp: glance.temp }) : t('Weather')}
        hitSlop={6}
      >
        <View style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {glance.icon ? <WxPicture icon={glance.icon} size={28} /> : <MaterialCommunityIcons name="weather-partly-cloudy" size={24} color={colors.textPrimary} />}
          {glance.temp ? <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{glance.temp}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 44, minWidth: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
});
