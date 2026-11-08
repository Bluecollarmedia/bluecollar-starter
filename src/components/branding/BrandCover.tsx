import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { OptimizedImage } from '@/components/ui/OptimizedImage';
import { brand, fixed, blackAlpha } from '@/theme/colors';

/** True when the brand color is too light for white text on it (then the backdrop gets a dark veil). */
const LIGHT_BRAND = brand.onPrimary !== fixed.white;

/** The plain logo mark (settings: swap the picture file to change it). */
const MARK = require('../../../assets/images/logo-mark.png');

interface BrandCoverProps {
  /** The owner's own photo. When missing, the brand-color backdrop shows instead of a stock photo. */
  uri?: string;
  style?: StyleProp<ImageStyle>;
  /** 'hero' shows one large faint mark for big headers; 'tile' a small centred mark for thumbnails. */
  variant?: 'hero' | 'tile';
}

export function BrandCover({ uri, style, variant = 'hero' }: BrandCoverProps) {
  if (uri) return <OptimizedImage source={uri} style={style} />;

  return (
    <View style={[style as StyleProp<ViewStyle>, styles.clip]} pointerEvents="none">
      <LinearGradient
        colors={[brand.accentMid, brand.primary, brand.primaryDark]}
        locations={[0, 0.5, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* White words sit on this backdrop (greetings, headers). A LIGHT brand color gets a dark veil so they stay readable. */}
      {LIGHT_BRAND ? <View style={[StyleSheet.absoluteFill, { backgroundColor: blackAlpha(0.55) }]} /> : null}
      {variant === 'hero' ? (
        <Image source={MARK} style={styles.bigMark} resizeMode="contain" />
      ) : (
        <Image source={MARK} style={styles.tileMark} resizeMode="contain" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  bigMark: {
    position: 'absolute',
    right: -40,
    top: '20%',
    width: 200,
    height: 200,
    tintColor: fixed.white,
    opacity: 0.12,
  },
  tileMark: {
    position: 'absolute',
    alignSelf: 'center',
    top: '25%',
    width: '50%',
    height: '50%',
    tintColor: fixed.white,
    opacity: 0.3,
  },
});
