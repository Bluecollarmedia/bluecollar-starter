import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

/** Grass for lawn work, sparkles for cleanups, as in the approved Today mockup. */
export function ServiceIcon({ label, size = 15, color }: { label: string; size?: number; color: string }) {
  return <MaterialCommunityIcons name={/clean/i.test(label) ? 'shimmer' : 'grass'} size={size} color={color} />;
}
