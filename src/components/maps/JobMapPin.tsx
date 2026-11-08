import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { shadow } from '@/theme/spacing';
import type { Place } from '@/lib/maps';

export interface JobMapProps {
  place: Place;
  height?: number;
  style?: ViewStyle;
}

const MAP_TINT = '#E4EAF0';

/**
 * The drawn pin card for a job's address, used wherever the real map can't be. The real map is iPhone-only (JobMap.ios.tsx,
 * Apple Maps, no key needed); Android needs a Google Maps key, and web has no
 * map, so they show this pin card instead.
 */
export function JobMapPin({ height = 140, style }: JobMapProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.area, { height, backgroundColor: MAP_TINT }, style]}>
      <View style={[styles.pin, { backgroundColor: colors.surface }, shadow.sm]}>
        <Feather name="map-pin" size={20} color={colors.primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { alignItems: 'center', justifyContent: 'center' },
  pin: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
