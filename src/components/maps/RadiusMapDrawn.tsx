import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { shadow } from '@/theme/spacing';
import type { Place } from '@/lib/maps';

export interface RadiusMapProps {
  place: Place;
  radiusMeters: number;
  /** 0 (smallest choice) to 1 (largest) — sizes the circle on the drawn fallback. */
  fraction: number;
  height?: number;
  style?: ViewStyle;
  /** The project's resolved coordinates (the sheet resolves them once and hands them down). */
  coords?: { latitude: number; longitude: number } | null;
  /** False until the sheet has finished opening; the native map isn't created before then. */
  ready?: boolean;
}

const MAP_TINT = '#E4EAF0';

/**
 * Check-in zone preview. The real map is iPhone-only (RadiusMap.ios.tsx, like
 * JobMap); Android and web draw a circle around a pin that grows with the
 * distance instead.
 */
export function RadiusMapDrawn({ fraction, height = 180, style }: RadiusMapProps) {
  const { colors } = useTheme();
  const size = height * (0.32 + 0.6 * fraction);
  return (
    <View style={[styles.area, { height, backgroundColor: MAP_TINT }, style]}>
      <View
        style={{
          position: 'absolute', width: size, height: size, borderRadius: size / 2,
          borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(76, 175, 80, 0.18)',
        }}
      />
      <View style={[styles.pin, { backgroundColor: colors.surface }, shadow.sm]}>
        <Feather name="home" size={16} color={colors.primary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pin: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
