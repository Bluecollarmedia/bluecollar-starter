/**
 * Customer view of a quote, change order or invoice: the finished document,
 * a clear Approve action when it's waiting on them, and the PDF to save or
 * share. Approval records who and when; it isn't an e-signature.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyState, LoadingSpinner, StatusBadge } from '@/components/ui';
import { DocumentPreview } from '@/components/financials/DocumentPreview';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { customerCanSee } from '@/components/financials/CustomerDocuments';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useFinancialDoc } from '@/hooks/useFinancials';
import { db } from '@/data/store';
import { usePdfShare } from '@/hooks/usePdfShare';
import { renderDocumentHtml, formatDocDateTime } from '@/lib/documentHtml';
import { formatMoney } from '@/lib/money';
import { DOC_LABEL, STATUS_LABEL, STATUS_TONE, displayStatus, snapshotFor, templateOptionsFor, respondAsCustomer } from '@/data/financials';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import type { FinancialDocType } from '@/types/financial';

export default function CustomerDocumentScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: FinancialDocType; id: string }>();
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { doc, events, ready } = useFinancialDoc(kind, id);
  const { share, busy } = usePdfShare();
  const [responding, setResponding] = useState<'approve' | 'decline' | null>(null);

  const html = useMemo(
    () => (doc ? renderDocumentHtml(doc, snapshotFor(doc), { mode: 'preview', ...templateOptionsFor(doc), hideApprovalHint: true }) : ''),
    [doc, events],
  );

  const header = (title: string) => (
    <View style={[styles.topBar, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('Go back')}>
        <Icon name="chevron-left" size={24} color={colors.textPrimary} />
      </Pressable>
      <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]} numberOfLines={1}>{title}</Text>
      {doc && customerCanSee(doc) ? (
        <Pressable onPress={() => share(doc)} hitSlop={12} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('Save or share PDF')} disabled={busy}>
          <Icon name="share-2" size={20} color={busy ? colors.textTertiary : colors.primary} />
        </Pressable>
      ) : <View style={styles.iconBtn} />}
    </View>
  );

  if (!doc || !customerCanSee(doc)) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        {header('')}
        {ready ? <EmptyState icon="file-text" title={t('Document not available')} /> : <LoadingSpinner />}
      </View>
    );
  }

  const label = t(DOC_LABEL[doc.kind]);
  const status = displayStatus(doc);
  const canAnswer = doc.kind !== 'invoice' && status === 'sent';
  const answered = [...events].reverse().find((e) => e.eventType === 'approved' || e.eventType === 'declined');

  const companyName = db.company?.name ?? 'Brighton Lawn + Landscape';

  const respond = (approve: boolean) => {
    if (doc.kind === 'invoice') return;
    const docKind = doc.kind;
    confirmAction(
      approve ? t('Approve {doc} {number}?', { doc: label.toLowerCase(), number: doc.number }) : t('Decline {doc} {number}?', { doc: label.toLowerCase(), number: doc.number }),
      approve
        ? t("You're approving the work and pricing shown, {total} total. {company} will be notified.", { total: formatMoney(doc.total), company: companyName })
        : t('{company} will be notified. You can message them with any questions.', { company: companyName }),
      approve ? t('Approve') : t('Decline'),
      async () => {
        setResponding(approve ? 'approve' : 'decline');
        const { error } = await respondAsCustomer(docKind, doc.id, approve);
        setResponding(null);
        if (error) showMessage(t('Not saved'), t(error));
      },
      !approve,
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {header(`${label} ${doc.number}`)}

      <View style={[styles.summary, { borderBottomColor: colors.separator }]}>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{doc.kind === 'invoice' ? t('Total due') : t('Total')}</Text>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>{formatMoney(doc.total)}</Text>
        </View>
        <StatusBadge label={t(STATUS_LABEL[status])} status={STATUS_TONE[status]} />
      </View>

      <View style={{ flex: 1 }}>
        <DocumentPreview html={html} />
      </View>

      <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.separator, paddingBottom: insets.bottom + spacing.sm }]}>
        {canAnswer ? (
          <>
            <Text style={[typeScale.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
              {t('Your answer is recorded with the date and time.')}
            </Text>
            <View style={styles.row}>
              <Button title={t('Decline')} variant="ghost" onPress={() => respond(false)} loading={responding === 'decline'} disabled={!!responding} style={{ flex: 1 }} />
              <Button title={t('Approve')} icon="check" onPress={() => respond(true)} loading={responding === 'approve'} disabled={!!responding} style={{ flex: 2 }} />
            </View>
          </>
        ) : (
          <>
            {answered && (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>
                {answered.eventType === 'approved' ? t('Approved') : t('Declined')} {formatDocDateTime(answered.createdAt)}
              </Text>
            )}
            {status === 'expired' && (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>
                {t('This quote has expired. Message us for an updated quote.')}
              </Text>
            )}
            <Button title={t('Save or Share PDF')} icon="share-2" variant="secondary" onPress={() => share(doc)} loading={busy} fullWidth />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: spacing.sm },
});
