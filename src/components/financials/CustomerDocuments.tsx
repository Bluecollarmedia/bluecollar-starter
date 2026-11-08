/**
 * Customer project → Overview: the project's quotes, change orders and
 * invoices that Brighton has sent. Anything waiting for the customer's
 * answer is shown first.
 */

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { ListSection } from '@/components/ui';
import { DocumentRow } from './DocumentRow';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useFinancialDocs } from '@/hooks/useFinancials';
import { displayStatus, DOC_LABEL } from '@/data/financials';
import { formatMoney } from '@/lib/money';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { FinancialDoc } from '@/types/financial';

/** Same rule as the database: customers never see drafts, and only issued invoices. */
export function customerCanSee(d: FinancialDoc): boolean {
  return d.kind === 'invoice' ? d.status === 'issued' : d.status !== 'draft';
}

export function CustomerDocuments({ projectId }: { projectId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const all = useFinancialDocs(projectId);
  const docs = useMemo(() => all.filter(customerCanSee), [all]);
  const waiting = docs.filter((d) => d.kind !== 'invoice' && displayStatus(d) === 'sent');
  if (docs.length === 0) return null;

  const open = (d: FinancialDoc) => router.push({ pathname: '/(customer)/document', params: { kind: d.kind, id: d.id } } as any);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      {waiting.map((d) => (
        <Pressable
          key={d.id}
          onPress={() => open(d)}
          style={[styles.callout, { backgroundColor: colors.surface }, shadow.sm]}
          accessibilityRole="button"
        >
          <View style={[styles.icon, { backgroundColor: colors.primarySurface }]}>
            <Icon name="file-text" size={18} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
              {t('{doc} {number} is ready for review', { doc: t(DOC_LABEL[d.kind]), number: d.number })}
            </Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{formatMoney(d.total)} · {t('Tap to review and approve')}</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textTertiary} />
        </Pressable>
      ))}
      <ListSection title={t('QUOTES & INVOICES')} style={{ marginBottom: 0 }}>
        {docs.map((d) => <DocumentRow key={d.id} doc={d} onPress={() => open(d)} />)}
      </ListSection>
    </View>
  );
}

const styles = StyleSheet.create({
  callout: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.xl, marginBottom: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
