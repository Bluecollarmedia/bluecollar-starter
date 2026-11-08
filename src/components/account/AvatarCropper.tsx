/**
 * The profile photo crop screen: the picture sits behind a circle; the person drags it into place and sets the zoom with a
 * slider. (Pinch or scroll-wheel zoom is a website extra only; on the phone the slider is the control.) Done hands back a
 * square picture cut to exactly what is inside the circle. It is our own screen, not the system crop screen, which crashed on
 * iOS 27.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, Modal, Pressable, PanResponder, StyleSheet, Platform, ActivityIndicator, useWindowDimensions, LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { cropAvatarToBox } from '@/lib/avatarCrop';
import { clampOffset, clampZoom, cropBox, displayScale, fractionToZoom, zoomToFraction, MAX_ZOOM, type CropView } from '@/lib/avatarCropMath';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { useT } from '@/i18n';

interface Props {
  visible: boolean;
  uri: string;
  width: number;
  height: number;
  onCancel: () => void;
  /** The cropped picture's address, or null when the crop could not be made (the caller then uses its automatic square). */
  onDone: (croppedUri: string | null) => void;
}

const THUMB = 28;

export function AvatarCropper({ visible, uri, width, height, onCancel, onDone }: Props) {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const frame = Math.min(win.width - spacing.xl * 2, 340);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ tx: 0, ty: 0 });
  const [busy, setBusy] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  // Start fresh each time a picture is opened.
  useEffect(() => { if (visible) { setZoom(1); setOffset({ tx: 0, ty: 0 }); setBusy(false); } }, [visible, uri]);

  const view: CropView = { width, height, frame, zoom };
  // The gesture callbacks are created once, so they read the latest values through a ref.
  const live = useRef({ view, offset, trackWidth });
  live.current = { view, offset, trackWidth };
  const dragStart = useRef({ tx: 0, ty: 0 });

  const dragPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { dragStart.current = { tx: live.current.offset.tx, ty: live.current.offset.ty }; },
      onPanResponderMove: (_, g) => setOffset(clampOffset(live.current.view, dragStart.current.tx + g.dx, dragStart.current.ty + g.dy)),
    }),
  ).current;

  const setZoomKeepingInside = useCallback((next: number) => {
    const z = clampZoom(next);
    setZoom(z);
    setOffset((o) => clampOffset({ ...live.current.view, zoom: z }, o.tx, o.ty));
  }, []);

  const sliderPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { const w = live.current.trackWidth; if (w) setZoomKeepingInside(fractionToZoom((e.nativeEvent.locationX - THUMB / 2) / w)); },
      onPanResponderMove: (e) => { const w = live.current.trackWidth; if (w) setZoomKeepingInside(fractionToZoom((e.nativeEvent.locationX - THUMB / 2) / w)); },
    }),
  ).current;

  async function done() {
    if (busy) return;
    setBusy(true);
    const box = cropBox(view, offset.tx, offset.ty);
    const cropped = await cropAvatarToBox(uri, box);
    setBusy(false);
    onDone(cropped);
  }

  const s = displayScale(view);
  const imgW = width * s;
  const imgH = height * s;
  const thumbLeft = trackWidth ? zoomToFraction(zoom) * trackWidth : 0;
  // Website only: scroll-wheel / trackpad-pinch zoom.
  const webWheel = Platform.OS === 'web'
    ? { onWheel: (e: { deltaY: number; preventDefault?: () => void }) => { e.preventDefault?.(); setZoomKeepingInside(live.current.view.zoom - e.deltaY / 300); } }
    : {};

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.top}>
          <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Cancel')}><Text style={[typeScale.bodyLarge, { color: '#FFFFFF' }]}>{t('Cancel')}</Text></Pressable>
          <Text style={[typeScale.headingSmall, { color: '#FFFFFF' }]}>{t('Move and zoom')}</Text>
          <Pressable onPress={done} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Done')} disabled={busy}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[typeScale.bodyLarge, { color: '#9FE1CB', fontWeight: '700' }]}>{t('Done')}</Text>}
          </Pressable>
        </View>

        <View style={styles.stage}>
          <View style={[styles.frame, { width: frame, height: frame }]} {...dragPan.panHandlers} {...(webWheel as object)} accessibilityLabel={t('Drag the photo to position it')}>
            <Image
              source={{ uri }}
              style={{ position: 'absolute', width: imgW, height: imgH, left: frame / 2 - imgW / 2 + offset.tx, top: frame / 2 - imgH / 2 + offset.ty }}
              resizeMode="cover"
            />
            {/* Darkens everything outside the circle: a huge ring-shaped border around a circle of exactly the frame size. */}
            <View pointerEvents="none" style={{ position: 'absolute', left: -frame, top: -frame, width: frame * 3, height: frame * 3, borderRadius: frame * 1.5, borderWidth: frame, borderColor: 'rgba(0,0,0,0.62)' }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: frame, height: frame, borderRadius: frame / 2, borderWidth: 2, borderColor: '#FFFFFF' }} />
          </View>
          <Text style={[typeScale.caption, { color: 'rgba(255,255,255,0.75)', marginTop: spacing.md }]}>{t('Drag the photo to move it')}</Text>
        </View>

        <View style={styles.zoomRow}>
          <Icon name="minus" size={18} color="#FFFFFF" />
          <View style={styles.sliderTouch} {...sliderPan.panHandlers} accessibilityRole="adjustable" accessibilityLabel={t('Zoom')} accessibilityValue={{ min: 1, max: MAX_ZOOM, now: Math.round(zoom * 10) / 10 }}>
            <View style={styles.track} onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)} pointerEvents="none">
              <View style={[styles.trackFill, { width: thumbLeft, backgroundColor: colors.primary }]} />
              <View style={[styles.thumb, { left: thumbLeft - THUMB / 2, borderColor: colors.primary }]} />
            </View>
          </View>
          <Icon name="plus" size={18} color="#FFFFFF" />
        </View>
        {Platform.OS === 'web' ? <Text style={[typeScale.caption, styles.hint]}>{t('You can also scroll or pinch to zoom')}</Text> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111111', paddingHorizontal: spacing.lg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { overflow: 'hidden', backgroundColor: '#000000' },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm },
  sliderTouch: { flex: 1, paddingVertical: spacing.lg, paddingHorizontal: THUMB / 2 },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center' },
  trackFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 3, backgroundColor: '#FFFFFF' },
  hint: { color: 'rgba(255,255,255,0.65)', textAlign: 'center', marginTop: -spacing.sm },
});
