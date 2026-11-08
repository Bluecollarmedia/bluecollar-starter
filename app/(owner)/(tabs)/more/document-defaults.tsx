/**
 * Settings → Quotes & Invoices → Document Defaults (also reachable from the
 * sliders button on the Quotes & Invoices screen): the tax rate, terms, exclusions and
 * payment instructions every new quote, change order and invoice starts with.
 * Documents already created keep what they have; each draft can still be
 * changed on its own.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { ListSection, ScreenHeader, PressableScale } from '@/components/ui';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { InputRow, NoteField } from '@/components/financials/FormBits';
import { showMessage } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { db, useDb } from '@/data/store';
import { documentDefaults, saveDocumentDefaults } from '@/data/financials';
import { parseAmount } from '@/lib/money';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

export default function DocumentDefaultsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const clearance = useTabBarClearance();
  useDb();
  const saved = db.financialSettings;
  const start = documentDefaults();
  const [tax, setTax] = useState(saved?.defaultTaxRate != null ? String(saved.defaultTaxRate) : start.taxRate ? String(start.taxRate) : '');
  const [terms, setTerms] = useState(saved?.defaultTerms ?? start.terms ?? '');
  const [exclusions, setExclusions] = useState(saved?.defaultExclusions ?? start.exclusions ?? '');
  const [invoiceNotes, setInvoiceNotes] = useState(saved?.defaultInvoiceNotes ?? start.invoiceNotes ?? '');
  const [payment, setPayment] = useState(saved?.defaultPaymentInstructions ?? start.paymentInstructions ?? '');

  const taxRate = tax.trim() === '' ? 0 : parseAmount(tax);
  const taxValid = Number.isFinite(taxRate) && taxRate >= 0 && taxRate < 100;

  const save = () => {
    if (!taxValid) {
      showMessage('Check the tax rate', 'Enter a percentage between 0 and 100, or leave it empty for no tax.');
      return;
    }
    saveDocumentDefaults({
      defaultTaxRate: taxRate,
      defaultTerms: terms.trim() || undefined,
      defaultExclusions: exclusions.trim() || undefined,
      defaultPaymentInstructions: payment.trim() || undefined,
      defaultInvoiceNotes: invoiceNotes.trim() || undefined,
    });
    router.back();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader
        title="Document Defaults"
        subtitle="What new quotes, change orders and invoices start with"
        right={
          <PressableScale
            onPress={save}
            scaleTo={0.92}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Save defaults"
            style={[styles.save, { backgroundColor: colors.primary }]}
          >
            <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>Save</Text>
          </PressableScale>
        }
      />

      <KeyboardAwareScrollView bounces={false}
        bottomOffset={KEYBOARD_GAP}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: clearance + spacing['2xl'] }}
      >
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.lg, marginHorizontal: spacing.xs }]}>
          Documents you already made don’t change, and you can still edit each draft.
        </Text>
        <ListSection title="TAX" footer="Leave empty if you don’t charge tax. Nothing is assumed.">
          <InputRow label="Tax rate" value={tax} onChangeText={setTax} placeholder="0" keyboardType="decimal-pad" suffix="%" error={!taxValid} />
        </ListSection>
        <ListSection title="QUOTE & CHANGE ORDER TERMS">
          <NoteField label="Terms" placeholder="Deposit, payment schedule, warranty…" value={terms} onChangeText={setTerms} />
        </ListSection>
        <ListSection title="QUOTE EXCLUSIONS">
          <NoteField label="Exclusions" placeholder="Work not included unless listed" value={exclusions} onChangeText={setExclusions} />
        </ListSection>
        <ListSection title="INVOICE NOTES" footer="Printed on every new invoice. Each invoice can still be edited on its own.">
          <NoteField label="Notes" placeholder="e.g. Thank you for your business!" value={invoiceNotes} onChangeText={setInvoiceNotes} />
        </ListSection>
        <ListSection title="INVOICE PAYMENT INSTRUCTIONS">
          <NoteField label="Payment instructions" placeholder="e.g. Make checks payable to…" value={payment} onChangeText={setPayment} />
        </ListSection>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  save: { height: 44, paddingHorizontal: spacing.lg, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
