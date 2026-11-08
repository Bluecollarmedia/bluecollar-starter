/**
 * Create Quote → New Project: who the quote is for and the property. Uses an
 * existing customer when there is one (or reuses one with the same email),
 * and offers the existing project when the address is already a project, so
 * nothing is created twice. The project is saved as a Prospect.
 */

import { applyStreetInput } from '@/lib/address';
import { StreetSuggestions } from '@/components/ui/StreetSuggestions';
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Button, ListSection, ListRow, SearchBar } from '@/components/ui';
import { InputRow } from './FormBits';
import { confirmAction, showMessage } from './ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { useCustomers } from '@/hooks/useCustomers';
import { db, rowsOf } from '@/data/store';
import { matchingProjects, createProspectProject } from '@/data/financials';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** Calls onReady with the project the quote goes on, and whether this form just created it. */
export function NewProjectForm({ onReady }: { onReady: (projectId: string, created: boolean) => void }) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const { customers, allCustomers, addCustomer } = useCustomers({ search });
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>(allCustomers.length ? 'existing' : 'new');
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = customerId ? db.people[customerId] : undefined;
  const lastName = customerMode === 'existing' ? chosen?.lastName : last.trim();
  const defaultName = lastName ? `${lastName} Residence` : address.trim();

  const shown = useMemo(() => customers.slice(0, search.trim() ? 20 : 6), [customers, search]);

  const finish = (custId: string | undefined) => {
    const matches = matchingProjects(custId, address);
    const create = () => {
      setBusy(true);
      const p = createProspectProject({ customerId: custId, name: name.trim() || defaultName, address, city, state, zip });
      onReady(p.id, true);
    };
    if (matches.length) {
      const m = matches[0];
      confirmAction(
        'This address is already a project',
        `“${m.name}” is at ${m.address}. The quote will go on that project instead of creating a second one.`,
        'Use That Project',
        () => { setBusy(true); onReady(m.id, false); },
      );
      return;
    }
    create();
  };

  const submit = () => {
    if (customerMode === 'existing' && !customerId) {
      showMessage('Choose a customer', 'Pick the customer this quote is for, or add a new customer.');
      return;
    }
    if (customerMode === 'new') {
      if (!first.trim() || !last.trim()) {
        showMessage('Customer name needed', 'Enter the customer’s first and last name.');
        return;
      }
      if (email.trim() && !EMAIL_RE.test(email.trim())) {
        showMessage('Check the email', 'Enter a valid email address, or leave it empty.');
        return;
      }
    }
    if (!address.trim()) {
      showMessage('Address needed', 'Enter the property’s street address so the quote shows where the work is.');
      return;
    }

    if (customerMode === 'existing') {
      finish(customerId);
      return;
    }

    // Same email: addCustomer reuses that person. Same name, no email: ask.
    const sameName = !email.trim()
      ? allCustomers.find((c) =>
          c.person.firstName.trim().toLowerCase() === first.trim().toLowerCase() &&
          c.person.lastName.trim().toLowerCase() === last.trim().toLowerCase())
      : undefined;
    const sameEmail = email.trim()
      ? rowsOf('people').find((p) => (p.email ?? '').toLowerCase() === email.trim().toLowerCase())
      : undefined;
    if (sameName && !sameEmail) {
      confirmAction(
        'Already a customer',
        `${first.trim()} ${last.trim()} is already a customer${sameName.person.email ? ` (${sameName.person.email})` : ''}. Use that customer?`,
        'Use Existing',
        () => finish(sameName.person.id),
      );
      return;
    }
    setBusy(true);
    addCustomer({ firstName: first, lastName: last, email, phone })
      .then((id) => { setBusy(false); finish(id); })
      .catch((e) => { setBusy(false); showMessage("Couldn't add the customer", e instanceof Error ? e.message : 'Please try again.'); });
  };

  const toggle = (
    <View style={[styles.toggle, { backgroundColor: colors.backgroundTertiary }]}>
      {(['existing', 'new'] as const).map((m) => {
        const on = customerMode === m;
        return (
          <Pressable
            key={m}
            onPress={() => setCustomerMode(m)}
            style={[styles.toggleItem, on && { backgroundColor: colors.surface }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[typeScale.labelLarge, { color: on ? colors.textPrimary : colors.textSecondary }]}>
              {m === 'existing' ? 'Existing Customer' : 'New Customer'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View>
      <Text style={[typeScale.labelSmall, styles.label, { color: colors.textSecondary }]}>CUSTOMER</Text>
      {toggle}
      {customerMode === 'existing' ? (
        <>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search customers" style={{ marginBottom: spacing.sm }} />
          {shown.length === 0 ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.lg, marginLeft: spacing.xs }]}>
              No customers found. Switch to New Customer to add one.
            </Text>
          ) : (
            <ListSection>
              {shown.map((c) => (
                <ListRow
                  key={c.person.id}
                  icon="user"
                  title={`${c.person.firstName} ${c.person.lastName}`.trim()}
                  subtitle={[c.person.email, c.person.phone].filter(Boolean).join(' · ') || undefined}
                  selected={customerId === c.person.id}
                  onPress={() => setCustomerId(c.person.id)}
                />
              ))}
            </ListSection>
          )}
        </>
      ) : (
        <ListSection footer="If this email is already a customer, that customer is used.">
          <InputRow label="First name" value={first} onChangeText={setFirst} placeholder="Required" autoCapitalize="words" />
          <InputRow label="Last name" value={last} onChangeText={setLast} placeholder="Required" autoCapitalize="words" />
          <InputRow label="Email" value={email} onChangeText={setEmail} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" />
          <InputRow label="Phone" value={phone} onChangeText={setPhone} placeholder="Optional" keyboardType="phone-pad" />
        </ListSection>
      )}

      <ListSection title="PROPERTY" footer="Saved as a Prospect: not on the schedule and no crew until the quote is approved and you start the project.">
        <InputRow
          label="Street"
          value={address}
          onChangeText={(text) => {
            const next = applyStreetInput(text, { address, city, state, zip });
            setAddress(next.address); setCity(next.city); setState(next.state); setZip(next.zip);
          }}
          placeholder="Required"
          autoCapitalize="words"
        />
        <StreetSuggestions text={address} onPick={(pl) => { setAddress(pl.address); setCity(pl.city); setState(pl.state); setZip(pl.zip); }} />
        <InputRow label="City" value={city} onChangeText={setCity} placeholder="Optional" autoCapitalize="words" />
        <InputRow label="State" value={state} onChangeText={setState} placeholder="Optional" autoCapitalize="characters" maxLength={2} />
        <InputRow label="ZIP" value={zip} onChangeText={setZip} placeholder="Optional" keyboardType="number-pad" maxLength={10} />
        <InputRow label="Project name" value={name} onChangeText={setName} placeholder={defaultName || 'e.g. Smith Residence'} autoCapitalize="words" />
      </ListSection>

      <Button title="Continue to Quote" onPress={submit} loading={busy} fullWidth />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginLeft: spacing.md, marginBottom: spacing.xs, letterSpacing: 0.5 },
  toggle: { flexDirection: 'row', borderRadius: radius.md, padding: 2, marginBottom: spacing.md },
  toggleItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md - 2 },
});
