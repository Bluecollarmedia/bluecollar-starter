import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { TruckOptions } from '@/data/timeTracking';
import { useT } from '@/i18n';

/** "Which truck are you taking?": shown when clocking in and the owner has not assigned a truck. Shared by every Clock In. */
export function TruckPickSheet({ options, onPick, onClose }: { options: TruckOptions | null; onPick: (truckId?: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <BottomSheetModal visible={!!options} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center' }]}>{t('Which truck are you taking?')}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md }]}>{t('No truck has been assigned to you today.')}</Text>
          {options?.trucks.map((truck) => (
            <Pressable key={truck.id} disabled={truck.inUse} onPress={() => onPick(truck.id)} style={[styles.truckRow, { borderColor: colors.borderLight, opacity: truck.inUse ? 0.45 : 1 }]} accessibilityRole="button">
              <Feather name="truck" size={18} color={colors.textPrimary} />
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{truck.name}</Text>
              {truck.inUse ? <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{t('In use')}</Text> : null}
            </Pressable>
          ))}
          <Pressable onPress={() => onPick(undefined)} style={[styles.truckRow, { borderColor: colors.borderLight }]} accessibilityRole="button">
            <Feather name="slash" size={18} color={colors.textSecondary} />
            <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{t('No truck today')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing['3xl'] },
  truckRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
});
