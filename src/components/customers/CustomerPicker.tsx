/**
 * Pick ONE customer from the customers you already have: "Add a new customer" right at the top, a search box (once the list is
 * long) and compact rows. Used everywhere a form needs a customer (Snow property, Add Snow
 * Property), so the list, the search and the wording stay the same.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Icon, SearchBar } from '@/components/ui';
import { QuickAddCustomer } from '@/components/customers/QuickAddCustomer';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

export function CustomerPicker({ onPick, checkedId, disabled }: {
  /** An existing customer was tapped, or a new one was just added (`isNew`). */
  onPick: (personId: string, isNew?: boolean) => void;
  /** Shows a check on this customer (the one already linked). */
  checkedId?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const v = useDb();
  const [query, setQuery] = useState('');

  const customers = useMemo(
    () => db.members
      .filter((m) => m.role === 'customer' && m.status !== 'inactive' && m.person)
      .sort((a, b) => `${a.person!.lastName} ${a.person!.firstName}`.localeCompare(`${b.person!.lastName} ${b.person!.firstName}`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v],
  );
  const q = query.trim().toLowerCase();
  const shown = q
    ? customers.filter((m) => `${m.person!.firstName} ${m.person!.lastName} ${m.person!.email ?? ''} ${m.person!.phone ?? ''}`.toLowerCase().includes(q))
    : customers;

  return (
    <View>
      {/* At the top, always in view: with a long list below, a button at the bottom is easy to miss. */}
      <QuickAddCustomer onAdded={onPick} />
      {customers.length > 5 ? <SearchBar value={query} onChangeText={setQuery} placeholder="Search your customers" style={{ marginTop: spacing.sm }} /> : null}
      {shown.slice(0, 40).map((m, i) => {
        const p = m.person!;
        const reach = [p.phone, p.email].filter(Boolean).join(' · ');
        return (
          <Pressable
            key={m.personId}
            onPress={() => onPick(m.personId)}
            disabled={disabled}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }, disabled && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel={`${p.firstName} ${p.lastName}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{`${p.firstName} ${p.lastName}`.trim() || p.email}</Text>
              {reach ? <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{reach}</Text> : null}
            </View>
            <Icon name={checkedId === m.personId ? 'check' : 'chevron-right'} size={18} color={checkedId === m.personId ? colors.primary : colors.textTertiary} />
          </Pressable>
        );
      })}
      {shown.length > 40 ? <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>Showing 40. Search to narrow it down.</Text> : null}
      {customers.length === 0 ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginVertical: spacing.sm }]}>No customers yet. Add the first one above.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 52 },
});
