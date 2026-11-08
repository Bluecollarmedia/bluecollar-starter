/**
 * CrewLabel — small colored pill with a worker's crew name.
 */
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { typeScale } from '@/theme/typography';
import { radius, spacing } from '@/theme/spacing';

interface CrewLabelProps {
  name: string;
  color: string;
  style?: ViewStyle;
}

export function CrewLabel({ name, color, style }: CrewLabelProps) {
  return (
    <View style={[styles.pill, { backgroundColor: `${color}1F` }, style]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    gap: 5,
    maxWidth: '100%',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { ...typeScale.caption, fontWeight: '700', flexShrink: 1 },
});

/** Every crew a worker is in, side by side (nothing when they are in none). */
export function CrewLabels({ crews, style }: { crews: { id: string; name: string; color: string }[]; style?: ViewStyle }) {
  if (crews.length === 0) return null;
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, style]}>
      {crews.map((c) => <CrewLabel key={c.id} name={c.name} color={c.color} />)}
    </View>
  );
}
