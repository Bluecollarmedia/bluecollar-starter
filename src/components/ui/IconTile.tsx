/**
 * IconTile — a flat, rounded-square tile with a simple line icon.
 *
 * Quiet warm-neutral fill, charcoal line icon, no gradient, no shadow. Icons
 * are the same weight everywhere so lists and cards read as one family.
 * Colour is kept for the few things that matter (actions, selected states).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';

interface IconTileProps {
  name: string;
  /** Tile edge length. The icon scales with it. */
  size?: number;
  /** Greyed-out look for disabled/off items. */
  muted?: boolean;
}

export function IconTile({ name, size = 36, muted }: IconTileProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: colors.backgroundTertiary },
      ]}
    >
      <Icon name={name as any} size={Math.round(size * 0.5)} color={muted ? colors.textTertiary : colors.textPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
