import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { OptimizedImage } from '@/components/ui/OptimizedImage';
import { brand } from '@/theme/colors';

const LEAF = require('../../../assets/images/logo-leaf.png');

// Enough tiles to cover a full-width hero once the grid is rotated.
const TILE = 64;
const PATTERN_ROWS = 10;
const PATTERN_COLS = 9;

interface BrandCoverProps {
  /** The owner's own photo. When missing, the Brighton green backdrop shows instead of a stock photo. */
  uri?: string;
  style?: StyleProp<ImageStyle>;
  /** 'hero' adds the faint leaf pattern for big headers; 'tile' is a plain gradient with one leaf for thumbnails. */
  variant?: 'hero' | 'tile';
}

export function BrandCover({ uri, style, variant = 'hero' }: BrandCoverProps) {
  if (uri) return <OptimizedImage source={uri} style={style} />;

  return (
    <View style={[style as StyleProp<ViewStyle>, styles.clip]} pointerEvents="none">
      <LinearGradient
        colors={[brand.primaryLight, brand.primary, brand.primaryDark, brand.accent]}
        locations={[0, 0.3, 0.62, 1]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {variant === 'hero' ? (
        <>
          <View style={styles.pattern}>
            {Array.from({ length: PATTERN_ROWS }, (_, row) => (
              <View key={row} style={[styles.patternRow, row % 2 === 1 && { marginLeft: TILE / 2 }]}>
                {Array.from({ length: PATTERN_COLS }, (_, col) => (
                  <Image key={col} source={LEAF} style={styles.patternLeaf} resizeMode="contain" />
                ))}
              </View>
            ))}
          </View>
          <Image source={LEAF} style={styles.bigLeaf} resizeMode="contain" />
        </>
      ) : (
        <Image source={LEAF} style={styles.tileLeaf} resizeMode="contain" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  pattern: {
    position: 'absolute',
    top: -TILE,
    left: -TILE,
    opacity: 0.09,
    transform: [{ rotate: '-18deg' }],
  },
  patternRow: { flexDirection: 'row' },
  patternLeaf: { width: TILE - 16, height: TILE - 16, margin: 8 },
  bigLeaf: {
    position: 'absolute',
    right: -40,
    top: '20%',
    width: 200,
    height: 200,
    tintColor: '#FFFFFF',
    opacity: 0.18,
  },
  tileLeaf: {
    position: 'absolute',
    alignSelf: 'center',
    top: '20%',
    width: '60%',
    height: '60%',
    tintColor: '#FFFFFF',
    opacity: 0.35,
  },
});
