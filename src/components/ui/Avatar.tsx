import React from 'react';
import { View, StyleSheet, ViewStyle, ImageStyle } from 'react-native';
import { Image } from 'expo-image';
import { Text } from 'react-native';
import { fontWeight } from '@/theme/typography';

interface AvatarProps {
  firstName: string;
  lastName: string;
  size?: number;
  style?: ViewStyle;
  uri?: string;
}

const BG_COLORS = [
  '#7CB342', '#1976D2', '#E64A19', '#00897B',
  '#5E35B1', '#C62828', '#00838F', '#AD1457',
];

function getColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return BG_COLORS[Math.abs(hash) % BG_COLORS.length];
}

export function Avatar({ firstName, lastName, size = 40, style, uri }: AvatarProps) {
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  const bg = getColor(`${firstName}${lastName}`);
  const fontSize = size * 0.38;
  const borderRadius = size / 2;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[
          { width: size, height: size, borderRadius },
          style as ImageStyle | undefined,
        ]}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
      />
    );
  }

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius, backgroundColor: bg },
        style,
      ]}
    >
      <Text style={[styles.initials, { fontSize, lineHeight: fontSize * 1.2 }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: fontWeight.semibold,
  },
});
