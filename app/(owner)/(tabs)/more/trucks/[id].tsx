import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useTrucks } from '@/hooks/useTrucks';
import { Card, StatusBadge, EmptyState, OptimizedImage, GlassIconButton } from '@/components/ui';
import { TruckPrivateSection } from '@/components/trucks/TruckPrivateSection';
import { PhotoPager } from '@/components/media/PhotoPager';
import { useIsOwner } from '@/data/truckFiles';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { TruckStatus } from '@/types/truck';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

const STATUS_MAP: Record<TruckStatus, { label: string; status: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
  available: { label: 'Available', status: 'success' },
  assigned: { label: 'Assigned', status: 'info' },
  maintenance: { label: 'Maintenance', status: 'warning' },
  out_of_service: { label: 'Out of Service', status: 'error' },
};

function DetailRow({ icon, label, value, colors }: { icon: string; label: string; value: string; colors: any }) {
  return (
    <View style={styles.detailRow}>
      <Icon name={icon as any} size={16} color={colors.textTertiary} />
      <Text style={[typeScale.caption, { color: colors.textTertiary, width: 70 }]}>{label}</Text>
      <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{value}</Text>
    </View>
  );
}

export default function TruckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { allTrucks } = useTrucks();
  const isOwner = useIsOwner();
  const [viewPhoto, setViewPhoto] = useState(false);

  const truck = allTrucks.find((t) => t.id === id);

  if (!truck) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Go back" />
        </View>
        <View style={styles.center}>
          <EmptyState icon="alert-circle" title="Vehicle not found" description="This truck or trailer may have been removed." />
        </View>
      </View>
    );
  }

  const badge = STATUS_MAP[truck.status];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Go back" />
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>{truck.name}</Text>
        <GlassIconButton icon="edit-2" onPress={() => router.push({ pathname: '/(owner)/more/trucks/edit', params: { id: truck.id } } as any)} accessibilityLabel="Edit this truck" />
      </View>

      <ScrollView bounces={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        {truck.photoUrl ? (
          <Pressable onPress={() => setViewPhoto(true)} accessibilityRole="button" accessibilityLabel="View photo">
            <OptimizedImage source={truck.photoUrl} style={styles.photo} />
          </Pressable>
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder, { backgroundColor: colors.backgroundTertiary }]}>
            <Icon name="truck" size={36} color={colors.textTertiary} />
          </View>
        )}

        <View style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
          <StatusBadge label={badge.label} status={badge.status} />
        </View>

        <Card title="Vehicle Info" style={styles.card}>
          {(truck.year || truck.make || truck.model) && (
            <DetailRow icon="truck" label="Vehicle" value={[truck.year, truck.make, truck.model].filter(Boolean).join(' ')} colors={colors} />
          )}
          {truck.licensePlate && <DetailRow icon="hash" label="Plate" value={truck.licensePlate} colors={colors} />}
          {truck.vin && <DetailRow icon="file-text" label="VIN" value={truck.vin} colors={colors} />}
          {truck.color && <DetailRow icon="droplet" label="Color" value={truck.color} colors={colors} />}
        </Card>

        {truck.assigneeName && (
          <Card title="Assignment" style={styles.card}>
            <DetailRow icon="user" label="Worker" value={truck.assigneeName} colors={colors} />
          </Card>
        )}

        {truck.notes && (
          <Card title="Notes" style={styles.card}>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{truck.notes}</Text>
          </Card>
        )}
        {isOwner && <TruckPrivateSection truckId={truck.id} />}
      </ScrollView>
      {truck.photoUrl ? <PhotoPager photos={[{ id: 'truck', url: truck.photoUrl }]} startId={viewPhoto ? 'truck' : null} onClose={() => setViewPhoto(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: radius.md,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { marginTop: spacing.lg },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
