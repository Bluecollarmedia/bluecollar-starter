import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandCover } from '@/components/branding/BrandCover';
import { getWorkerHeaderImageUri } from '@/lib/projectImages';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

const LEAF = require('../../../assets/images/logo-leaf.png');

/**
 * The top of a worker's Today. The owner's own header photo when they set one, the green leaf header otherwise. `greeting` is the taller
 * version used before clocking in; the compact version (just "Today") is used once the route is showing.
 */
export function TodayHeader({ title, subtitle, greeting }: { title: string; subtitle?: string; greeting?: boolean }) {
  const insets = useSafeAreaInsets();
  const height = (greeting ? 196 : 124) + insets.top;
  return (
    <View style={[styles.wrap, { height }]}>
      <BrandCover uri={getWorkerHeaderImageUri()} style={StyleSheet.absoluteFill as any} />
      <View style={styles.scrim} pointerEvents="none" />
      <View style={[styles.content, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.brand}>
          <Image source={LEAF} style={styles.leaf} resizeMode="contain" />
          <View>
            <Text style={styles.brandName}>BRIGHTON</Text>
            <Text style={styles.brandTag}>LAWN · LANDSCAPE</Text>
          </View>
        </View>
        <View style={{ marginTop: greeting ? spacing.xl : spacing.md }}>
          <Text style={[greeting ? typeScale.displayLarge : typeScale.displaySmall, styles.shadow, { color: '#FFFFFF' }]}>{title}</Text>
          {subtitle ? <Text style={[typeScale.bodyLarge, styles.shadow, { color: '#FFFFFF', marginTop: spacing.xs }]}>{subtitle}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', overflow: 'hidden' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.18)' },
  content: { paddingHorizontal: spacing.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leaf: { width: 26, height: 26, tintColor: '#FFFFFF' },
  brandName: { color: '#FFFFFF', fontWeight: '800', letterSpacing: 1.5, fontSize: 15 },
  brandTag: { color: 'rgba(255,255,255,0.85)', fontSize: 8, letterSpacing: 1.2, marginTop: -1 },
  shadow: { textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
