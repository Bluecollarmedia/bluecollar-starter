/**
 * Add Properties (Owner): a bottom sheet over the Plowing Route. Search, filter (All / the route's service / Customer), tick as
 * many properties as you like, then add them in one tap. The route draft underneath is untouched until Add is pressed.
 * The list is only the properties the database says are eligible for this storm; the filters just narrow what is shown.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, LoadingSpinner, Switch } from '@/components/ui';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useTheme } from '@/providers/ThemeProvider';
import { loadPropertyContactNames } from '@/data/snowProperties';
import type { EligibleProperty } from '@/data/snowStorms';
import { addButtonLabel, filterProperties, type PropertyFilter } from '@/lib/snowPropertyPicker';
import { SNOW_SERVICES, type SnowService } from '@/types/snow';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Eligible properties for this route (already limited by the database). */
  properties: EligibleProperty[];
  /** The route's services, for the service filter and the empty message. */
  services: SnowService[];
  serviceLabel: (s: SnowService) => string;
  /** How many visits each property already has on this route (a property can be added again for another pass). */
  visitsOn: Map<string, number>;
  busy: boolean;
  /** After dispatch only: put the new stops right after the one the lead is on. */
  showDoNext: boolean;
  doNext: boolean;
  onDoNext: (v: boolean) => void;
  onAdd: (propertyIds: string[]) => Promise<void> | void;
}

