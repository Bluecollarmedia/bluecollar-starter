/**
 * Owner control for one header photo (the dashboard header or the workers'
 * home header): a live preview in the header's real shape, a crop step after
 * picking, and Remove to go back to the Brighton green backdrop.
 */

import React, { useState } from 'react';
import { Alert, Dimensions, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { keepPicked } from '@/lib/keepPickedFile';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { BrandCover } from '@/components/branding/BrandCover';
import { PhotoCropper, type PickedImage } from '@/components/media/PhotoCropper';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

/** Height of the photo header on the worker Today screen. */
export const WORKER_HERO_HEIGHT = 400;
/** Height of the "Today" card on the owner dashboard. */
export const DASHBOARD_HERO_HEIGHT = 280;

export type HeaderPhotoKind = 'dashboard' | 'worker';

function aspectFor(kind: HeaderPhotoKind): number {
  const screenW = Math.min(Dimensions.get('window').width, 520);
  return kind === 'dashboard'
    ? (screenW - spacing.lg * 2) / DASHBOARD_HERO_HEIGHT
    : screenW / WORKER_HERO_HEIGHT;
}

/** What sits on top of the photo in the real header, so the preview and crop frame match the app. */
export function HeaderPhotoOverlay({ kind, compact }: { kind: HeaderPhotoKind; compact?: boolean }) {
  const { colors } = useTheme();
  if (kind === 'dashboard') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient colors={['rgba(10,20,15,0.25)', 'rgba(8,16,12,0.85)']} style={StyleSheet.absoluteFill} />
        <View style={[styles.overlayText, { padding: compact ? spacing.md : spacing.lg }]}>
          <Text style={[typeScale.overline, { color: 'rgba(255,255,255,0.8)' }]}>TODAY</Text>
          <Text style={[compact ? typeScale.headingSmall : typeScale.headingLarge, { color: '#FFFFFF', marginTop: 2, marginBottom: compact ? spacing.sm : spacing.md }]}>
            3 jobs in progress
          </Text>
          <View style={[styles.statsRow, { marginBottom: compact ? spacing.sm : spacing.lg }]}>
            {['Workers', 'On site', 'Upcoming', 'Attention'].map((statLabel, i) => (
              <View key={statLabel}>
                <Text style={[compact ? typeScale.bodyLarge : typeScale.headingLarge, { color: '#FFFFFF' }]}>{[4, 2, 2, 3][i]}</Text>
                <Text style={[typeScale.caption, { color: 'rgba(255,255,255,0.85)' }]}>{statLabel}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.fakeButton, compact && { height: 30 }]} />
        </View>
      </View>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={['transparent', 'transparent', colors.groupedBackground]}
        locations={[0, 0.78, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.overlayText, { padding: compact ? spacing.md : spacing.lg, paddingBottom: compact ? '18%' : 100 }]}>
        <Text style={[compact ? typeScale.headingSmall : typeScale.displayLarge, styles.shadow, { color: '#FFFFFF' }]}>
          Good morning,{'\n'}crew
        </Text>
      </View>
    </View>
  );
}

interface HeaderPhotoFieldProps {
  kind: HeaderPhotoKind;
  /** The photo shown now (saved or just cropped); undefined means the green backdrop. */
  value?: string;
  onChange: (uri: string | undefined) => void;
}

export function HeaderPhotoField({ kind, value, onChange }: HeaderPhotoFieldProps) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const aspect = aspectFor(kind);
  const label = kind === 'dashboard' ? 'Dashboard photo' : "Workers' home photo";

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      const msg = 'Photo library access is needed to choose a header photo.';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Permission Needed', msg);
      return;
    }
    // No system editor: iOS only offers a square crop. Our own cropper uses the header's real shape.
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = result.canceled ? undefined : result.assets?.[0];
    if (asset) setPicked({ uri: await keepPicked(asset.uri), width: asset.width, height: asset.height });
  }

  function confirmRemove() {
    const msg = 'Go back to the Brighton green header?';
    Alert.alert('Remove photo', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(undefined) },
    ]);
  }

  return (
    <View>
      <Pressable
        onPress={pickPhoto}
        style={[styles.preview, { aspectRatio: aspect }]}
        accessibilityRole="button"
        accessibilityLabel={value ? `Change ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}
      >
        <BrandCover uri={value} style={StyleSheet.absoluteFill} />
        <HeaderPhotoOverlay kind={kind} compact />
        {!value && (
          <View style={styles.defaultTag}>
            <Text style={[typeScale.labelSmall, { color: '#FFFFFF' }]}>Brighton green (default)</Text>
          </View>
        )}
      </Pressable>

      <View style={styles.actions}>
        <Pressable onPress={pickPhoto} style={[styles.action, { backgroundColor: colors.primarySurface }]} accessibilityRole="button">
          <Feather name="image" size={16} color={colors.primaryDark} />
          <Text style={[typeScale.labelLarge, { color: colors.primaryDark, marginLeft: spacing.xs }]}>
            {value ? 'Change photo' : 'Choose photo'}
          </Text>
        </Pressable>
        {value && (
          <Pressable onPress={confirmRemove} style={[styles.action, { backgroundColor: colors.groupedBackground }]} accessibilityRole="button">
            <Feather name="trash-2" size={16} color={colors.textSecondary} />
            <Text style={[typeScale.labelLarge, { color: colors.textSecondary, marginLeft: spacing.xs }]}>Remove</Text>
          </Pressable>
        )}
      </View>

      <PhotoCropper
        image={picked}
        aspect={aspect}
        title={kind === 'dashboard' ? 'Fit dashboard photo' : 'Fit workers’ photo'}
        overlay={<HeaderPhotoOverlay kind={kind} />}
        onCancel={() => setPicked(null)}
        onDone={(uri) => {
          setPicked(null);
          onChange(uri);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  overlayText: { flex: 1, justifyContent: 'flex-end' },
  shadow: {
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  fakeButton: {
    height: 44,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  defaultTag: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
});
