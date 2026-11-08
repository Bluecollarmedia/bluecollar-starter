import React from 'react';
import { Image } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';

interface OptimizedImageProps {
  source: string | { uri: string };
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none';
  placeholder?: string;
  transition?: number;
  accessibilityLabel?: string;
}

export function OptimizedImage({
  source,
  style,
  contentFit = 'cover',
  placeholder,
  transition = 200,
  accessibilityLabel,
}: OptimizedImageProps) {
  const uri = typeof source === 'string' ? source : source.uri;

  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={contentFit}
      placeholder={placeholder ? { blurhash: placeholder } : undefined}
      transition={transition}
      cachePolicy="memory-disk"
      recyclingKey={uri}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
