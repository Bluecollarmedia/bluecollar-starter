/**
 * Owner → Maintenance → Properties: every maintenance property with its most
 * urgent service. Each service is judged on its own rule and history
 * (src/lib/maintenanceSchedule.ts), so a weekly cut and a July trim on the
 * same property don't share one "last visit".
 */

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader, RaisedAddButton, EmptyState, LoadingSpinner, SearchBar, FilterChips, StatusBadge } from '@/components/ui';
import { ServiceDueLine } from '@/components/maintenance/ServiceDueLine';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useMaintenance, activeContractOf } from '@/hooks/useMaintenance';
import { db } from '@/data/store';
import { propertyDue, compareUrgency } from '@/lib/maintenanceSchedule';
import { todayKey } from '@/lib/ids';
import type { PropertyDueInfo } from '@/types/maintenance';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

type Filter = 'attention' | 'active' | 'inactive';

const isActiveRow = (r: PropertyDueInfo) => r.property.isActive && r.contract?.status === 'active';
const needsAttention = (r: PropertyDueInfo) => isActiveRow(r) && (r.status === 'overdue' || r.status === 'due');

export default function MaintenancePropertiesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const clearance = useTabBarClearance();
  const m = useMaintenance();
  const today = todayKey();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('active');

  // All properties, including inactive ones (useMaintenanceDue only has active).
  const rows = useMemo(() => m.properties
    .map((p) => {
      const contract = activeContractOf(p.id) ?? m.contractsByProperty[p.id]?.[0];
      const rules = contract ? m.rulesByContract[contract.id] ?? [] : [];
      return propertyDue(p, contract, rules, m.historyByRule, { onDate: today }, m.scheduledByRule);
    })
    .sort((a, b) => compareUrgency(a, b) || a.property.name.localeCompare(b.property.name)),
  [m, today]);

  const counts = {
    attention: rows.filter(needsAttention).length,
    active: rows.filter(isActiveRow).length,
    inactive: rows.filter((r) => !isActiveRow(r)).length,
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (filter === 'attention' ? needsAttention(r) : filter === 'active' ? isActiveRow(r) : !isActiveRow(r)))
      .filter((r) => {
        if (!q) return true;
        const p = r.property;
        const c = p.customer;
        return [p.name, p.address, p.city, c ? `${c.firstName} ${c.lastName}` : '']
          .some((s) => (s ?? '').toLowerCase().includes(q));
      });
  }, [rows, filter, search]);

  const add = () => router.push('/(owner)/maintenance-property-edit' as any);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader
        title="Properties"
        subtitle="Maintenance properties, their contracts and what's due."
        right={<RaisedAddButton onPress={add} accessibilityLabel="Add a maintenance property" />}
      />

      <ScrollView bounces={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: clearance + spacing['2xl'], gap: spacing.md }}
        keyboardShouldPersistTaps="handled"
      >
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search properties, addresses, customers" />
        <FilterChips
          options={[
            { key: 'attention', label: 'Due & overdue', count: counts.attention },
            { key: 'active', label: 'Active', count: counts.active },
            { key: 'inactive', label: 'Inactive', count: counts.inactive },
          ]}
          selected={filter}
          onSelect={setFilter}
        />

        {!db.ready ? (
          <LoadingSpinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="home"
            title="No maintenance properties yet"
            description="Add each property you service once, with its recurring services. Due dates are worked out from there."
            actionTitle="Add Property"
            onAction={add}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={filter === 'attention' ? 'check-circle' : 'search'}
            title={search ? 'No matches' : filter === 'attention' ? 'Nothing due right now' : filter === 'inactive' ? 'No inactive properties' : 'No active properties'}
            description={search ? 'Try a different name or address.' : undefined}
          />
        ) : shown.map((r) => <PropertyCard key={r.property.id} row={r} today={today} />)}
      </ScrollView>
    </View>
  );
}

function PropertyCard({ row, today }: { row: PropertyDueInfo; today: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const p = row.property;
  const active = isActiveRow(row);
  // Up to two services worth showing: whatever is due/overdue, else the next one.
  const urgent = row.services.filter((s) => s.status === 'overdue' || s.status === 'due');
  const shown = (urgent.length ? urgent : row.services.slice(0, 1)).slice(0, 2);
  const more = row.services.length - shown.length;
  const address = [p.address, p.city].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={() => router.push(`/(owner)/maintenance/properties/${p.id}` as any)}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.backgroundSecondary : colors.surface, opacity: active ? 1 : 0.75 }, shadow.sm]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${p.name}`}
    >
      <View style={styles.head}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primarySurface }]}>
          <Icon name="home" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]} numberOfLines={1}>{p.name}</Text>
          {!!address && <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{address}</Text>}
          {!!p.customer && (
            <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
              {p.customer.firstName} {p.customer.lastName}
            </Text>
          )}
        </View>
        {!p.isActive
          ? <StatusBadge label="Property off" status="neutral" />
          : !row.contract
            ? <StatusBadge label="No contract" status="neutral" />
            : row.contract.status !== 'active' && <StatusBadge label="Contract inactive" status="neutral" />}
      </View>

      {active && (
        <View style={[styles.services, { borderTopColor: colors.separator }]}>
          {shown.length === 0 ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>No services set up yet.</Text>
          ) : shown.map((s) => <ServiceDueLine key={s.rule.id} info={s} onDate={today} compact />)}
          {more > 0 && (
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>+ {more} more service{more === 1 ? '' : 's'}</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderRadius: radius.xl, padding: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconWrap: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  services: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm, paddingTop: spacing.sm, gap: spacing.sm },
});
