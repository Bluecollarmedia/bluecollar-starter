/**
 * Project Detail → More → Financials: the project's approved amount and its
 * full history of quotes, change orders and invoices.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { Button, ListSection, InlineNotice } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useFinancialDocs } from '@/hooks/useFinancials';
import { DocumentRow } from './DocumentRow';
import { FinancialSummaryCard } from './FinancialSummaryCard';
import { ProspectBanner } from './ProspectBanner';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import type { FinancialDocType } from '@/types/financial';

const TABS: { kind: FinancialDocType; label: string; create: string; empty: string }[] = [
  { kind: 'quote', label: 'Quotes', create: 'New Quote', empty: 'No quotes yet. Create one to price the work for this project.' },
  { kind: 'change_order', label: 'Change Orders', create: 'New Change Order', empty: 'No change orders. Add one when the scope changes after the quote is approved.' },
  { kind: 'invoice', label: 'Invoices', create: 'New Invoice', empty: 'No invoices yet. Create one from the approved quote and approved changes.' },
];

export function ProjectFinancials({ projectId }: { projectId: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const docs = useFinancialDocs(projectId);
  const [tab, setTab] = useState(0);
  const current = TABS[tab];
  const list = useMemo(() => docs.filter((d) => d.kind === current.kind), [docs, current.kind]);
  const hasApprovedQuote = docs.some((d) => d.kind === 'quote' && d.status === 'approved');
  const needsApprovedQuote = current.kind !== 'quote' && !hasApprovedQuote;

  const open = (kind: FinancialDocType, id: string) =>
    router.push({ pathname: '/(owner)/document', params: { kind, id } } as any);
  const create = () =>
    router.push({ pathname: '/(owner)/document-new', params: { kind: current.kind, projectId } } as any);

  return (
    <View style={styles.wrap}>
      <ProspectBanner projectId={projectId} />
      <FinancialSummaryCard projectId={projectId} />

      <SegmentedControl
        values={TABS.map((t) => t.label)}
        selectedIndex={tab}
        onChange={(e) => setTab(e.nativeEvent.selectedSegmentIndex)}
        tintColor={colors.primary}
        appearance="light"
        backgroundColor={colors.backgroundTertiary}
        fontStyle={{ color: colors.textSecondary }}
        activeFontStyle={{ color: '#FFFFFF', fontWeight: '600' }}
        style={styles.segment}
      />

      {list.length > 0 ? (
        <ListSection>
          {list.map((d) => (
            <DocumentRow key={d.id} doc={d} onPress={() => open(d.kind, d.id)} />
          ))}
        </ListSection>
      ) : (
        <Text style={[typeScale.bodySmall, styles.empty, { color: colors.textSecondary }]}>{current.empty}</Text>
      )}

      {needsApprovedQuote ? (
        <InlineNotice
          icon="info"
          tone="neutral"
          text={current.kind === 'invoice'
            ? 'Invoices are built from an approved quote. Approve a quote first.'
            : 'Change orders are added to an approved quote. Approve a quote first.'}
        />
      ) : (
        <Button title={current.create} icon="plus" onPress={create} fullWidth />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg },
  segment: { height: 34 },
  empty: { textAlign: 'center', paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
});
