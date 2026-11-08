/**
 * Quote / change order / invoice editor (drafts only), in three steps:
 * Details → Line Items → Review. Changes are saved to the draft whenever the
 * step changes or the editor closes; "Preview" opens the finished document.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, ListSection, EmptyState, InlineNotice } from '@/components/ui';
import { ProjectPrivateNotes } from '@/components/projects/ProjectPrivateNotes';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { DateRow, InputRow, ValueRow, NoteField } from '@/components/financials/FormBits';
import { LineItemSheet } from '@/components/financials/LineItemSheet';
import { showMessage } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { useFinancialDoc } from '@/hooks/useFinancials';
import { DOC_LABEL, CATEGORY_LABEL, saveDraft, deleteDraft, discardEmptyProspect, newLineItem, recentLineItems, readinessProblems, getDoc } from '@/data/financials';
import { calcTotals, formatMoney, formatQuantity, formatPercent, parseAmount } from '@/lib/money';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { FinancialDocType, LineItem } from '@/types/financial';

const STEPS = ['Details', 'Line Items', 'Review'];

interface Form {
  title: string;
  description: string;
  date: string;
  secondDate?: string;
  taxRate: string;
  notes: string;
  exclusions: string;
  terms: string;
  paymentInstructions: string;
  lineItems: LineItem[];
}

export default function DocumentEditScreen() {
  const { kind, id, fresh, from, step: initialStep, newProject } = useLocalSearchParams<{ kind: FinancialDocType; id: string; fresh?: string; from?: string; step?: string; newProject?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { doc, project, linkedQuote } = useFinancialDoc(kind, id);
  const [step, setStep] = useState(Number(initialStep) || 0);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<{ item: LineItem; isNew: boolean } | null>(null);
  const touched = useRef(false);
  const scrollRef = useRef<any>(null);
  const suggestions = useMemo(() => recentLineItems(), []);

  // Swiping the editor down closes it like the X does: the draft is saved first (or an untouched new one is dropped). If something is
  // invalid (for example a tax rate over 100) the swipe is stopped and the message is shown, so nothing typed is lost.
  const navigation = useNavigation();
  const leaving = useRef(false);
  const leaveRef = useRef<() => boolean>(() => true);
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (leaving.current) return;
    if (leaveRef.current()) leaving.current = true; else e.preventDefault();
  }), [navigation]);

  // Every step opens at the top (the page used to stay scrolled to the bottom of the step before, so the new step looked unchanged).
  useEffect(() => { scrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false }); }, [step]);

  // Load the draft once.
  useEffect(() => {
    if (!doc || form) return;
    setForm({
      title: doc.title ?? '',
      description: doc.kind === 'change_order' ? doc.description ?? '' : '',
      date: doc.kind === 'invoice' ? doc.invoiceDate : doc.issueDate,
      secondDate: doc.kind === 'invoice' ? doc.dueDate : doc.kind === 'quote' ? doc.validUntil : undefined,
      taxRate: doc.taxRate ? String(doc.taxRate) : '',
      notes: doc.notes ?? '',
      exclusions: doc.kind === 'quote' ? doc.exclusions ?? '' : '',
      terms: doc.kind !== 'invoice' ? doc.terms ?? '' : '',
      paymentInstructions: doc.kind === 'invoice' ? doc.paymentInstructions ?? '' : '',
      lineItems: doc.lineItems,
    });
  }, [doc, form]);

  if (!doc || !form) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground, paddingTop: insets.top }]}>
        <EmptyState icon="file-text" title="Document not found" actionTitle="Close" onAction={() => router.back()} />
      </View>
    );
  }

  const label = DOC_LABEL[doc.kind];

  if (doc.status !== 'draft') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground, paddingTop: insets.top }]}>
        <EmptyState
          icon="lock"
          title={`${doc.number} is locked`}
          description={`It was already ${doc.kind === 'invoice' ? 'issued' : 'sent'}, so its contents can't change. Duplicate it as a new draft to make changes.`}
          actionTitle="Close"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const taxRate = form.taxRate.trim() === '' ? 0 : parseAmount(form.taxRate);
  const taxValid = Number.isFinite(taxRate) && taxRate >= 0 && taxRate < 100;
  const totals = calcTotals(form.lineItems, taxValid ? taxRate : 0);

  const update = (patch: Partial<Form>) => {
    touched.current = true;
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  /** Writes the form to the draft. Returns false if something is invalid. */
  const persist = (): boolean => {
    if (!taxValid) {
      showMessage('Check the tax rate', 'Enter a percentage between 0 and 100, or leave it empty for no tax.');
      return false;
    }
    if (form.secondDate && form.secondDate < form.date) {
      showMessage('Check the dates', doc.kind === 'invoice' ? 'The due date is before the invoice date.' : '“Valid until” is before the quote date.');
      return false;
    }
    const patch: Record<string, unknown> = {
      title: form.title.trim() || undefined,
      notes: form.notes.trim() || undefined,
      taxRate,
      lineItems: form.lineItems,
    };
    if (doc.kind === 'invoice') {
      Object.assign(patch, { invoiceDate: form.date, dueDate: form.secondDate, paymentInstructions: form.paymentInstructions.trim() || undefined });
    } else {
      Object.assign(patch, { issueDate: form.date, terms: form.terms.trim() || undefined });
      if (doc.kind === 'quote') Object.assign(patch, { validUntil: form.secondDate, exclusions: form.exclusions.trim() || undefined });
      if (doc.kind === 'change_order') Object.assign(patch, { description: form.description.trim() || undefined });
    }
    try {
      saveDraft(doc.kind, doc.id, patch);
      return true;
    } catch (err) {
      showMessage('Not saved', (err as Error).message);
      return false;
    }
  };

  /** Saves the draft (or drops a brand-new one that was never filled in). False = something is invalid and the editor must stay open. */
  const leaveOk = (): boolean => {
    // A brand-new draft that was never filled in isn't kept.
    if (fresh === '1' && !touched.current && form.lineItems.length === 0) {
      deleteDraft(doc.kind, doc.id);
      // The prospect made just for this quote goes too; an existing project is never touched.
      if (newProject === '1') discardEmptyProspect(doc.projectId);
      return true;
    }
    return persist();
  };
  leaveRef.current = leaveOk;

  const close = () => {
    if (leaveOk()) { leaving.current = true; router.back(); }
  };

  const goTo = (next: number) => {
    if (!persist()) return;
    setStep(next);
  };

  const preview = () => {
    if (!persist()) return;
    const saved = getDoc(doc.kind, doc.id);
    const problems = saved ? readinessProblems(saved) : [];
    if (problems.length) {
      showMessage('Almost there', problems.join('\n'));
      return;
    }
    // Back to the document if we came from it; otherwise open it.
    router.back();
    if (from === 'document') return;
    setTimeout(() => router.push({ pathname: '/(owner)/document', params: { kind: doc.kind, id: doc.id } } as any), 50);
  };

  const saveItem = (item: LineItem) => {
    const exists = form.lineItems.some((li) => li.id === item.id);
    update({ lineItems: exists ? form.lineItems.map((li) => (li.id === item.id ? item : li)) : [...form.lineItems, item] });
    setEditing(null);
  };
  const removeItem = (itemId: string) => {
    update({ lineItems: form.lineItems.filter((li) => li.id !== itemId) });
    setEditing(null);
  };
  const move = (index: number, dir: -1 | 1) => {
    const next = form.lineItems.slice();
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    update({ lineItems: next });
  };

  const customer = doc.customer ?? project?.customer;
  const address = [project?.address, project?.city].filter(Boolean).join(', ');

  const totalsBlock = (
    <ListSection>
      <ValueRow label="Subtotal" value={formatMoney(totals.subtotal)} />
      {taxRate > 0 && <ValueRow label={`Tax (${formatPercent(taxRate)})`} value={formatMoney(totals.taxAmount)} />}
      <View style={styles.grand}>
        <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Total</Text>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>{formatMoney(totals.total)}</Text>
      </View>
    </ListSection>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm, backgroundColor: colors.surface }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={step === 0 ? close : () => goTo(step - 1)} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={step === 0 ? 'Close' : 'Back'}>
            <Icon name={step === 0 ? 'x' : 'chevron-left'} size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{label} {doc.number}</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Draft</Text>
          </View>
          <Pressable onPress={close} hitSlop={12} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Save draft and close">
            <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Save</Text>
          </Pressable>
        </View>
        <View style={styles.stepper}>
          {STEPS.map((s, i) => {
            const active = i === step;
            const done = i < step;
            return (
              <Pressable key={s} style={styles.stepItem} onPress={() => i !== step && goTo(i)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <View style={[styles.stepDot, { backgroundColor: active || done ? colors.primary : colors.backgroundTertiary }]}>
                  {done
                    ? <Icon name="check" size={12} color="#FFFFFF" />
                    : <Text style={[typeScale.labelSmall, { color: active ? '#FFFFFF' : colors.textSecondary }]}>{i + 1}</Text>}
                </View>
                <Text style={[typeScale.labelSmall, { color: active ? colors.textPrimary : colors.textSecondary }]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* The owner's private notes for this project (what to order, measurements, materials, pictures). Never on the document. */}
      <KeyboardAwareScrollView bounces={false}
        ref={scrollRef}
        bottomOffset={KEYBOARD_GAP}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 && (
          <>
            <ListSection title="CUSTOMER & PROJECT" footer="The customer comes from the project. To change it, edit the project.">
              <ValueRow label="Customer" value={customer ? `${customer.firstName} ${customer.lastName}`.trim() : 'None'} sub={customer?.email} />
              <ValueRow label="Project" value={project?.name ?? '—'} sub={project?.status === 'prospect' ? `${address ? `${address} · ` : ''}Prospect until approved` : address} />
              {linkedQuote && <ValueRow label="Original quote" value={linkedQuote.number} sub={formatMoney(linkedQuote.total)} />}
            </ListSection>

            {doc.kind === 'change_order' && (
              <ListSection title="WHAT'S CHANGING">
                <NoteField label="Description of change" placeholder="Describe the added or changed work" value={form.description} onChangeText={(t) => update({ description: t })} />
              </ListSection>
            )}

            <ListSection title={`${label.toUpperCase()} DETAILS`}>
              <ValueRow label="Number" value={doc.number} />
              {doc.kind !== 'change_order' && (
                <InputRow label="Title" value={form.title} onChangeText={(t) => update({ title: t })} placeholder={project?.name ?? 'Optional'} />
              )}
              <DateRow label={doc.kind === 'invoice' ? 'Invoice date' : 'Date'} value={form.date} onChange={(d) => update({ date: d })} />
              {doc.kind === 'quote' && (
                <DateRow label="Valid until" value={form.secondDate} optional minimumDate={form.date} onChange={(d) => update({ secondDate: d })} onClear={() => update({ secondDate: undefined })} />
              )}
              {doc.kind === 'invoice' && (
                <DateRow label="Due date" value={form.secondDate} optional minimumDate={form.date} onChange={(d) => update({ secondDate: d })} onClear={() => update({ secondDate: undefined })} />
              )}
              <InputRow
                label="Tax rate"
                value={form.taxRate}
                onChangeText={(t) => update({ taxRate: t })}
                placeholder="0"
                keyboardType="decimal-pad"
                suffix="%"
                error={!taxValid}
              />
            </ListSection>
          </>
        )}

        {step === 0 && doc.kind === 'quote' && project && (
          <View style={{ marginTop: spacing.lg }}>
            <ProjectPrivateNotes projectId={project.id} projectName={project.name} address={address} />
          </View>
        )}

        {step === 1 && (
          <>
            {form.lineItems.length === 0 ? (
              <View style={[styles.emptyItems, { backgroundColor: colors.surface }, shadow.sm]}>
                <Icon name="list" size={22} color={colors.textTertiary} />
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: spacing.sm }]}>No line items yet</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: 2 }]}>
                  Add the work, materials and pricing for this {label.toLowerCase()}.
                </Text>
              </View>
            ) : (
              <ListSection title={`LINE ITEMS (${form.lineItems.length})`}>
                {form.lineItems.map((li, i) => (
                  <Pressable
                    key={li.id}
                    onPress={() => setEditing({ item: li, isNew: false })}
                    style={({ pressed }) => [styles.itemRow, pressed && { backgroundColor: colors.backgroundSecondary }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${li.description}`}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={2}>{li.description || 'Untitled item'}</Text>
                      <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
                        {li.category ? `${CATEGORY_LABEL[li.category]}  ·  ` : ''}
                        {formatQuantity(li.quantity)}{li.unit ? ` ${li.unit}` : ''} × {formatMoney(li.unitPrice)}
                        {li.source ? `  ·  from ${li.source.number}` : ''}
                      </Text>
                    </View>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', fontVariant: ['tabular-nums'] }]}>{formatMoney(li.amount)}</Text>
                    {form.lineItems.length > 1 && (
                      <View style={styles.reorder}>
                        <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} accessibilityLabel="Move up">
                          <Icon name="chevron-up" size={18} color={i === 0 ? colors.border : colors.textTertiary} />
                        </Pressable>
                        <Pressable onPress={() => move(i, 1)} disabled={i === form.lineItems.length - 1} hitSlop={6} accessibilityLabel="Move down">
                          <Icon name="chevron-down" size={18} color={i === form.lineItems.length - 1 ? colors.border : colors.textTertiary} />
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                ))}
              </ListSection>
            )}
            <Button title="Add Item" icon="plus" variant="secondary" onPress={() => setEditing({ item: newLineItem(), isNew: true })} fullWidth style={{ marginBottom: spacing.lg }} />
            {totalsBlock}
          </>
        )}


        {step === 2 && (
          <>
            {readinessProblems({ ...doc, lineItems: form.lineItems } as typeof doc).map((p) => (
              <InlineNotice key={p} icon="alert-circle" tone="warning" text={p} style={{ marginBottom: spacing.sm }} />
            ))}
            {totalsBlock}
            <ListSection title="NOTES" footer="Printed on the document.">
              <NoteField label="Notes" placeholder="Add any notes for the customer" value={form.notes} onChangeText={(t) => update({ notes: t })} />
            </ListSection>
            {doc.kind === 'quote' && (
              <ListSection title="EXCLUSIONS">
                <NoteField label="Exclusions" placeholder="Work not included in this quote" value={form.exclusions} onChangeText={(t) => update({ exclusions: t })} />
              </ListSection>
            )}
            {doc.kind !== 'invoice' && (
              <ListSection title="TERMS">
                <NoteField label="Terms" placeholder="Deposit, payment schedule, warranty…" value={form.terms} onChangeText={(t) => update({ terms: t })} />
              </ListSection>
            )}
            {doc.kind === 'invoice' && (
              <ListSection title="PAYMENT INSTRUCTIONS">
                <NoteField label="Payment instructions" placeholder="e.g. Make checks payable to…" value={form.paymentInstructions} onChangeText={(t) => update({ paymentInstructions: t })} />
              </ListSection>
            )}
          </>
        )}
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.separator, paddingBottom: insets.bottom + spacing.sm }]}>
        {step < 2 ? (
          <Button title={`Next: ${STEPS[step + 1]}`} onPress={() => goTo(step + 1)} fullWidth />
        ) : (
          <Button title="Preview" icon="eye" onPress={preview} fullWidth />
        )}
      </View>

      <LineItemSheet
        visible={!!editing}
        item={editing?.item ?? null}
        isNew={!!editing?.isNew}
        suggestions={suggestions}
        onSave={saveItem}
        onDelete={() => editing && removeItem(editing.item.id)}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { minWidth: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.sm },
  stepItem: { alignItems: 'center', gap: 4, minWidth: 80 },
  stepDot: { width: 24, height: 24, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  emptyItems: { alignItems: 'center', padding: spacing.xl, borderRadius: radius.xl, marginBottom: spacing.lg },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  reorder: { gap: 2, marginLeft: spacing.xs },
});
