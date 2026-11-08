/**
 * Add / edit one line item: description, optional details, quantity, unit,
 * unit price, with the line total worked out live. Suggestions come from
 * items the company has used before (nothing is hardcoded).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { Button } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { formatMoney, lineAmount, parseAmount } from '@/lib/money';
import { CATEGORY_ORDER, CATEGORY_LABEL } from '@/data/financials';
import type { LineItem, LineItemCategory } from '@/types/financial';

const UNITS = ['ea', 'sq ft', 'ln ft', 'yd', 'ton', 'bag', 'plant', 'hr', 'visit', 'lot'];

interface Props {
  visible: boolean;
  item: LineItem | null;
  isNew: boolean;
  suggestions: Pick<LineItem, 'description' | 'unit' | 'unitPrice' | 'details' | 'category'>[];
  onSave: (item: LineItem) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function LineItemSheet({ visible, item, isNew, suggestions, onSave, onDelete, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<LineItemCategory | undefined>();
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!visible || !item) return;
    setDescription(item.description);
    setDetails(item.details ?? '');
    setQty(isNew && item.quantity === 1 ? '1' : String(item.quantity));
    setUnit(item.unit ?? '');
    setPrice(isNew && !item.unitPrice ? '' : String(item.unitPrice));
    setCategory(item.category);
    setTried(false);
  }, [visible, item, isNew]);

  const q = parseAmount(qty);
  const p = parseAmount(price);
  const errors = {
    description: !description.trim() ? 'Add a description' : '',
    qty: !(q > 0) ? 'Enter a quantity above 0' : '',
    price: !(p >= 0) ? 'Enter a price' : '',
  };
  const valid = !errors.description && !errors.qty && !errors.price;
  const total = valid ? lineAmount(q, p) : q > 0 && p >= 0 ? lineAmount(q, p) : 0;

  const matches = useMemo(() => {
    const t = description.trim().toLowerCase();
    if (!t) return suggestions.slice(0, 6);
    return suggestions.filter((s) => s.description.toLowerCase().includes(t) && s.description.toLowerCase() !== t).slice(0, 6);
  }, [description, suggestions]);

  const save = () => {
    setTried(true);
    if (!valid || !item) return;
    onSave({
      ...item,
      category,
      description: description.trim(),
      details: details.trim() || undefined,
      quantity: q,
      unit: unit.trim() || undefined,
      unitPrice: p,
      amount: lineAmount(q, p),
    });
  };

  const field = (hasError: boolean) => [
    styles.field,
    { backgroundColor: colors.backgroundSecondary, borderColor: tried && hasError ? colors.error : colors.border, color: colors.textPrimary },
  ];

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={10}><Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>Cancel</Text></Pressable>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{isNew ? 'Add Item' : 'Edit Item'}</Text>
            <Pressable onPress={save} hitSlop={10}><Text style={[typeScale.labelLarge, { color: colors.primary }]}>{isNew ? 'Add' : 'Done'}</Text></Pressable>
          </View>

          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Description (e.g. Mulch installation)"
              placeholderTextColor={colors.textTertiary}
              style={field(!!errors.description)}
              autoFocus={isNew}
              accessibilityLabel="Description"
            />
            {matches.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xs }}>
                {matches.map((s) => (
                  <Pressable
                    key={s.description}
                    onPress={() => {
                      setDescription(s.description);
                      if (s.unit) setUnit(s.unit);
                      if (s.unitPrice) setPrice(String(s.unitPrice));
                      if (s.details && !details) setDetails(s.details);
                      if (s.category && !category) setCategory(s.category);
                    }}
                    style={[styles.chip, { backgroundColor: colors.primarySurface }]}
                  >
                    <Text style={[typeScale.labelSmall, { color: colors.primaryDark }]} numberOfLines={1}>
                      {s.description}{s.unitPrice ? ` · ${formatMoney(s.unitPrice)}${s.unit ? `/${s.unit}` : ''}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="Details (optional)"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={[...field(false), { minHeight: 64, textAlignVertical: 'top', paddingTop: spacing.sm }]}
              accessibilityLabel="Details"
            />

            <View style={styles.trio}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: 2 }]}>Quantity</Text>
                <TextInput value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textTertiary} style={field(!!errors.qty)} accessibilityLabel="Quantity" selectTextOnFocus />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: 2 }]}>Unit</Text>
                <TextInput value={unit} onChangeText={setUnit} placeholder="ea" placeholderTextColor={colors.textTertiary} autoCapitalize="none" style={field(false)} accessibilityLabel="Unit" />
              </View>
              <View style={{ flex: 1.2 }}>
                <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: 2 }]}>Unit price</Text>
                <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="$0.00" placeholderTextColor={colors.textTertiary} style={field(!!errors.price)} accessibilityLabel="Unit price" selectTextOnFocus />
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xs }}>
              {UNITS.map((u) => (
                <Pressable key={u} onPress={() => setUnit(u)} style={[styles.chip, { backgroundColor: unit === u ? colors.primary : colors.backgroundTertiary }]}>
                  <Text style={[typeScale.labelSmall, { color: unit === u ? colors.textOnPrimary : colors.textSecondary }]}>{u}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>Group (optional)</Text>
            <View style={styles.cats}>
              {CATEGORY_ORDER.map((c) => {
                const on = category === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCategory(on ? undefined : c)}
                    style={[styles.chip, { backgroundColor: on ? colors.primary : colors.backgroundTertiary }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[typeScale.labelSmall, { color: on ? colors.textOnPrimary : colors.textSecondary }]}>{CATEGORY_LABEL[c]}</Text>
                  </Pressable>
                );
              })}
            </View>

            {tried && !valid && (
              <Text style={[typeScale.caption, { color: colors.error }]}>
                {[errors.description, errors.qty, errors.price].filter(Boolean).join(' · ')}
              </Text>
            )}

            <View style={[styles.totalRow, { borderTopColor: colors.separator }]}>
              <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>Line total</Text>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontVariant: ['tabular-nums'] }]}>{formatMoney(total)}</Text>
            </View>

            <Button title={isNew ? 'Add Item' : 'Save Item'} onPress={save} fullWidth />
            {!isNew && <Button title="Remove Item" variant="ghost" onPress={onDelete} fullWidth />}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '92%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  field: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, minHeight: 44, fontSize: 16 },
  trio: { flexDirection: 'row', gap: spacing.sm },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, maxWidth: 260 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, marginTop: spacing.xs, marginBottom: spacing.sm },
});
