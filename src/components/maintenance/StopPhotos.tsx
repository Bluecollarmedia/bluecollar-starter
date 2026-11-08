/**
 * Photos for one maintenance visit. Every photo is internal (company only):
 * the database refuses a crew upload marked customer-visible, so a worker's
 * photo never reaches a customer on its own. Uploads run in the background
 * and don't count toward the requirement until they've finished.
 */

import { PhotoPager } from '@/components/media/PhotoPager';
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import { Icon, PressableScale } from '@/components/ui';
import { MediaJobOverlay } from '@/components/media/MediaJobOverlay';
import { PrivatePhoto } from '@/components/media/PrivatePhoto';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import { removeStopPhoto } from '@/data/maintenance';
import { pickStopPhotos } from '@/lib/stopPhotoPicker';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { useT } from '@/i18n';
import type { MaintenancePhoto } from '@/types/maintenance';

interface Props {
  stopId: string;
  photos: MaintenancePhoto[];
  requiresPhotos: boolean;
  minPhotos: number;
  locked: boolean;
}

const isUploaded = (p: MaintenancePhoto) => db.demo || /^https?:\/\//i.test(p.fileUrl);

export function StopPhotos({ stopId, photos, requiresPhotos, minPhotos, locked }: Props) {
  const t = useT();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const saved = photos.filter(isUploaded).length;
  const staff = db.role === 'owner' || db.role === 'admin';

  function confirm(title: string, message: string, action: string, run: () => void) {
    Alert.alert(title, message, [{ text: t('Cancel'), style: 'cancel' }, { text: action, style: 'destructive', onPress: run }]);
  }

  function handleAdd() {
    if (Platform.OS === 'web') return pick('library');
    Alert.alert(t('Add Photo'), undefined, [
      { text: t('Take Photo'), onPress: () => pick('camera') },
      { text: t('Choose from Library'), onPress: () => pick('library') },
      { text: t('Cancel'), style: 'cancel' },
    ]);
  }

  async function pick(source: 'camera' | 'library') {
    setBusy(true);
    try {
      await pickStopPhotos(stopId, source);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flex: 1 }]}>
          {requiresPhotos
            ? (minPhotos === 1 ? t('{done} of 1 required photo', { done: Math.min(saved, minPhotos) }) : t('{done} of {total} required photos', { done: Math.min(saved, minPhotos), total: minPhotos }))
            : photos.length ? (photos.length === 1 ? t('1 photo') : t('{n} photos', { n: photos.length })) : t('Photos are optional here')}
        </Text>
        <View style={[styles.internalPill, { backgroundColor: colors.backgroundTertiary }]}>
          <Icon name="lock" size={11} color={colors.textSecondary} />
          <Text style={[typeScale.caption, { color: colors.textSecondary, fontWeight: '600' }]}>{t('Company only')}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        {photos.map((p) => {
          const uploading = !isUploaded(p);
          // The owner (and admins) can always delete a photo; a worker can delete their own until the stop is finished.
          const canRemove = staff || (!locked && p.uploadedBy === db.personId);
          return (
            <View key={p.id} style={[styles.tile, { backgroundColor: colors.groupedBackground }]}>
              <PrivatePhoto plain fileUrl={p.fileUrl} fileKey={p.fileKey} style={StyleSheet.absoluteFill as never} />
              {!uploading && (
                <PressableScale onPress={() => setViewing(p.id)} accessibilityRole="button" accessibilityLabel={t('Open photo')} style={StyleSheet.absoluteFill as never}>
                  <View style={StyleSheet.absoluteFill} />
                </PressableScale>
              )}
              {uploading && <MediaJobOverlay rowId={p.id} localOnly />}
              {canRemove && !uploading && (
                <PressableScale
                  onPress={() => confirm(t('Remove photo?'), t('It will be deleted from this stop.'), t('Remove'), () => removeStopPhoto(p.id))}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('Remove photo')}
                  style={styles.remove}
                >
                  <Icon name="x" size={14} color="#FFFFFF" />
                </PressableScale>
              )}
            </View>
          );
        })}
        {!locked && (
          <PressableScale
            onPress={handleAdd}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('Add photo')}
            style={[styles.tile, styles.addTile, { borderColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
          >
            {busy ? <ActivityIndicator color={colors.primary} /> : <Icon name="camera" size={22} color={colors.primary} />}
            <Text style={[typeScale.caption, { color: colors.primary, fontWeight: '700', marginTop: 4 }]}>{t('Add photo')}</Text>
          </PressableScale>
        )}
      </View>
      <PhotoPager
        photos={photos.filter(isUploaded).map((p) => ({ id: p.id, url: p.fileUrl, key: p.fileKey }))}
        startId={viewing}
        onClose={() => setViewing(null)}
        actionsFor={(ph) => {
          const p = photos.find((x) => x.id === ph.id);
          return p && (staff || (!locked && p.uploadedBy === db.personId))
            ? [{ key: 'delete', label: t('Delete'), icon: 'trash-2', destructive: true, onPress: () => confirm(t('Remove photo?'), t('It will be deleted from this stop.'), t('Remove'), () => removeStopPhoto(p.id)) }]
            : [];
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  internalPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  addTile: { borderWidth: 1.5, borderStyle: 'dashed' },
  uploading: { backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  remove: {
    position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(20,20,20,0.65)', alignItems: 'center', justifyContent: 'center',
  },
});
