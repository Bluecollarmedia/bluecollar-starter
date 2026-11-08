import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useTrucks } from '@/hooks/useTrucks';
import { StatusBadge, OptimizedImage, ScreenHeader, RaisedAddButton, IconTile, PressableScale } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { TruckStatus } from '@/types/truck';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { fixed } from '@/theme/colors';

const STATUS_MAP: Record<TruckStatus, { label: string; status: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
  available: { label: 'Available', status: 'success' },
  assigned: { label: 'Assigned', status: 'info' },
  maintenance: { label: 'Maintenance', status: 'warning' },
  out_of_service: { label: 'Out of Service', status: 'error' },
};

export default function TrucksScreen() {
  const tabBarClearance = useTabBarClearance();
  const { colors } = useTheme();
  const router = useRouter();
  const { trucks, counts } = useTrucks();

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader
        title="Trucks"
        subtitle="Manage your vehicles and equipment"
        right={
          <RaisedAddButton
            onPress={() => router.push('/(owner)/more/trucks/new' as any)}
            accessibilityLabel="Add truck"
          />
        }
      />

      <ScrollView bounces={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
            <IconTile name="truck" size={32} />
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{counts.all}</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Total</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
            <IconTile name="check" size={32} />
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{counts.available + counts.assigned}</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Ready</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
            <IconTile name="tool" size={32} />
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{counts.maintenance}</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Maintenance</Text>
          </View>
        </View>

        {trucks.map((truck, index) => {
          const badge = STATUS_MAP[truck.status];
          return (
            <View key={truck.id}>
              <PressableScale
                style={[styles.truckCard, { backgroundColor: colors.surface }]}
                scaleTo={0.97}
                onPress={() => router.push(`/(owner)/more/trucks/${truck.id}` as any)}
                accessibilityRole="button"
                accessibilityLabel={truck.name}
              >
                {truck.photoUrl ? (
                  <OptimizedImage source={truck.photoUrl} style={styles.truckPhoto} />
                ) : (
                  <View style={[styles.truckPhoto, styles.truckPhotoPlaceholder, { backgroundColor: colors.backgroundTertiary }]}>
                    <Icon name="truck" size={22} color={colors.textTertiary} />
                  </View>
                )}

                <View style={styles.truckInfo}>
                  <View style={styles.truckTopRow}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flexShrink: 1, marginRight: spacing.sm }]} numberOfLines={1}>
                      {truck.name}
                    </Text>
                    <StatusBadge label={badge.label} status={badge.status} />
                  </View>
                  {(truck.year || truck.make || truck.model) && (
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
                      {[truck.year, truck.make, truck.model].filter(Boolean).join(' ')}
                    </Text>
                  )}
                  {truck.licensePlate && (
                    <View style={[styles.plateChip, { backgroundColor: colors.backgroundTertiary }]}>
                      <Icon name="hash" size={10} color={colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 3 }]}>{truck.licensePlate}</Text>
                    </View>
                  )}
                  {truck.assigneeName && (
                    <View style={styles.detailRow}>
                      <Icon name="user" size={11} color={colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 4 }]} numberOfLines={1}>
                        Assigned to {truck.assigneeName}
                      </Text>
                    </View>
                  )}
                  {truck.notes && (
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2, fontStyle: 'italic' }]} numberOfLines={1}>
                      {truck.notes}
                    </Text>
                  )}
                </View>

                <Icon name="chevron-right" size={18} color={colors.textTertiary} />
              </PressableScale>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const cardShadow = Platform.select({
  android: { elevation: 2 },
  default: {
    shadowColor: fixed.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
})!;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: {
    flex: 1,
    alignItems: 'flex-start',
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.lg + 2,
    ...cardShadow,
  },
  truckCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.xl,
    padding: spacing.sm + 2,
    ...cardShadow,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  truckPhoto: {
    width: 76,
    height: 76,
    borderRadius: radius.md + 2,
  },
  truckPhotoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  truckInfo: { flex: 1, gap: 2 },
  truckTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  plateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.full,
    marginTop: 2,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
});
