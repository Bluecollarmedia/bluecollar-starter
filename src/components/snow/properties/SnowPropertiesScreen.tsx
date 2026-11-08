/**
 * Snow Mode Properties tab (Owner): every snow property with the services
 * it offers, and an Add Property form. Contacts, services, instructions and
 * reference media are edited on the property screen (update 022). Working
 * layout in the existing app style; no approved mockup yet.
 */
import { AddSnowProperty } from './AddSnowProperty';
import { customerNameOf, enableSnowForProperty, useAllProperties } from '@/data/properties';
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, GlassIconButton, Icon, InlineNotice, Input, LoadingSpinner, SearchBar } from '@/components/ui';
import { showMessage } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { db } from '@/data/store';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { SERVICE_LABEL } from '@/data/snowStorms';
import type { SnowService } from '@/types/snow';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

interface Row {
  id: string;
  propertyId?: string;
  customer?: string;
  name: string; address: string; street: string; zip?: string; status: 'active' | 'inactive'; services: SnowService[];
}

/** `asTab` (default): the Properties tab. Otherwise a stand-alone screen with a Back button (the Properties tab is the only way in now). */
export function SnowPropertiesScreen({ asTab = true }: { asTab?: boolean } = {}) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [turningOn, setTurningOn] = useState<string | null>(null);
  const allProperties = useAllProperties();

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return setError('Snow properties need the live database.'); }
    const { data, error: e } = await supabase
      .from('snow_properties')
      .select('id, name, address, city, state, zip, status, property_id, snow_property_services(service, is_active)')
      .order('name');
    setLoading(false);
    if (e) return setError('Couldn\'t load snow properties.');
    setError(null);
    setRows((data ?? []).map((p) => ({
      id: p.id,
      propertyId: (p as { property_id?: string | null }).property_id ?? undefined,
      name: p.name,
      address: [p.address, p.city, p.state].filter(Boolean).join(', '),
      street: p.address,
      zip: p.zip ?? undefined,
      status: p.status,
      services: ((p.snow_property_services ?? []) as { service: SnowService; is_active: boolean }[])
        .filter((s) => s.is_active).map((s) => s.service),
    })));
  }, []);
  // Reload whenever the screen comes back into view (services may just have been turned on, or a customer changed).
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const open = (id: string) => router.push({ pathname: '/snow/owner/property', params: { id } });

  const all: Row[] = rows
    .map((r) => ({ ...r, customer: customerNameOf(allProperties.find((p) => p.id === r.propertyId)?.customerId) || undefined }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Every property in the company is listed here, Snow or not (one shared list). The ones without Snow can be switched on with a tap.
  const onSnow = new Set(rows.map((r) => r.propertyId).filter((x): x is string => !!x));
  const others = allProperties
    .filter((p) => !onSnow.has(p.id))
    .map((p) => ({ id: p.id, name: p.name || p.address, address: [p.address, p.city, p.state].filter(Boolean).join(', '), customer: customerNameOf(p.customerId) || undefined }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const q = query.trim().toLowerCase();
  const matches = (r: { name: string; address: string; customer?: string }) => `${r.name} ${r.address} ${r.customer ?? ''}`.toLowerCase().includes(q);
  const shown = q ? all.filter(matches) : all;
  const shownOthers = q ? others.filter(matches) : others;

  async function turnOn(propertyId: string) {
    if (turningOn) return;
    setTurningOn(propertyId);
    const res = await enableSnowForProperty(propertyId);
    setTurningOn(null);
    if (!res.ok) return showMessage("Couldn't turn Snow on", res.error);
    await reload();
    open(res.snowPropertyId);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: (asTab ? tabBarClearance : insets.bottom) + spacing.lg }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
        keyboardShouldPersistTaps="handled"
      >
        {asTab ? null : <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />}
        <View style={[styles.titleRow, !asTab && { marginTop: spacing.lg }]}>
          {/* One line always: the title shrinks a little before it would ever wrap, and the button never gets squeezed. */}
          <Text style={[typeScale.displaySmall, { color: colors.textPrimary, flex: 1, flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Properties</Text>
          {!adding ? <View style={{ flexShrink: 0, marginLeft: spacing.md }}><Button title="Add" icon="plus" size="sm" onPress={() => setAdding(true)} /></View> : null}
        </View>
        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginTop: spacing.md }} /> : null}

        {adding ? (
          <AddSnowProperty
            snowPropertyIds={rows.map((r) => r.propertyId).filter((x): x is string => !!x)}
            onCancel={() => setAdding(false)}
            onDone={(id) => { setAdding(false); reload(); open(id); }}
          />
        ) : null}

        {all.length + others.length > 6 ? <SearchBar value={query} onChangeText={setQuery} placeholder="Search properties" style={{ marginTop: spacing.md }} /> : null}

        {loading ? <LoadingSpinner /> : !all.length && !others.length && !adding ? (
          <EmptyState icon="home" title="No snow properties yet" description="Add the lots, driveways and walks your crews clear. You can import a customer's existing property." />
        ) : (
          <View style={[styles.group, { backgroundColor: colors.surface, marginTop: spacing.md }]}>
            {shown.map((r, i) => (
              <Pressable
                key={r.id}
                onPress={() => open(r.id)}
                accessibilityRole="button"
                style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}
              >
                <View style={{ flex: 1, gap: 2, opacity: r.status === 'inactive' ? 0.5 : 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
                    {r.name}{r.status === 'inactive' ? ' (inactive)' : ''}
                  </Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{[r.customer, r.address].filter(Boolean).join(' · ')}</Text>
                  <Text style={[typeScale.caption, { color: r.services.length ? colors.primary : colors.warning }]}>
                    {r.services.length ? r.services.map((s) => SERVICE_LABEL[s]).join(' · ') : 'No services on yet'}
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.textTertiary} />
              </Pressable>
            ))}
          </View>
        )}

        {!loading && shownOthers.length ? (
          <>
            <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.xl, marginBottom: spacing.xs }]}>NOT ON SNOW YET</Text>
            <View style={[styles.group, { backgroundColor: colors.surface }]}>
              {shownOthers.map((r, i) => (
                <Pressable
                  key={r.id}
                  onPress={() => turnOn(r.id)}
                  disabled={turningOn != null}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name}. Snow is off. Tap to turn Snow on.`}
                  style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }, turningOn === r.id && { opacity: 0.6 }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{r.name}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{[r.customer, r.address].filter(Boolean).join(' · ')}</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{turningOn === r.id ? 'Turning Snow on…' : 'Snow is off · tap to turn it on'}</Text>
                  </View>
                  <Icon name="plus-circle" size={20} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 60 },
});
