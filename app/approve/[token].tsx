/**
 * Public approval page: …/approve/<token>
 *
 * The owner texts or emails this link. The customer opens it in any browser
 * (no app, no login), reads the quote or change order, types their name and
 * approves, or declines. The answer goes straight into the database
 * (respond_by_link), which updates the owner's app and alerts the owner by
 * push and email. Name, time, IP address and browser are recorded.
 *
 * The token only opens this one document. Drafts are never shown.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, Input, EmptyState, LoadingSpinner, StatusBadge } from '@/components/ui';
import { DocumentPreview } from '@/components/financials/DocumentPreview';
import { SignaturePad } from '@/components/financials/SignaturePad';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { renderDocumentHtml, formatDocDateTime } from '@/lib/documentHtml';
import { buildPdf } from '@/lib/pdf';
import { formatMoney } from '@/lib/money';
import { DOC_LABEL, STATUS_LABEL, STATUS_TONE, displayStatus } from '@/data/financials';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { FinancialDoc, FinancialEvent, DocumentSnapshot } from '@/types/financial';

interface Shared {
  doc: FinancialDoc;
  quoteNumber?: string;
  events: FinancialEvent[];
}

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** The RPC returns database (snake_case) rows; the template uses app shapes. */
function toShared(raw: any): Shared | null {
  if (!raw?.document) return null;
  const d: Record<string, unknown> = { kind: raw.kind, projectName: raw.project_name ?? undefined };
  for (const [k, v] of Object.entries(raw.document)) d[camel(k)] = v ?? undefined;
  for (const k of ['taxRate', 'subtotal', 'taxAmount', 'total']) d[k] = Number(d[k] ?? 0);
  d.lineItems = Array.isArray(d.lineItems) ? d.lineItems : [];
  const events: FinancialEvent[] = (raw.events ?? []).map((e: any, i: number) => ({
    id: String(i),
    companyId: '',
    projectId: '',
    documentType: raw.kind,
    documentId: String(d.id),
    eventType: e.event_type,
    createdAt: e.created_at,
    actor: e.name ? { id: '', firstName: e.name, lastName: '' } : undefined,
  }));
  return { doc: d as unknown as FinancialDoc, quoteNumber: raw.quote_number ?? undefined, events };
}

const RESPONSE_ERRORS: Record<string, string> = {
  not_found: 'This link isn’t valid any more.',
  not_open: 'This was already answered.',
  expired: 'This quote has expired. Please contact us for an updated quote.',
  name_required: 'Please type your full name to approve.',
  bad_signature: 'That signature could not be saved. Clear it and sign again.',
};

