import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge } from '@/components/ui';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { formatMoney } from '@/lib/money';
import { formatDocDate } from '@/lib/documentHtml';
import { displayStatus, docDate, STATUS_LABEL, STATUS_TONE } from '@/data/financials';
import type { FinancialDoc, FinancialDocType } from '@/types/financial';

export const DOC_ICON: Record<FinancialDocType, 'file-text' | 'layers' | 'dollar-sign'> = {
  quote: 'file-text',
  change_order: 'layers',
  invoice: 'dollar-sign',
};

interface Props {
  doc: FinancialDoc;
  onPress: () => void;
  /** Show the project/customer line (company-wide lists). */
  showProject?: boolean;
  /** Makes the project name open the project. */
  onProjectPress?: () => void;
}

/** One quote / change order / invoice in a list: number, who, date, total, status. */
export function DocumentRow({ doc, onPress, showProject, onProjectPress }: Props) {
  const t = useT();
  const { colors } = useTheme();
  const status = displayStatus(doc);
  const customer = doc.customer ? `${doc.customer.firstName} ${doc.customer.lastName}`.trim() : '';
  const subtitle = showProject
    ? [doc.projectName, customer].filter(Boolean).join(' · ')
    : doc.kind === 'change_order' && doc.description ? doc.description : doc.title ?? '';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.backgroundSecondary }]}
      accessibilityRole="button"
      accessibilityLabel={`${doc.number}, ${t(STATUS_LABEL[status])}, ${formatMoney(doc.total)}`}
    >
      <View style={[styles.icon, { backgroundColor: colors.primarySurface }]}>
        <Icon name={DOC_ICON[doc.kind]} size={16} color={colors.primaryDark} />
      </View>
      <View style={styles.middle}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
          {doc.number}
        </Text>
        {showProject && onProjectPress && doc.projectName ? (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
            <Text onPress={onProjectPress} style={{ color: colors.primaryDark }} accessibilityRole="link">{doc.projectName}</Text>
            {customer ? ` · ${customer}` : ''}
          </Text>
        ) : !!subtitle && (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 1 }]}>
          {formatDocDate(docDate(doc))}
        </Text>
      </View>
      <View style={styles.right}>
        <StatusBadge label={t(STATUS_LABEL[status])} status={STATUS_TONE[status]} style={{ alignSelf: 'flex-end' }} />
        <Text
          style={[typeScale.bodyLarge, styles.total, { color: status === 'void' || status === 'declined' ? colors.textTertiary : colors.textPrimary }]}
          numberOfLines={1}
        >
          {formatMoney(doc.total)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end', gap: spacing.xs },
  total: { fontWeight: '600', fontVariant: ['tabular-nums'] },
});
