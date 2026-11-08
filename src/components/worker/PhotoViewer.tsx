import React from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { OptimizedImage } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import type { ProjectPhoto } from '@/types/project';
import { useT } from '@/i18n';
import { fixed, whiteAlpha } from '@/theme/colors';

interface PhotoViewerProps {
  photos: ProjectPhoto[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  insets: { top: number; bottom: number };
}

export function PhotoViewer({ photos, index, onIndexChange, onClose, insets }: PhotoViewerProps) {
  const t = useT();
  const { width, height } = useWindowDimensions();
  const current = photos[index];
  const imageAreaHeight = height - insets.top - insets.bottom - 120;

  return (
    <View style={styles.backdrop}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
          <Feather name="x" size={22} color={fixed.white} />
        </Pressable>
        {photos.length > 1 && (
          <Text style={[typeScale.bodyMedium, { color: fixed.white }]}>
            {t('{n} of {total}', { n: index + 1, total: photos.length })}
          </Text>
        )}
        <View style={{ width: 38 }} />
      </View>

      <FlatList
        data={photos}
        keyExtractor={p => p.id}
        style={{ flex: 1 }}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={(e) => {
          onIndexChange(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
        scrollEventThrottle={32}
        renderItem={({ item }) => (
          <View style={{ width, height: imageAreaHeight, alignItems: 'center', justifyContent: 'center' }}>
            <OptimizedImage source={item.fileUrl} style={{ width, height: imageAreaHeight }} contentFit="contain" />
          </View>
        )}
      />

      {current?.caption && (
        <View style={[styles.caption, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={[typeScale.bodySmall, { color: whiteAlpha(0.85) }]}>{current.caption}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: fixed.black },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: whiteAlpha(0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    alignItems: 'center',
  },
});
