/**
 * Add a Snow property (Owner): choose the customer (or add them once), then IMPORT one of their existing properties (saved ones,
 * landscaping projects, Maintenance properties) or enter a new address once. Only what you pick becomes a Snow property; the rest
 * stay out of Snow. Nothing about the customer or the address is ever typed a second time. Then pick plowing, shoveling or salting.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Keyboard } from 'react-native';
import { Button, Icon, Input } from '@/components/ui';
import { CustomerPicker } from '@/components/customers/CustomerPicker';
import { CustomerInviteCard } from '@/components/invites/CustomerInviteCard';
import { showMessage } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { useCustomers } from '@/hooks/useCustomers';
import { ensureProperty, enableSnowForProperty, useCustomerProperties } from '@/data/properties';
import { db, isDemo, rowsOf, updateRow } from '@/data/store';
import { knownPlacesFor, normalizeAddress, type KnownPlace } from '@/lib/snowExisting';
import { formatAddress } from '@/lib/address';
import { AddressFields } from '@/components/ui/AddressFields';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const EMPTY = { name: '', address: '', city: '', state: '', zip: '' };

export function AddSnowProperty({ onCancel, onDone, snowPropertyIds = [] }: { onCancel: () => void; onDone: (snowPropertyId: string) => void; /** Shared property ids that already have a Snow record. */ snowPropertyIds?: string[] }) {
  const { colors } = useTheme();
  const { allCustomers } = useCustomers();
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [newMode, setNewMode] = useState(false);
  // A customer added right here: their private invite link is made for them below, so it is never lost.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const shared = useCustomerProperties(customerId);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const customer = allCustomers.find((c) => c.person.id === customerId);
  const set = (k: keyof typeof EMPTY) => (v: string) => setForm({ ...form, [k]: v });

  // Their addresses the app already knows from landscaping projects and Maintenance that are not saved properties yet.
  const legacy = useMemo(() => {
    if (!customerId) return [] as KnownPlace[];
    const have = new Set(shared.map((p) => normalizeAddress(p.address)));
    return knownPlacesFor(customerId, db.projects, rowsOf('maintenance_properties') as { id: string }[]).filter((k) => !have.has(normalizeAddress(k.address)));
  }, [customerId, shared]);

  /** Demo mode has no live database, and a half-made property would be left behind: say so before anything is written. */
  function demoBlocked(): boolean {
    if (!isDemo()) return false;
    showMessage('Demo mode', 'Snow properties need the live database.');
    return true;
  }

  async function finish(pid: string) {
    const res = await enableSnowForProperty(pid);
    setSaving(false);
    if (!res.ok) return showMessage("Couldn't turn Snow on", res.error);
    Keyboard.dismiss();
    setForm(EMPTY);
    onDone(res.snowPropertyId);
  }

  /** A saved property: Snow turns on for it. */
  async function importShared(p: { id: string }) {
    if (saving || demoBlocked()) return;
    setSaving(true);
    await finish(p.id);
  }

  /** An address from a landscaping project or Maintenance: saved once as the customer's property, then Snow turns on for it. */
  async function importPlace(place: KnownPlace) {
    if (saving || !customerId || demoBlocked()) return;
    setSaving(true);
    const made = await ensureProperty(customerId, { address: place.address, city: place.city, state: place.state, zip: place.zip });
    if (!made.ok) { setSaving(false); return showMessage("Couldn't import the property", made.missing ? 'This needs the latest database update (79).' : made.error); }
    // Tie the project / Maintenance record to the saved property so they stay in step.
    updateRow(place.source === 'project' ? 'projects' : 'maintenance_properties', place.sourceId, { propertyId: made.propertyId });
    await finish(made.propertyId);
  }

  async function saveNew() {
    if (!customerId || demoBlocked()) return;
    if (!form.address.trim()) return showMessage('Add the address', 'Enter the street address so the crew can find the property.');
    setSaving(true);
    const made = await ensureProperty(customerId, { name: form.name, address: form.address, city: form.city, state: form.state, zip: form.zip });
    if (!made.ok) { setSaving(false); return showMessage("Couldn't add the property", made.missing ? 'This needs the latest database update (79).' : made.error); }
    await finish(made.propertyId);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>Add Property</Text>
        <Button title="Cancel" size="sm" variant="ghost" onPress={onCancel} />
      </View>

      <Text style={[typeScale.overline, { color: colors.textSecondary, marginBottom: spacing.xs }]}>1 · CUSTOMER</Text>
      {customer ? (
        <View style={[styles.picked, { backgroundColor: colors.primarySurface }]}>
          <Icon name="user" size={18} color={colors.primary} />
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1, fontWeight: '600' }]}>{`${customer.person.firstName} ${customer.person.lastName}`.trim()}</Text>
          <Button title="Change" size="sm" variant="ghost" onPress={() => { setCustomerId(undefined); setNewMode(false); setJustAddedId(null); }} />
        </View>
      ) : (
        <>
          <CustomerPicker onPick={(id, isNew) => { setCustomerId(id); setNewMode(false); setJustAddedId(isNew ? id : null); }} />
        </>
      )}

      {customer && justAddedId === customer.person.id ? (
        <View style={{ marginTop: spacing.md }}>
          <CustomerInviteCard personId={customer.person.id} firstName={customer.person.firstName} phone={customer.person.phone ?? undefined} autoMake />
        </View>
      ) : null}

      {customer ? (
        <>
          <Text style={[typeScale.overline, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.xs }]}>2 · IMPORT AN EXISTING PROPERTY</Text>
          {shared.length === 0 && legacy.length === 0 ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>No properties on file for {customer.person.firstName} yet. Add a new one below.</Text>
          ) : null}
          {shared.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => importShared(p)}
              disabled={saving}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }, saving && { opacity: 0.5 }]}
              accessibilityRole="button"
            >
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{p.name || p.address}</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{formatAddress(p)}</Text>
                <Text style={[typeScale.caption, { color: snowPropertyIds.includes(p.id) ? colors.primary : colors.textTertiary }]}>
                  {snowPropertyIds.includes(p.id) ? 'Already a Snow property · tap to open' : 'Saved property'}
                </Text>
              </View>
              <Icon name="download" size={20} color={colors.primary} />
            </Pressable>
          ))}
          {legacy.map((p, i) => (
            <Pressable
              key={`${p.source}:${p.sourceId}`}
              onPress={() => importPlace(p)}
              disabled={saving}
              style={[styles.row, (shared.length > 0 || i > 0) && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }, saving && { opacity: 0.5 }]}
              accessibilityRole="button"
            >
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{p.name}</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{formatAddress(p)}</Text>
                <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{p.source === 'project' ? 'From a landscaping project' : 'From a maintenance property'}</Text>
              </View>
              <Icon name="download" size={20} color={colors.primary} />
            </Pressable>
          ))}

          {!newMode ? (
            <Pressable onPress={() => setNewMode(true)} style={styles.newRow} accessibilityRole="button">
              <Icon name="plus-circle" size={18} color={colors.primary} />
              <Text style={[typeScale.bodyLarge, { color: colors.primary, fontWeight: '600' }]}>Add a new property</Text>
            </Pressable>
          ) : (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Input label="Property name (optional)" value={form.name} onChangeText={set('name')} placeholder="Oak Plaza" />
              <AddressFields
                value={{ address: form.address, city: form.city, state: form.state, zip: form.zip }}
                onChange={(v) => setForm((f) => ({ ...f, ...v }))}
                streetLabel="Street address"
              />
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                Saved once for this customer. Next you turn on plowing, shoveling or salting.
              </Text>
              <Button title="Save property" loading={saving} onPress={saveNew} fullWidth />
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 52 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  picked: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md },
});
