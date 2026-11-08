/**
 * Customer project Overview: a compact Billing card. It shows how many documents the company has made visible to the customer
 * (same rule as the database: no drafts, only issued invoices) and one status. Tapping opens the full list in place, and each row
 * opens the existing document screen. Renders nothing when there is nothing to show.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { DocumentRow } from './DocumentRow';
import { customerCanSee } from './CustomerDocuments';
import { useTheme } from '@/providers/ThemeProvider';
import { useFinancialDocs } from '@/hooks/useFinancials';
import { displayStatus } from '@/data/financials';
import { billingStatus, documentCountLabel } from '@/lib/customerOverview';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { FinancialDoc } from '@/types/financial';

export function CustomerBillingCard({ projectId }: { projectId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const all = useFinancialDocs(projectId);
  const docs = useMemo(() => all.filter(customerCanSee), [all]);
  const [open, setOpen] = useState(false);
  if (docs.length === 0) return null;

  const waiting = docs.filter((d) => d.kind !== 'invoice' && displayStatus(d) === 'sent').length;
  const issuedInvoices = docs.filter((d) => d.kind === 'invoice' && d.status === 'issued').length;
  const status = billingStatus({ waiting, issuedInvoices }, t);
  const openDoc = (d: FinancialDoc) => router.push({ pathname: '/(customer)/document', params: { kind: d.kind, id: d.id } } as any);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t('Billing')}. ${t('Invoices and quotes')}. ${documentCountLabel(docs.length, t)}${status ? `. ${status.label}` : ''}`}
        style={styles.head}
      >
        <Icon name="file-text" size={22} color={colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('Billing')}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 1 }]}>{t('Invoices & Quotes')} · {documentCountLabel(docs.length, t)}</Text>
        </View>
        {status && (
          <View style={[styles.pill, { backgroundColor: colors.infoLight }]}>
            <View style={[styles.dot, { backgroundColor: colors.info }]} />
            <Text style={[typeScale.caption, { color: colors.info, fontWeight: '700' }]}>{status.label}</Text>
          </View>
        )}
        <Icon name={open ? 'chevron-up' : 'chevron-right'} size={20} color={colors.textTertiary} />
      </Pressable>
      {open && (
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
          {docs.map((d) => <DocumentRow key={d.id} doc={d} onPress={() => openDoc(d)} />)}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
