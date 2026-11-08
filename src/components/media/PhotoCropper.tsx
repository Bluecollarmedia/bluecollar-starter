/**
 * Full-screen crop step for header photos.
 *
 * The bright frame is the exact shape of the header the photo is going into,
 * and `overlay` draws that header's text on top, so the owner sees precisely
 * what will show. Drag to move, pinch (or the − / + buttons) to zoom; the
 * photo always covers the whole frame. Done crops the original image to the
 * framed area and hands back the new file.
 */

import { tr } from '@/i18n';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Feather } from '@expo/vector-icons';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { brand } from '@/theme/colors';

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

interface PhotoCropperProps {
  /** The picked photo; the cropper is open while this is set. */
  image: PickedImage | null;
  /** Width ÷ height of the header the photo is for. */
  aspect: number;
  title: string;
  /** What sits on top of the photo in the real header (text, fades), drawn inside the frame. */
  overlay?: React.ReactNode;
  onCancel: () => void;
  onDone: (croppedUri: string) => void;
}

const MAX_ZOOM = 5;
const OUTPUT_WIDTH = 1600;
const SIDE_GUTTER = spacing.lg;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

export function PhotoCropper({ image, aspect, title, overlay, onCancel, onDone }: PhotoCropperProps) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Frame: full width minus gutters, never taller than the room left between the bars.
  const availableHeight = window.height - insets.top - insets.bottom - 220;
  let frameW = Math.min(window.width - SIDE_GUTTER * 2, 520);
  let frameH = frameW / aspect;
  if (frameH > availableHeight) {
    frameH = availableHeight;
    frameW = frameH * aspect;
  }

  // Scale at zoom 1: the smallest that still covers the frame.
  const baseScale = image ? Math.max(frameW / image.width, frameH / image.height) : 1;
  const baseW = image ? image.width * baseScale : frameW;
  const baseH = image ? image.height * baseScale : frameH;

  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startZoom = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  // Size of the touch area; the frame sits in its centre.
  const areaW = useSharedValue(0);
  const areaH = useSharedValue(0);

  useEffect(() => {
    zoom.value = 1;
    tx.value = 0;
    ty.value = 0;
    setSaving(false);
    setError(null);
  }, [image?.uri]);

  const limits = useMemo(() => ({ frameW, frameH, baseW, baseH }), [frameW, frameH, baseW, baseH]);

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onBegin(() => {
      startX.value = tx.value;
      startY.value = ty.value;
      runOnJS(setDragging)(true);
    })
    .onUpdate((e) => {
      const maxX = (limits.baseW * zoom.value - limits.frameW) / 2;
      const maxY = (limits.baseH * zoom.value - limits.frameH) / 2;
      tx.value = clamp(startX.value + e.translationX, -maxX, maxX);
      ty.value = clamp(startY.value + e.translationY, -maxY, maxY);
    })
    .onFinalize(() => {
      runOnJS(setDragging)(false);
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startZoom.value = zoom.value;
      startX.value = tx.value;
      startY.value = ty.value;
      runOnJS(setDragging)(true);
    })
    .onUpdate((e) => {
      const next = clamp(startZoom.value * e.scale, 1, MAX_ZOOM);
      // Keep the spot under the fingers in place while zooming.
      const fx = e.focalX - areaW.value / 2;
      const fy = e.focalY - areaH.value / 2;
      const ratio = next / startZoom.value;
      const maxX = (limits.baseW * next - limits.frameW) / 2;
      const maxY = (limits.baseH * next - limits.frameH) / 2;
      zoom.value = next;
      tx.value = clamp(fx - (fx - startX.value) * ratio, -maxX, maxX);
      ty.value = clamp(fy - (fy - startY.value) * ratio, -maxY, maxY);
    })
    .onFinalize(() => {
      runOnJS(setDragging)(false);
    });

  const gestures = Gesture.Simultaneous(pan, pinch);

  const imageStyle = useAnimatedStyle(() => ({
    width: limits.baseW,
    height: limits.baseH,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }],
  }));

  function stepZoom(factor: number) {
    const next = clamp(zoom.value * factor, 1, MAX_ZOOM);
    const ratio = next / zoom.value;
    const maxX = (baseW * next - frameW) / 2;
    const maxY = (baseH * next - frameH) / 2;
    zoom.value = withTiming(next, { duration: 180 });
    tx.value = withTiming(clamp(tx.value * ratio, -maxX, maxX), { duration: 180 });
    ty.value = withTiming(clamp(ty.value * ratio, -maxY, maxY), { duration: 180 });
  }

  async function handleDone() {
    if (!image || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Where the frame sits on the original photo, in its own pixels.
      const k = baseScale * zoom.value;
      const left = frameW / 2 + tx.value - (baseW * zoom.value) / 2;
      const top = frameH / 2 + ty.value - (baseH * zoom.value) / 2;
      const width = Math.min(image.width, Math.round(frameW / k));
      const height = Math.min(image.height, Math.round(frameH / k));
      const originX = clamp(Math.round(-left / k), 0, image.width - width);
      const originY = clamp(Math.round(-top / k), 0, image.height - height);

      const context = ImageManipulator.manipulate(image.uri).crop({ originX, originY, width, height });
      if (width > OUTPUT_WIDTH) context.resize({ width: OUTPUT_WIDTH });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
      onDone(saved.uri);
    } catch (e) {
      setError(tr("That photo couldn't be cropped. Try another one."));
      setSaving(false);
    }
  }

  const sideW = (window.width - frameW) / 2;

  return (
    <Modal visible={!!image} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button" disabled={saving}>
            <Text style={[typeScale.bodyLarge, styles.barText]}>Cancel</Text>
          </Pressable>
          <Text style={[typeScale.headingSmall, styles.barText]} numberOfLines={1}>{title}</Text>
          <Pressable onPress={handleDone} hitSlop={12} accessibilityRole="button" disabled={saving}>
            {saving ? (
              <ActivityIndicator color={brand.primaryLight} />
            ) : (
              <Text style={[typeScale.bodyLarge, styles.barText, { color: brand.primaryLight, fontWeight: '700' }]}>Done</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.stage}>
          {image && (
            <GestureDetector gesture={gestures}>
              <View
                style={styles.gestureArea}
                onLayout={(e) => {
                  areaW.value = e.nativeEvent.layout.width;
                  areaH.value = e.nativeEvent.layout.height;
                }}
              >
                {/* The photo, centred on the frame; it spills past the frame and is dimmed there. */}
                <View style={[styles.frameAnchor, { width: frameW, height: frameH }]}>
                  <Animated.View style={[styles.imageWrap, { left: (frameW - baseW) / 2, top: (frameH - baseH) / 2 }, imageStyle]}>
                    <Image source={{ uri: image.uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
                  </Animated.View>
                </View>

                {/* Dim everything outside the frame. */}
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <View style={[styles.shade, { flex: 1 }]} />
                  <View style={{ flexDirection: 'row', height: frameH }}>
                    <View style={[styles.shade, { width: sideW }]} />
                    <View style={[styles.frame, { width: frameW, height: frameH }]}>
                      {overlay}
                      {dragging && (
                        <>
                          <View style={[styles.gridV, { left: '33.33%' }]} />
                          <View style={[styles.gridV, { left: '66.66%' }]} />
                          <View style={[styles.gridH, { top: '33.33%' }]} />
                          <View style={[styles.gridH, { top: '66.66%' }]} />
                        </>
                      )}
                    </View>
                    <View style={[styles.shade, { width: sideW }]} />
                  </View>
                  <View style={[styles.shade, { flex: 1 }]} />
                </View>
              </View>
            </GestureDetector>
          )}
        </View>

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.lg }]}>
          {error ? (
            <Text style={[typeScale.bodySmall, { color: '#FF8A80', textAlign: 'center' }]}>{error}</Text>
          ) : (
            <Text style={[typeScale.bodySmall, styles.hint]}>
              Drag to move · pinch to zoom. Everything inside the frame is what shows.
            </Text>
          )}
          <View style={styles.zoomRow}>
            <Pressable onPress={() => stepZoom(1 / 1.25)} style={styles.zoomButton} accessibilityLabel="Zoom out" hitSlop={8}>
              <Feather name="minus" size={20} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => stepZoom(1.25)} style={styles.zoomButton} accessibilityLabel="Zoom in" hitSlop={8}>
              <Feather name="plus" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F0C' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    zIndex: 2,
  },
  barText: { color: '#FFFFFF' },
  stage: { flex: 1, overflow: 'hidden' },
  gestureArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frameAnchor: { alignItems: 'center', justifyContent: 'center' },
  imageWrap: { position: 'absolute' },
  shade: { backgroundColor: 'rgba(0,0,0,0.62)' },
  frame: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.6)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.6)' },
  bottomBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md, zIndex: 2 },
  hint: { color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  zoomRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  zoomButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
