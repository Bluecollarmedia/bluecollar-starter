import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';

/** The picture's own shape, kept within sane limits so a very tall or very wide screenshot never takes over the page. */
const clampRatio = (w: number, h: number) => Math.max(0.5, Math.min(2.5, w / Math.max(1, h)));

/**
 * The owner's storm map (often a screenshot with the amounts for each town written on it). It is shown at its own shape and full width. Tapping it
 * opens it full screen, where it can be pinched to zoom, so the small town names and amounts stay readable.
 */
export function StormMap({ uri, label, onOpenCard = false }: { uri: string; label: string; onOpenCard?: boolean }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [ratio, setRatio] = useState(4 / 3);
  const [open, setOpen] = useState(false);
  const load = (e: { nativeEvent?: { source?: { width?: number; height?: number } } }) => {
    const s = e.nativeEvent?.source;
    if (s?.width && s?.height) setRatio(clampRatio(s.width, s.height));
  };
  const image = (
    <Image source={{ uri }} style={{ width: '100%', aspectRatio: ratio }} resizeMode="contain" accessibilityLabel={label} onLoad={load} />
  );
  // On the home card the whole card is the button (it opens the outlook page), so the picture is just shown.
  if (onOpenCard) return <View style={styles.frame}>{image}</View>;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}. ${t('Open full screen')}`} style={[styles.frame, { marginTop: 14 }]}>
        {image}
        <View style={styles.hint} pointerEvents="none"><Text style={styles.hintText}>{t('Tap to zoom')}</Text></View>
      </Pressable>
      <Modal visible={open} animationType="fade" transparent={false} onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <ScrollView
            maximumZoomScale={5}
            minimumZoomScale={1}
            centerContent
            bouncesZoom
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ width, minHeight: height, alignItems: 'center', justifyContent: 'center' }}
          >
            <Image source={{ uri }} style={{ width, height: width / ratio }} resizeMode="contain" accessibilityLabel={label} />
          </ScrollView>
          <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={t('Close')} style={[styles.close, { top: insets.top + 10 }]}>
            <Text style={styles.closeText}>{t('Close')}</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#E6EEE0' },
  hint: { position: 'absolute', right: 10, bottom: 10, backgroundColor: 'rgba(23,48,31,0.7)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
  hintText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  close: { position: 'absolute', right: 16, minHeight: 44, minWidth: 64, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  closeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
