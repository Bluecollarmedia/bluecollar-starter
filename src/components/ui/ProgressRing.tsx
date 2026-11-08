/**
 * A compact circular progress ring made from plain views (no SVG dependency): a track ring, plus two clipped half-rings that
 * are rotated to show the percentage. The percentage sits in the middle.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';

interface Props {
  progress: number;
  size?: number;
  thickness?: number;
  color: string;
}

export function ProgressRing({ progress, size = 84, thickness = 8, color }: Props) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(100, Math.round(progress || 0)));
  const deg = pct * 3.6;
  const half = size / 2;
  const ring = { position: 'absolute' as const, width: size, height: size, borderRadius: half, borderWidth: thickness, borderColor: 'transparent' };
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${pct} percent complete`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
    >
      <View style={[ring, { borderColor: colors.borderLight }]} />
      {pct > 0 && (
        <View style={{ position: 'absolute', left: half, top: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={[ring, { left: -half, borderTopColor: color, borderRightColor: color, transform: [{ rotate: `${Math.min(deg, 180) - 135}deg` }] }]} />
        </View>
      )}
      {pct > 50 && (
        <View style={{ position: 'absolute', left: 0, top: 0, width: half, height: size, overflow: 'hidden' }}>
          <View style={[ring, { left: 0, borderBottomColor: color, borderLeftColor: color, transform: [{ rotate: `${deg - 180 - 135}deg` }] }]} />
        </View>
      )}
      <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '800' }]}>{pct}%</Text>
    </View>
  );
}
