import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { useProjectFinancialSummary } from '@/hooks/useFinancials';
import { formatMoney } from '@/lib/money';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

/** Original approved quote + approved change orders = approved amount.
 * Changes still waiting on the customer are shown apart and never added. */
export function FinancialSummaryCard({ projectId }: { projectId: string }) {
  const { colors } = useTheme();
  const s = useProjectFinancialSummary(projectId);

  const Row = ({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) => (
    <View style={styles.row}>
      <Text style={[strong ? typeScale.labelLarge : typeScale.bodySmall, { color: muted ? colors.textTertiary : strong ? colors.textPrimary : colors.textSecondary, flex: 1 }]}>
        {label}
      </Text>
      <Text style={[strong ? typeScale.headingSmall : typeScale.bodySmall, styles.num, { color: muted ? colors.textTertiary : colors.textPrimary }]}>
        {formatMoney(value)}
      </Text>
    </View>
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
      <Text style={[typeScale.overline, { color: colors.textTertiary, marginBottom: spacing.sm }]}>FINANCIAL SUMMARY</Text>
      <Row label="Original quote" value={s.originalQuote} />
      <Row label="Approved change orders" value={s.approvedChanges} />
      <View style={[styles.rule, { backgroundColor: colors.separator }]} />
      <Row label="Total approved amount" value={s.approvedTotal} strong />
      {s.pendingChanges > 0 && <Row label="Changes awaiting approval (not included)" value={s.pendingChanges} muted />}
      {s.invoiced > 0 && <Row label="Invoiced (issued)" value={s.invoiced} muted />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: spacing.md },
  num: { fontVariant: ['tabular-nums'] },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm },
});
