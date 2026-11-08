/**
 * "Which property?" for a customer: their saved properties as chips, plus "New address". Pick one and nothing is typed twice;
 * pick "New address" and the form's own address fields appear. A property is saved once per customer, then reused everywhere
 * (landscaping, Maintenance, Snow).
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useCustomerProperties } from '@/data/properties';
import type { Property } from '@/types/property';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

interface Props {
  customerId?: string;
  /** The chosen existing property, or undefined for a new address. */
  propertyId?: string;
  /** An existing property was picked, or null for "New address". */
  onSelect: (property: Property | null) => void;
}

export function PropertyChoice({ customerId, propertyId, onSelect }: Props) {
  const { colors } = useTheme();
  const properties = useCustomerProperties(customerId);

  if (!customerId) {
    return (
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        Choose the customer first. Their saved properties show up here, so an address is never typed twice.
      </Text>
    );
  }
  if (properties.length === 0) return null;

  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: 6 }]}>Their properties</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }} keyboardShouldPersistTaps="handled">
        {properties.map((p) => {
          const on = propertyId === p.id;
          return (
            <Pressable
              key={p.id}
              onPress={() => onSelect(p)}
              style={[styles.chip, { backgroundColor: on ? colors.primarySurface : colors.backgroundTertiary, borderColor: on ? colors.primary : 'transparent' }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Use ${p.name || p.address}`}
            >
              <Icon name="map-pin" size={13} color={colors.primary} />
              <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]} numberOfLines={1}>{p.name || p.address}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => onSelect(null)}
          style={[styles.chip, { backgroundColor: !propertyId ? colors.primarySurface : colors.backgroundTertiary, borderColor: !propertyId ? colors.primary : 'transparent' }]}
          accessibilityRole="button"
          accessibilityState={{ selected: !propertyId }}
          accessibilityLabel="Use a new address"
        >
          <Icon name="plus" size={13} color={colors.primary} />
          <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>New address</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, minHeight: 36, borderRadius: radius.full, borderWidth: 1, maxWidth: 260 },
});
