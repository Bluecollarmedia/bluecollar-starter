import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { typeScale } from '@/theme/typography';
import { radius, spacing } from '@/theme/spacing';

/** A small status badge with a dot, in the Snow palette colours it is given (see snowStatus in src/theme/colors.ts). */
export function SnowPill({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]} accessible accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[typeScale.labelLarge, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