export default function ApprovePage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [shared, setShared] = useState<Shared | null>(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState('');
  const [declining, setDeclining] = useState(false);
  // The quote comes first: the name / signature form only opens when the customer taps Review & Approve.
  const [formOpen, setFormOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !token) {
      setState('missing');
      return;
    }
    const { data, error: e } = await supabase.rpc('get_shared_document', { p_token: token });
    const s = e ? null : toShared(data);
    setShared(s);
    setState(s ? 'ready' : 'missing');
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (Platform.OS === 'web' && shared) {
      document.title = `${t(DOC_LABEL[shared.doc.kind])} ${shared.doc.number} · ${shared.doc.snapshot?.company.name ?? 'Brighton Lawn + Landscape'}`;
    }
  }, [shared, t]);

  const snapshot: DocumentSnapshot | null = shared?.doc.snapshot ?? null;
  const html = useMemo(() => {
    if (!shared || !snapshot) return '';
    return renderDocumentHtml(shared.doc, snapshot, {
      mode: 'preview',
      linkedQuoteNumber: shared.quoteNumber,
      events: shared.events,
      hideApprovalHint: true,
    });
  }, [shared, snapshot]);

  if (state !== 'ready' || !shared || !snapshot) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        {state === 'loading' ? (
          <LoadingSpinner />
        ) : (
          <EmptyState
            icon="file-text"
            title={t('This link isn’t available')}
            description={t('It may have been replaced by a newer version. Please contact Brighton Lawn + Landscape for an updated link.')}
          />
        )}
      </View>
    );
  }

  const { doc } = shared;
  const label = t(DOC_LABEL[doc.kind]);
  const status = displayStatus(doc);
  const company = snapshot.company;
  const canAnswer = doc.kind !== 'invoice' && status === 'sent';
  const answer = [...shared.events].reverse().find((e) => e.eventType === 'approved' || e.eventType === 'declined');
  const answeredBy = answer?.actor?.firstName;
  const nameOk = name.trim().length >= 2;
  const signed = signature.length > 0;

  const respond = async (approve: boolean) => {
    setError(null);
    setSaving(approve ? 'approve' : 'decline');
    const { data, error: e } = await supabase.rpc('respond_by_link', {
      p_token: token,
      p_approve: approve,
      p_name: name.trim(),
      p_note: approve ? null : reason.trim() || null,
      p_signature: approve ? signature || null : null,
    });
    setSaving(null);
    const res = data as { success?: boolean; error?: string } | null;
    if (e || !res?.success) {
      setError(t(RESPONSE_ERRORS[res?.error ?? ''] ?? 'Something went wrong. Please try again.'));
      if (res?.error === 'not_open') load();
      return;
    }
    setDeclining(false);
    await load();
  };

  const savePdf = async () => {
    setPdfBusy(true);
    try {
      await buildPdf(doc, snapshot, { linkedQuoteNumber: shared.quoteNumber, events: shared.events, hideApprovalHint: true });
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground, paddingTop: insets.top }]}>
      <View style={[styles.summary, { backgroundColor: colors.surface, borderBottomColor: colors.separator }]}>
        <View style={[styles.inner, styles.summaryRow]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
              {company.name} · {label} {doc.number}
            </Text>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>{formatMoney(doc.total)}</Text>
          </View>
          <StatusBadge label={t(STATUS_LABEL[status])} status={STATUS_TONE[status]} />
        </View>
      </View>

      <View style={styles.flex}>
        <DocumentPreview html={html} />
      </View>

      <ScrollView bounces={false}
        style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.separator }]}
        contentContainerStyle={[styles.inner, styles.barContent, { paddingBottom: insets.bottom + spacing.md }]}
        keyboardShouldPersistTaps="handled"
      >
        {canAnswer && !declining && !formOpen && (
          <>
            <View style={styles.row}>
              <Button title={t('Request Changes')} variant="ghost" onPress={() => { setError(null); setDeclining(true); }} style={{ flex: 1 }} />
              <Button title={t('Review & Approve')} icon="check" onPress={() => setFormOpen(true)} style={{ flex: 2 }} />
            </View>
          </>
        )}

        {canAnswer && !declining && formOpen && (
          <>
            <Pressable onPress={() => setFormOpen(false)} style={styles.backToQuote} accessibilityRole="button" accessibilityLabel={t('Back to the quote')}>
              <Icon name="chevron-down" size={16} color={colors.primary} />
              <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Back to the {doc}', { doc: label.toLowerCase() })}</Text>
            </Pressable>
            <Input
              label={t('Your full name')}
              value={name}
              onChangeText={setName}
              placeholder={t('First and last name')}
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
              returnKeyType="done"
            />
            <View>
              <Text style={[typeScale.labelLarge, { color: colors.textSecondary, marginBottom: spacing.xs }]}>{t('Your signature')}</Text>
              <SignaturePad onChange={setSignature} />
            </View>
            <Pressable
              onPress={() => setAgreed((a) => !a)}
              style={styles.agree}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
            >
              <View style={[styles.box, { borderColor: agreed ? colors.primary : colors.border, backgroundColor: agreed ? colors.primary : 'transparent' }]}>
                {agreed && <Icon name="check" size={14} color="#fff" />}
              </View>
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>
                {t('I approve this {doc}, including the work, pricing and terms shown, for {total}.', { doc: label.toLowerCase(), total: formatMoney(doc.total) })}
              </Text>
            </Pressable>
            {!!error && <Text style={[typeScale.bodySmall, { color: colors.error }]}>{error}</Text>}
            <View style={styles.row}>
              <Button title={t('Request Changes')} variant="ghost" onPress={() => { setError(null); setDeclining(true); }} disabled={!!saving} style={{ flex: 1 }} />
              <Button
                title={t('Approve')}
                icon="check"
                onPress={() => respond(true)}
                loading={saving === 'approve'}
                disabled={!nameOk || !signed || !agreed || !!saving}
                style={{ flex: 2 }}
              />
            </View>
            <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
              {t('Your name, signature, the date and time are recorded with your answer.')}
            </Text>
            <Button title={t('Download PDF')} icon="download" variant="secondary" onPress={savePdf} loading={pdfBusy} fullWidth />
          </>
        )}

        {canAnswer && declining && (
          <>
            <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{t('Request changes to {doc} {number}', { doc: label.toLowerCase(), number: doc.number })}</Text>
            <Input label={t('Your name (optional)')} value={name} onChangeText={setName} autoComplete="name" autoCapitalize="words" />
            <Input label={t('What would you like changed?')} value={reason} onChangeText={setReason} placeholder={t('For example: please add the back yard')} multiline />
            {!!error && <Text style={[typeScale.bodySmall, { color: colors.error }]}>{error}</Text>}
            <View style={styles.row}>
              <Button title={t('Back')} variant="ghost" onPress={() => setDeclining(false)} disabled={!!saving} style={{ flex: 1 }} />
              <Button title={t('Send Request')} icon="send" onPress={() => respond(false)} loading={saving === 'decline'} disabled={!!saving || reason.trim().length < 3} style={{ flex: 2 }} />
            </View>
            <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
              {t("We'll review your request and send you an updated quote.")}
            </Text>
          </>
        )}

        {!canAnswer && (
          <>
            {answer && (
              <View style={[styles.answer, { backgroundColor: answer.eventType === 'approved' ? colors.primarySurface : colors.surfacePressed }]}>
                <Icon name={answer.eventType === 'approved' ? 'check-circle' : 'x-circle'} size={18} color={answer.eventType === 'approved' ? colors.primaryDark : colors.textSecondary} />
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>
                  {answer.eventType === 'approved'
                    ? (answeredBy ? t('Approved by {name} on {date}.', { name: answeredBy, date: formatDocDateTime(answer.createdAt) }) : t('Approved on {date}.', { date: formatDocDateTime(answer.createdAt) }))
                    : (answeredBy ? t('Changes requested by {name} on {date}.', { name: answeredBy, date: formatDocDateTime(answer.createdAt) }) : t('Changes requested on {date}.', { date: formatDocDateTime(answer.createdAt) }))}
                  {answer.eventType === 'approved' ? ` ${t('Thank you! {company} has been notified.', { company: company.name })}` : ''}
                </Text>
              </View>
            )}
            {status === 'expired' && (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>
                {t('This quote has expired.')} {company.phone ? t('Call {phone} for an updated quote.', { phone: company.phone }) : t('Please contact us for an updated quote.')}
              </Text>
            )}
            <Button title={t('Save or Print PDF')} icon="download" variant="secondary" onPress={savePdf} loading={pdfBusy} fullWidth />
          </>
        )}

        {(company.phone || company.email) && (
          <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
            {t('Questions?')} {[company.phone, company.email].filter(Boolean).join(' · ')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summary: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { flexGrow: 0, maxHeight: '55%', borderTopWidth: StyleSheet.hairlineWidth },
  barContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  backToQuote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  agree: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  answer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg },
});
