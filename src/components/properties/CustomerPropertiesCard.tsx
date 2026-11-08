/**
 * A customer's page: their properties, each with what is set up there (landscaping projects, Maintenance). Add a property once
 * here (or from any form); it is then available everywhere, including Snow. Nothing about the customer is typed again.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Keyboard } from 'react-native';
import { Button, Icon, Input } from '@/components/ui';
import { showMessage } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import { ensureProperty, useCustomerProperties } from '@/data/properties';
import { AddressFields } from '@/components/ui/AddressFields';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

const EMPTY = { name: '', address: '', city: '', state: '', zip: '' };

export function CustomerPropertiesCard({ customerId, firstName }: { customerId: string; firstName: string }) {
  const { colors } = useTheme();
  useDb();
  const properties = useCustomerProperties(customerId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY) => (v: string) => setForm({ ...form, [k]: v });

  async function save() {
    if (!form.address.trim()) return showMessage('Add the address', 'Enter the street address.');
    setSaving(true);
    const res = await ensureProperty(customerId, form);
    setSaving(false);
    if (!res.ok) return showMessage("Couldn't add the property", res.missing ? 'This needs the latest database update (79).' : res.error);
    if (!res.created) showMessage('Already saved', `${firstName} already has a property at that address, so it was not added twice.`);
    setForm(EMPTY);
    Keyboard.dismiss();
    setAdding(false);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
      <View style={styles.head}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700', flex: 1 }]}>Properties ({properties.length})</Text>
        {!adding ? <Button title="Add" icon="plus" size="sm" variant="secondary" onPress={() => setAdding(true)} /> : null}
      </View>

      {properties.length === 0 && !adding ? (
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          No saved properties yet. Add one here, or pick this customer in any project, Maintenance or Snow form and their address is saved automatically.
        </Text>
      ) : null}

      {properties.map((p, i) => {
        const projects = db.projects.filter((x) => x.propertyId === p.id).length;
        const maintenance = db.maintenance.properties.filter((x) => x.propertyId === p.id).length;
        const uses = [
          projects ? `${projects} landscaping project${projects === 1 ? '' : 's'}` : null,
          maintenance ? 'Maintenance' : null,
        ].filter(Boolean).join(' · ');
        return (
          <View key={p.id} style={[styles.row, i > 0 || true ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight } : null]}>
            <Icon name="map-pin" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{p.name || p.address}</Text>
              <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{[p.address, p.city, p.state].filter(Boolean).join(', ')}</Text>
              {uses ? <Text style={[typeScale.caption, { color: colors.primary }]}>{uses}</Text> : null}
            </View>
          </View>
        );
      })}

      {adding ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <Input label="Property name (optional)" value={form.name} onChangeText={set('name')} placeholder="Oak Plaza" />
          <AddressFields
            value={{ address: form.address, city: form.city, state: form.state, zip: form.zip }}
            onChange={(v) => setForm((f) => ({ ...f, ...v }))}
            streetLabel="Street address"
          />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button title="Cancel" variant="ghost" onPress={() => { setAdding(false); setForm(EMPTY); }} />
            <Button title="Save property" loading={saving} onPress={save} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, marginTop: spacing.sm },
});
