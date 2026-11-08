/**
 * Divider — Visual Separator
 */

import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { spacing } from '@/theme/spacing';

interface DividerProps {
  style?: ViewStyle;
  vertical?: boolean;
}

export function Divider({ style, vertical = false }: DividerProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        vertical
          ? { width: 1, alignSelf: 'stretch', backgroundColor: colors.border }
          : { height: 1, width: '100%', backgroundColor: colors.border, marginVertical: spacing.sm },
        style,
      ]}
    />
  );
}
