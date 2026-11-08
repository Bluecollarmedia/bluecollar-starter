import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import type { Place } from '@/lib/maps';
import { useT } from '@/i18n';

export interface RouteMapStop { id: string; number: number; place: Place; done?: boolean }
export interface RouteMapProps { stops: RouteMapStop[]; height?: number; style?: ViewStyle }

const MAP_TINT = '#E4EAF0';

/**
 * The drawn card shown where the real map can't be (web, Android, or an iPhone whose addresses could not be found yet). The real map is
 * RouteMap.ios.tsx. That file must import THIS file for its fallback, never './RouteMap' (on iPhone that resolves to itself).
 */
export function RouteMapPins({ stops, height = 300, style }: RouteMapProps) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View style={[styles.area, { height, backgroundColor: MAP_TINT }, style]}>
      <Feather name="map" size={34} color={colors.primary} />
      <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: 8 }]}>
        {stops.length === 1 ? t('1 stop') : t('{n} stops', { n: stops.length })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ area: { alignItems: 'center', justifyContent: 'center', borderRadius: 16 } });
