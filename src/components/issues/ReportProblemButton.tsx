import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon, PressableScale } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { IssueWhere } from '@/data/issues';
import { useT } from '@/i18n';

/** Outlined "Report a Problem" button for a worker's property/job screens. */
export function ReportProblemButton({ where }: { where: IssueWhere }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const params = 'maintenancePropertyId' in where
    ? { maintenancePropertyId: where.maintenancePropertyId }
    : { projectId: where.projectId };
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/(worker)/report-issue', params } as any)}
      accessibilityRole="button"
      accessibilityLabel={t('Report a problem')}
      style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
    >
      <Icon name="alert-triangle" size={18} color={colors.warning} />
      <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{t('Report a Problem')}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    height: 48, borderRadius: radius.full, borderWidth: 1.5,
  },
});
