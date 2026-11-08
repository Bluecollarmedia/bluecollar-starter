import { useFileAddress } from '@/lib/privateMedia';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, FlatList, View, Text, Pressable, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export interface PagerPhoto { id: string; url: string; /** For a private photo: the stored key, opened through a short-lived link. */ key?: string }

function PagerImage({ photo }: { photo: PagerPhoto }) {
  const uri = useFileAddress(photo.url, photo.key);
  return uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Photo" /> : null;
}
export interface PagerAction { key: string; label: string; icon: React.ComponentProps<typeof Icon>['name']; destructive?: boolean; onPress: () => void }

/**
 * Full-screen photos: tap a picture to open it, swipe left and right for the others, tap X to close. `actionsFor` gives the buttons for the
 * photo on screen (Approve, Hide, Delete...). The list is read live, so when a photo is deleted the pager moves on to the next one and closes
 * itself when none are left.
 */
export function PhotoPager({ photos, startId, onClose, actionsFor }: {
  photos: PagerPhoto[];
  startId: string | null;
  onClose: () => void;
  actionsFor?: (photo: PagerPhoto) => PagerAction[];
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<PagerPhoto>>(null);
  const [index, setIndex] = useState(0);
  const open = startId != null && photos.length > 0;

  useEffect(() => {
    if (startId == null) return;
    const i = Math.max(0, photos.findIndex((p) => p.id === startId));
    setIndex(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startId]);

  useEffect(() => {
    if (startId != null && photos.length === 0) onClose();
    else if (index >= photos.length && photos.length > 0) setIndex(photos.length - 1);
  }, [photos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const current = photos[Math.min(index, photos.length - 1)];
  const actions = current && actionsFor ? actionsFor(current) : [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <FlatList
          ref={listRef}
          data={photos}
          horizontal
          pagingEnabled
          keyExtractor={(p) => p.id}
          initialScrollIndex={Math.min(index, photos.length - 1)}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={Platform.OS === 'web'}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <View style={{ width, height }}>
              <PagerImage photo={item} />
            </View>
          )}
        />
        <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Icon name="x" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>{Math.min(index, photos.length - 1) + 1} / {photos.length}</Text>
          <View style={{ width: 40 }} />
        </View>
        {actions.length ? (
          <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
            {actions.map((a) => (
              <Pressable key={a.key} onPress={a.onPress} accessibilityRole="button" accessibilityLabel={a.label} style={styles.action}>
                <Icon name={a.icon} size={22} color={a.destructive ? '#FF6B6B' : '#FFFFFF'} />
                <Text style={[typeScale.caption, { color: a.destructive ? '#FF6B6B' : '#FFFFFF' }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  close: { width: 40, height: 40, borderRadius: radius.full, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around', paddingTop: spacing.md, backgroundColor: 'rgba(0,0,0,0.55)' },
  action: { alignItems: 'center', gap: 2, minWidth: 64 },
});
