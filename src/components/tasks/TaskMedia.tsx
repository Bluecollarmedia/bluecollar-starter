/**
 * Task photos and videos: a row of thumbnails (with an optional "Add" tile and
 * remove buttons) and a full-screen viewer that plays videos.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Icon, OptimizedImage } from '@/components/ui';
import { VideoThumb } from '@/components/media/VideoThumb';
import { MediaJobOverlay } from '@/components/media/MediaJobOverlay';
import { db } from '@/data/store';
const isDemoMode = () => !!db.demo;
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { useT, tr } from '@/i18n';

export interface TaskMediaItem {
  key: string;
  uri: string;
  mediaType: 'image' | 'video';
}

const TILE = 76;

/** "2 photos", "1 video", "1 photo, 1 video". */
export function taskMediaLabel(items: { mediaType: 'image' | 'video' }[]): string {
  const photos = items.filter(i => i.mediaType === 'image').length;
  const videos = items.length - photos;
  const parts: string[] = [];
  if (photos) parts.push(photos === 1 ? tr('1 photo') : tr('{n} photos', { n: photos }));
  if (videos) parts.push(videos === 1 ? tr('1 video') : tr('{n} videos', { n: videos }));
  return parts.join(', ');
}

interface TaskMediaStripProps {
  items: TaskMediaItem[];
  onOpen: (index: number) => void;
  /** Shows an "Add" tile when given. */
  onAdd?: () => void;
  /** Shows a remove button on each tile when given. */
  onRemove?: (key: string) => void;
  /** The items are drafts that have not been saved yet (a task being created): no "Not saved" warning, there is nothing to save yet. */
  drafts?: boolean;
}

export function TaskMediaStrip({ items, onOpen, onAdd, onRemove, drafts }: TaskMediaStripProps) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <View style={styles.strip}>
      {items.map((item, i) => (
        <View key={item.key}>
          <Pressable
            onPress={() => onOpen(i)}
            style={[styles.tile, { backgroundColor: item.mediaType === 'video' ? '#1B3A2D' : colors.backgroundTertiary }]}
            accessibilityRole="button"
            accessibilityLabel={item.mediaType === 'video' ? t('Play video') : t('View photo')}
          >
            {item.mediaType === 'image' ? (
              <OptimizedImage source={item.uri} style={styles.tileImage} />
            ) : (
              <>
                <VideoThumb uri={item.uri} />
                <View style={styles.playCircle}>
                  <Icon name="play" size={18} color="#FFFFFF" />
                </View>
              </>
            )}
            {/* Still a local file? Says Preparing / Uploading / Not saved (Retry) so a preview is never mistaken for a saved file. */}
            {drafts ? null : <MediaJobOverlay rowId={item.key} localOnly={!/^https?:\/\//i.test(item.uri) && !/^(data|blob):/i.test(item.uri) && !isDemoMode()} />}
          </Pressable>
          {onRemove && (
            <Pressable
              onPress={() => onRemove(item.key)}
              hitSlop={8}
              style={[styles.removeButton, { backgroundColor: colors.textPrimary }]}
              accessibilityRole="button"
              accessibilityLabel={t('Remove')}
            >
              <Icon name="x" size={12} color={colors.background} />
            </Pressable>
          )}
        </View>
      ))}
      {onAdd && (
        <Pressable
          onPress={onAdd}
          style={[styles.tile, styles.addTile, { borderColor: colors.primary, backgroundColor: colors.primarySurface }]}
          accessibilityRole="button"
          accessibilityLabel={t('Add photo or video')}
        >
          <Icon name="camera" size={20} color={colors.primary} />
          <Text style={[typeScale.caption, { color: colors.primary, marginTop: 2, fontWeight: '600' }]}>{t('Add')}</Text>
        </Pressable>
      )}
    </View>
  );
}

interface TaskMediaViewerProps {
  items: TaskMediaItem[];
  /** Which item is open; null hides the viewer. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export function TaskMediaViewer({ items, index, onIndexChange, onClose }: TaskMediaViewerProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const current = index != null ? items[index] : undefined;
  const areaHeight = height - insets.top - insets.bottom - 140;

  return (
    <Modal visible={!!current} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <View style={[styles.viewerHeader, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.viewerButton} accessibilityRole="button" accessibilityLabel={t('Close')}>
            <Icon name="x" size={22} color="#FFFFFF" />
          </Pressable>
          {items.length > 1 && index != null && (
            <Text style={[typeScale.bodyLarge, { color: '#FFFFFF' }]}>{t('{n} of {total}', { n: index + 1, total: items.length })}</Text>
          )}
          <View style={{ width: 38 }} />
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {current?.mediaType === 'image' && (
            <OptimizedImage source={current.uri} style={{ width, height: areaHeight }} contentFit="contain" />
          )}
          {current?.mediaType === 'video' && (
            <VideoPlayerView key={current.key} uri={current.uri} width={width} height={areaHeight} />
          )}
        </View>

        {items.length > 1 && index != null && (
          <View style={[styles.viewerNav, { paddingBottom: insets.bottom + spacing.md }]}>
            <Pressable
              onPress={() => onIndexChange(Math.max(0, index - 1))}
              disabled={index === 0}
              style={[styles.viewerButton, index === 0 && { opacity: 0.3 }]}
              accessibilityRole="button"
              accessibilityLabel={t('Previous')}
            >
              <Icon name="chevron-left" size={22} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={() => onIndexChange(Math.min(items.length - 1, index + 1))}
              disabled={index === items.length - 1}
              style={[styles.viewerButton, index === items.length - 1 && { opacity: 0.3 }]}
              accessibilityRole="button"
              accessibilityLabel={t('Next')}
            >
              <Icon name="chevron-right" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function VideoPlayerView({ uri, width, height }: { uri: string; width: number; height: number }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ width, height }}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
    />
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileImage: { width: TILE, height: TILE },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  removeButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { flex: 1, backgroundColor: '#000' },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  viewerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNav: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingTop: spacing.md,
  },
});
