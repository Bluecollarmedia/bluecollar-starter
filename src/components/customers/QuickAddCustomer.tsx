import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Keyboard } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { Button, Input } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { useCustomers } from '@/hooks/useCustomers';
import { properName } from '@/lib/names';

/**
 * "Add a new customer" right inside a form (a new property or project), so the owner never has to leave it to make one.
 * The new customer is created like one from More → Customers and handed back so the form can pick them straight away.
 */
export function QuickAddCustomer({ onAdded }: { onAdded: (personId: string, isNew?: boolean) => void }) {
  const { colors } = useTheme();
  const { addCustomer } = useCustomers();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setOpen(false);
    setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setError('');
  }

  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    if (!firstName.trim() || !lastName.trim()) { setError('Enter a first and last name.'); return; }
    const mail = email.trim();
    if (mail && !/^\S+@\S+\.\S+$/.test(mail)) { setError('That email address does not look right.'); return; }
    setSaving(true);
    try {
      const id = await addCustomer({ firstName: properName(firstName), lastName: properName(lastName), email: mail, phone });
      Keyboard.dismiss();
      reset();
      onAdded(id, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The customer couldn't be added.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.addRow} accessibilityRole="button" accessibilityLabel="Add a new customer">
        <Feather name="user-plus" size={18} color={colors.primary} />
        <Text style={[typeScale.bodyLarge, { color: colors.primary, fontWeight: '600' }]}>Add a new customer</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}>
      <Text style={[typeScale.labelLarge, { color: colors.textPrimary, marginBottom: spacing.sm }]}>New customer</Text>
      <View style={styles.row}>
        <Input label="First Name" placeholder="Sarah" value={firstName} onChangeText={setFirstName} autoCapitalize="words" containerStyle={{ flex: 1 }} />
        <Input label="Last Name" placeholder="Mitchell" value={lastName} onChangeText={setLastName} autoCapitalize="words" containerStyle={{ flex: 1 }} />
      </View>
      <Input label="Email (optional)" placeholder="sarah@email.com" value={email} onChangeText={setEmail} icon="mail" keyboardType="email-address" autoCapitalize="none" containerStyle={{ marginTop: spacing.sm }} />
      <Input label="Phone (optional)" placeholder="(216) 555-0000" value={phone} onChangeText={setPhone} icon="phone" keyboardType="phone-pad" containerStyle={{ marginTop: spacing.sm }} />
      {error ? <Text style={[typeScale.caption, { color: colors.error, marginTop: spacing.sm }]}>{error}</Text> : null}
      <View style={styles.actions}>
        <Button title="Add and Choose" onPress={save} icon="user-plus" style={{ flex: 1 }} />
        <Button title="Cancel" onPress={reset} variant="ghost" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  box: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
});
