/**
 * Customer: Maintenance updates. Finished visits to their property, newest
 * first, with the services done and only the photos the owner shared.
 */
import { PhotoPager } from '@/components/media/PhotoPager';
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, InlineNotice, LoadingSpinner, ScreenHeader } from '@/components/ui';
import { PrivatePhoto } from '@/components/media/PrivatePhoto';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import {
  loadCustomerMaintenanceUpdates, loadMyMaintenanceProperties,
  type CustomerMaintenanceUpdate, type MyMaintenanceProperty,
} from '@/data/maintenanceCustomer';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function CustomerMaintenanceUpdatesScreen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [updates, setUpdates] = useState<CustomerMaintenanceUpdate[]>([]);
  const [viewing, setViewing] = useState<{ stopId: string; photoId: string } | null>(null);
  const [properties, setProperties] = useState<MyMaintenanceProperty[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [res, props] = await Promise.all([loadCustomerMaintenanceUpdates(), loadMyMaintenanceProperties()]);
    setLoading(false);
    if (props.ok) setProperties(props.data);
    if (!res.ok) return setError(res.error);
    setError(null);
    setUpdates(res.data);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title={t('Maintenance updates')} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['2xl'] }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        {error ? <InlineNotice icon="alert-circle" tone="error" text={t(error)} style={{ marginBottom: spacing.md }} /> : null}
        {properties.length ? (
          <View style={{ marginBottom: spacing.lg, gap: spacing.xs }}>
            <Text style={[typeScale.overline, { color: colors.textSecondary, marginLeft: spacing.sm }]}>{t('YOUR PROPERTIES')}</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, gap: spacing.sm }]}>
              {properties.map((p) => (
                <View key={p.id}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{p.name}</Text>
                  {p.address ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{p.address}</Text> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {loading ? <LoadingSpinner /> : !updates.length ? (
          <EmptyState icon="repeat" title={t('No maintenance visits yet')} description={t("After each visit to your property you'll see it here, with photos when we've shared them.")} />
        ) : updates.map((u) => (
          <View key={u.stopId} style={[styles.card, { backgroundColor: colors.surface, marginBottom: spacing.md, gap: spacing.sm }]}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{u.services || t('Maintenance visit')}</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{u.propertyName} · {when(u.completedAt)}</Text>
            {u.photos.length ? (
              <View style={styles.thumbs}>
                {u.photos.map((p) => (
                  <Pressable key={p.id} onPress={() => setViewing({ stopId: u.stopId, photoId: p.id })} accessibilityRole="button" accessibilityLabel={t('Open photo')}>
                    <PrivatePhoto fileUrl={p.url} fileKey={p.key} style={styles.thumb as never} accessibilityLabel={t('Photo from your visit')} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
      <PhotoPager photos={(updates.find((u) => u.stopId === viewing?.stopId)?.photos ?? []).map((p) => ({ id: p.id, url: p.url, key: p.key }))} startId={viewing?.photoId ?? null} onClose={() => setViewing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden' },
});
