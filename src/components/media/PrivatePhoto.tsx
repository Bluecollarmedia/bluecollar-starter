import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { OptimizedImage } from '@/components/ui';
import { useFileAddress } from '@/lib/privateMedia';

/**
 * A stored photo that may be private. Opens it through a short-lived signed link when it is private (maintenance photos), otherwise shows
 * the stored address as before. A photo that is still a local file (not saved yet) is shown as it is. While the link loads nothing is drawn.
 */
export function PrivatePhoto({ fileUrl, fileKey, style, accessibilityLabel, plain }: {
  fileUrl: string | undefined; fileKey?: string; style?: StyleProp<ImageStyle>; accessibilityLabel?: string;
  /** Use React Native's plain Image (the stop photo grid) instead of the app's OptimizedImage. */
  plain?: boolean;
}) {
  const uri = useFileAddress(fileUrl, fileKey);
  if (!uri) return null;
  return plain
    ? <Image source={{ uri }} style={style} resizeMode="cover" accessibilityLabel={accessibilityLabel} />
    : <OptimizedImage source={uri} style={style as never} accessibilityLabel={accessibilityLabel} />;
}