export function AddPropertiesSheet({ visible, onClose, properties, services, serviceLabel, visitsOn, busy, showDoNext, doNext, onDoNext, onAdd }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PropertyFilter>('service');
  const [customer, setCustomer] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Record<string, string[]>>({});
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Fresh each time the sheet opens; the route itself is never touched by opening or closing it.
  useEffect(() => {
    if (!visible) return;
    setQuery(''); setFilter('service'); setCustomer(null); setChosen([]);
    let alive = true;
    setLoadingContacts(true);
    loadPropertyContactNames().then((r) => { if (alive) { setContacts(r.ok ? r.data : {}); setLoadingContacts(false); } });
    return () => { alive = false; };
  }, [visible]);

  const single = services.length === 1 ? services[0] : null;
  const serviceName = single ? serviceLabel(single) : 'Services';
  const rows = useMemo(
    () => filterProperties(properties, { query, filter, customer, contacts, services }),
    [properties, query, filter, customer, contacts, services],
  );
  const customers = useMemo(() => {
    const names = new Set<string>();
    for (const p of properties) for (const n of contacts[p.propertyId] ?? []) names.add(n);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [properties, contacts]);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const sep = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight };
  // The route's own service comes first and is what the sheet opens on (a plowing route opens on Plowing), then the other services,
  // then All, then Customer.
  const otherServices = SNOW_SERVICES.filter((s) => !services.includes(s));
  const filters: { key: PropertyFilter; label: string }[] = [
    { key: 'service', label: serviceName },
    ...otherServices.map((s): { key: PropertyFilter; label: string } => ({ key: `svc:${s}`, label: s === 'shoveling' ? 'Sidewalks' : serviceLabel(s) })),
    { key: 'all', label: 'All' },
    { key: 'customer', label: 'Customer' },
  ];

  async function submit() {
    if (!chosen.length) return;
    await onAdd(chosen);
    onClose();
  }

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.end} pointerEvents="box-none">
          <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.grip, { backgroundColor: colors.border }]} />
            <View style={styles.titleRow}>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={24} color={colors.textPrimary} />
              </Pressable>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>Add Properties</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Select properties to add to this route.</Text>
              </View>
              <View style={{ width: 24 }} />
            </View>

            <View style={[styles.search, { backgroundColor: colors.groupedBackground, borderColor: colors.borderLight }]}>
              <Icon name="search" size={18} color={colors.textTertiary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search properties or customers…"
                placeholderTextColor={colors.textTertiary}
                style={[typeScale.bodyLarge, { flex: 1, color: colors.textPrimary, paddingVertical: 10 }]}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Search properties or customers"
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search"><Icon name="x-circle" size={16} color={colors.textTertiary} /></Pressable>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} style={styles.segmentScroll} contentContainerStyle={[styles.segment, { backgroundColor: colors.groupedBackground }]} keyboardShouldPersistTaps="handled">
              {filters.map((f) => {
                const on = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => { setFilter(f.key); if (f.key !== 'customer') setCustomer(null); }}
                    style={[styles.segBtn, on && { backgroundColor: colors.primarySurface }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[typeScale.labelLarge, { color: on ? colors.primary : colors.textSecondary }]}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {filter === 'customer' ? (
              loadingContacts ? <LoadingSpinner /> : customers.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                  {customers.map((n) => {
                    const on = customer === n;
                    return (
                      <Pressable
                        key={n}
                        onPress={() => setCustomer(on ? null : n)}
                        style={[styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySurface : colors.surface }]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[typeScale.labelSmall, { color: on ? colors.primary : colors.textPrimary }]}>{n}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginHorizontal: spacing.lg, marginBottom: spacing.sm }]}>
                  None of these properties has a customer contact yet.
                </Text>
              )
            ) : null}

            <ScrollView bounces={false} style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }} keyboardShouldPersistTaps="handled">
              {rows.length === 0 ? (
                <View style={styles.empty}>
                  <Icon name="home" size={40} color={colors.textTertiary} />
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', marginTop: spacing.md }]}>No properties found</Text>
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: 4 }]}>
                    {properties.length === 0
                      ? `No properties with ${services.map((s) => serviceLabel(s).toLowerCase()).join(' or ')} turned on are available to add. Turn the service on for a property first.`
                      : 'Nothing matches. Try a different search or filter.'}
                  </Text>
                </View>
              ) : rows.map((p, i) => {
                const on = chosen.includes(p.propertyId);
                const who = contacts[p.propertyId]?.[0];
                const already = visitsOn.get(p.propertyId);
                return (
                  <Pressable
                    key={p.propertyId}
                    onPress={() => toggle(p.propertyId)}
                    style={[styles.row, i > 0 && sep]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={p.name}
                  >
                    <View style={[styles.box, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }]}>
                      {on ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{p.name}</Text>
                      <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{[p.address, who].filter(Boolean).join(' · ')}</Text>
                      {already ? <Text style={[typeScale.caption, { color: colors.primary }]}>Already on this route ×{already}. Adding it again makes another visit.</Text> : null}
                    </View>
                    {p.services?.length ? (
                      <View style={[styles.tag, { backgroundColor: colors.primarySurface }]}>
                        <Text style={[typeScale.labelSmall, { color: colors.primary }]}>{p.services.map(serviceLabel).join(' + ')}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: colors.borderLight, paddingBottom: insets.bottom + spacing.sm }]}>
              {showDoNext ? (
                <View style={[styles.doNext]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>Do these next</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Puts them right after the stop the lead is on.</Text>
                  </View>
                  <Switch value={doNext} onValueChange={onDoNext} accessibilityLabel="Do these next" />
                </View>
              ) : null}
              <Button title={addButtonLabel(chosen.length)} icon="plus" onPress={submit} disabled={!chosen.length} loading={busy} fullWidth size="lg" />
              <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center', paddingTop: spacing.sm }} accessibilityRole="button">
                <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  end: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  segmentScroll: { flexGrow: 0, marginHorizontal: spacing.lg, marginVertical: spacing.md, borderRadius: radius.lg },
  segment: { flexDirection: 'row', padding: 4, borderRadius: radius.lg },
  segBtn: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: { paddingHorizontal: spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 60 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  empty: { alignItems: 'center', paddingVertical: spacing['3xl'], paddingHorizontal: spacing.lg },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  doNext: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
});
