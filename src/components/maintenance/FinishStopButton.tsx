/**
 * FINISH STOP — the primary action once the crew has arrived. Greyed out,
 * with a plain list of what's missing, until the checklist and photos are
 * done. Saving shows a spinner and ignores further taps.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, PressableScale } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useFinishingStop } from '@/data/maintenanceFinish';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { useT } from '@/i18n';

interface Props {
  stopId: string;
  /** From missingRequirements(); empty = ready. */
  missing: string[];
  onPress: () => void;
  /** Photos still uploading (shown as a wait, not as missing). */
  uploading?: number;
}

export function FinishStopButton({ stopId, missing, onPress, uploading = 0 }: Props) {
  const t = useT();
  const { colors } = useTheme();
  const saving = useFinishingStop(stopId);
  const ready = missing.length === 0 && !saving;

  return (
    <View>
      {missing.length > 0 && (
        <View style={[styles.missing, { backgroundColor: colors.warningLight }]} accessibilityLiveRegion="polite">
          <Text style={[typeScale.labelSmall, { color: colors.textPrimary, marginBottom: 2 }]}>{t('Before you finish')}</Text>
          {missing.map((m) => (
            <View key={m} style={styles.missingRow}>
              <Icon name="circle" size={6} color={colors.warning} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{m}</Text>
            </View>
          ))}
          {uploading > 0 && (
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>
              {uploading === 1 ? t('1 photo is still uploading.') : t('{n} photos are still uploading.', { n: uploading })}
            </Text>
          )}
        </View>
      )}
      <PressableScale
        onPress={onPress}
        disabled={!ready}
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel={t('Finish stop')}
        accessibilityState={{ disabled: !ready, busy: saving }}
      >
        <LinearGradient
          colors={ready || saving ? [colors.primary, colors.primary] : [colors.border, colors.border]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.button}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="check-circle" size={20} color={ready ? '#FFFFFF' : colors.textTertiary} />}
          <Text style={[typeScale.labelLarge, styles.label, { color: ready || saving ? '#FFFFFF' : colors.textTertiary }]}>
            {saving ? t('SAVING…') : t('FINISH STOP')}
          </Text>
        </LinearGradient>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm, gap: 3 },
  missingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, borderRadius: radius.full, gap: spacing.sm },
  label: { letterSpacing: 0.6, fontWeight: '800' },
});
