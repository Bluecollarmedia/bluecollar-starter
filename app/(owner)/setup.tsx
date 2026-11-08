import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform, Alert, Keyboard } from 'react-native';
import { Switch } from '@/components/ui/Switch';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Button, Input, Card } from '@/components/ui';
import { AddressFields } from '@/components/ui/AddressFields';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { db, useDb, updateRow } from '@/data/store';
import { attachImage } from '@/data/actions';
import { useCompanySetup, SETUP_STEPS } from '@/hooks/useCompanySetup';
import { useTrucks } from '@/hooks/useTrucks';
import { usePayroll, useNotifications } from '@/hooks/useOperations';
import { usePendingInvites } from '@/hooks/useInvites';
import { EVENT_LABELS, ALL_EVENTS } from '@/lib/notificationEvents';
import { getCompanyImageUri, getWorkerHeaderImageUri } from '@/lib/projectImages';
import { HeaderPhotoField } from '@/components/media/HeaderPhotoField';
import type { SetupStepKey } from '@/types/company';

/** Recommended first-time setup for the owner. Opens automatically until it's been walked through once. */
export default function CompanySetupScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ step?: string }>();
  useDb();
  const setup = useCompanySetup();

  const startIndex = Math.max(0, SETUP_STEPS.findIndex((s) => s.key === params.step));
  const [index, setIndex] = useState(startIndex);
  const step = setup.steps[index];
  const isLast = index === SETUP_STEPS.length - 1;

  function confirm(title: string, message: string, ok: string, onOk: () => void) {
    Alert.alert(title, message, [
      { text: 'Go Back', style: 'cancel' },
      { text: ok, style: 'destructive', onPress: onOk },
    ]);
  }

  function advance() {
    if (isLast) {
      setup.finishWalkthrough();
      router.back();
    } else {
      setIndex(index + 1);
    }
  }

  function handleContinue(key: SetupStepKey) {
    setup.markDone(key);
    advance();
  }

  function handleSkip() {
    confirm(
      'Skip this step?',
      'This is recommended so the app works properly. It will stay on your dashboard checklist until it’s done.',
      'Skip for Now',
      () => { setup.skip(step.key); advance(); },
    );
  }

  function handleClose() {
    confirm(
      'Finish setup later?',
      'Setup will open again the next time you open the app until you’ve gone through every step.',
      'Later',
      () => router.back(),
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.overline, { color: colors.primary }]}>
            RECOMMENDED SETUP · STEP {index + 1} OF {SETUP_STEPS.length}
          </Text>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: 2 }]}>{step.title}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{step.subtitle}</Text>
        </View>
        <Pressable onPress={handleClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Finish later">
          <Icon name="x" size={24} color={colors.textTertiary} />
        </Pressable>
      </View>

      <View style={styles.progressRow}>
        {setup.steps.map((s, i) => (
          <Pressable
            key={s.key}
            onPress={() => setIndex(i)}
            style={[
              styles.progressDot,
              { backgroundColor: s.done ? colors.primary : i === index ? colors.primaryLight : colors.borderLight },
            ]}
            accessibilityLabel={`Step ${i + 1}: ${s.title}${s.done ? ', done' : ''}`}
          />
        ))}
      </View>

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step.key === 'trucks' && <TrucksStep />}
        {step.key === 'workers' && <WorkersStep />}
        {step.key === 'payRates' && <PayRatesStep onGoToWorkers={() => setIndex(1)} />}
        {step.key === 'notifications' && <NotificationsStep />}
        {step.key === 'company' && <CompanyStep onSaved={() => handleContinue('company')} />}
      </KeyboardAwareScrollView>

      {step.key !== 'company' && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.borderLight, backgroundColor: colors.background }]}>
          <Button
            title={isLast ? 'Finish Setup' : 'Save & Continue'}
            onPress={() => handleContinue(step.key)}
            icon="arrow-right"
            iconPosition="right"
            fullWidth
            disabled={!canContinue(step.key)}
          />
          <Pressable onPress={handleSkip} hitSlop={8} style={styles.skipLink}>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Skip for now</Text>
          </Pressable>
        </View>
      )}
      {step.key === 'company' && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.borderLight, backgroundColor: colors.background }]}>
          <Pressable onPress={handleSkip} hitSlop={8} style={styles.skipLink}>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Skip for now</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Steps that need real data before "Save & Continue" works; the rest can be confirmed as-is. */
function canContinue(key: SetupStepKey): boolean {
  if (key === 'trucks') return db.trucks.length > 0;
  return true;
}

// ── Step 1: trucks ──────────────────────────────────────────────────────────

function TrucksStep() {
  const { colors } = useTheme();
  const { allTrucks, addTruck } = useTrucks();
  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');

  function handleAdd() {
    if (!name.trim()) return;
    addTruck({
      companyId: db.companyId,
      name: name.trim(),
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      licensePlate: plate.trim() || undefined,
      status: 'available',
    });
    setName(''); setMake(''); setModel(''); setPlate('');
  }

  return (
    <>
      {allTrucks.length > 0 && (
        <Card title={`Your trucks (${allTrucks.length})`} style={styles.section}>
          {allTrucks.map((t) => (
            <View key={t.id} style={[styles.listItem, { borderBottomColor: colors.borderLight }]}>
              <Icon name="truck" size={16} color={colors.primary} />
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{t.name}</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                {[t.make, t.model, t.licensePlate].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ))}
        </Card>
      )}
      <Card title={allTrucks.length ? 'Add another truck' : 'Add a truck'} style={styles.section}>
        <View style={styles.form}>
          <Input label="Truck name" placeholder="e.g. Truck 1 or Big Ford" value={name} onChangeText={setName} icon="truck" />
          <View style={styles.row}>
            <Input label="Make" placeholder="Ford" value={make} onChangeText={setMake} containerStyle={{ flex: 1 }} />
            <Input label="Model" placeholder="F-250" value={model} onChangeText={setModel} containerStyle={{ flex: 1 }} />
          </View>
          <Input label="License plate (optional)" placeholder="ABC-1234" value={plate} onChangeText={setPlate} autoCapitalize="characters" />
          <Button title="Add Truck" onPress={handleAdd} icon="plus" variant="secondary" fullWidth disabled={!name.trim()} />
        </View>
      </Card>
      <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
        Add every truck now. You can add photos and more details later under More → Trucks.
      </Text>
    </>
  );
}

// ── Step 2: workers ─────────────────────────────────────────────────────────

function WorkersStep() {
  const { colors } = useTheme();
  const router = useRouter();
  const { invites } = usePendingInvites();
  const workers = db.members.filter((m) => m.role === 'worker' && m.status === 'active' && m.person);

  return (
    <>
      <Card title="Add a worker" style={styles.section}>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.md }]}>
          Type a name and a phone number. You get a private link to text or copy. It works once, and the worker sets up their own login from it.
        </Text>
        <Button title="Add Worker" onPress={() => router.push('/(owner)/worker-new' as any)} icon="user-plus" fullWidth />
      </Card>
      <Card title={`On your team (${workers.length})`} style={styles.section}>
        {workers.length === 0 ? (
          <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>No workers yet.</Text>
        ) : workers.map((w) => (
          <View key={w.id} style={[styles.listItem, { borderBottomColor: colors.borderLight }]}>
            <Icon name="user" size={16} color={colors.primary} />
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>
              {`${w.person!.firstName} ${w.person!.lastName}`.trim()}
            </Text>
          </View>
        ))}
        {invites.length > 0 && (
          <Text style={[typeScale.caption, { color: semantic.warning, marginTop: spacing.sm }]}>
            {invites.length} link{invites.length === 1 ? '' : 's'} sent, waiting for the worker to sign up.
          </Text>
        )}
      </Card>
    </>
  );
}

// ── Step 3: pay rates ───────────────────────────────────────────────────────

function PayRatesStep({ onGoToWorkers }: { onGoToWorkers: () => void }) {
  const { colors } = useTheme();
  const { getCurrentRate, setHourlyRate } = usePayroll();
  const workers = db.members.filter((m) => m.role === 'worker' && m.status === 'active' && m.person);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (workers.length === 0) {
    return (
      <Card style={styles.section}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>No workers on the team yet.</Text>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md }]}>
          Once workers join, set their hourly rates here or under More → Payroll. This step stays on your dashboard checklist until it's done.
        </Text>
        <Button title="Back to Invite Workers" onPress={onGoToWorkers} variant="ghost" icon="arrow-left" />
      </Card>
    );
  }

  return (
    <Card title="Hourly rates" style={styles.section}>
      {workers.map((w) => {
        const current = getCurrentRate(w.personId);
        const draft = drafts[w.personId] ?? (current ? String(current) : '');
        const parsed = parseFloat(draft);
        const changed = !isNaN(parsed) && parsed > 0 && parsed !== current;
        return (
          <View key={w.id} style={[styles.rateRow, { borderBottomColor: colors.borderLight }]}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>
              {`${w.person!.firstName} ${w.person!.lastName}`.trim()}
            </Text>
            <Input
              placeholder="$/hr"
              value={draft}
              onChangeText={(t) => setDrafts((d) => ({ ...d, [w.personId]: t.replace(/[^0-9.]/g, '') }))}
              keyboardType="decimal-pad"
              containerStyle={{ width: 100 }}
            />
            <Button
              title={current && !changed ? 'Saved' : 'Save'}
              size="sm"
              variant={changed ? 'primary' : 'ghost'}
              disabled={!changed}
              onPress={() => { Keyboard.dismiss(); setHourlyRate(w.personId, parsed); }}
            />
          </View>
        );
      })}
    </Card>
  );
}

// ── Step 4: notifications ───────────────────────────────────────────────────

function NotificationsStep() {
  const { colors } = useTheme();
  const { getCompanyDefault, updatePreference } = useNotifications();

  return (
    <Card title="Tell me when…" style={styles.section}>
      {ALL_EVENTS.map((ev) => {
        const pref = getCompanyDefault(ev);
        const info = EVENT_LABELS[ev];
        return (
          <View key={ev} style={[styles.listItem, { borderBottomColor: colors.borderLight }]}>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{info.label}</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{info.description}</Text>
            </View>
            <Switch
              value={pref?.enabled ?? true}
              disabled={!pref}
              onValueChange={(on) => pref && updatePreference(pref.id, on)}
            />
          </View>
        );
      })}
      <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>
        You can turn alerts on or off per worker later under More → Notifications.
      </Text>
    </Card>
  );
}

// ── Step 5: company info + dashboard photo ──────────────────────────────────

function CompanyStep({ onSaved }: { onSaved: () => void }) {
  const { colors } = useTheme();
  const c = db.company;
  const [phone, setPhone] = useState(c?.phone ?? '');
  const [email, setEmail] = useState(c?.email ?? '');
  const [address, setAddress] = useState(c?.address ?? '');
  const [city, setCity] = useState(c?.city ?? '');
  const [state, setState] = useState(c?.state ?? '');
  const [zip, setZip] = useState(c?.zip ?? '');
  const [dashboardPhoto, setDashboardPhoto] = useState<string | undefined>(getCompanyImageUri());
  const [workerPhoto, setWorkerPhoto] = useState<string | undefined>(getWorkerHeaderImageUri());

  /** Saves a header photo only when it changed: a new crop uploads, Remove clears it. */
  function saveHeaderPhoto(field: 'coverPhotoUrl' | 'workerCoverPhotoUrl', value: string | undefined, folder: string) {
    if (!c || value === (c[field] || undefined)) return;
    if (value) attachImage('companies', c.id, field, value, folder);
    else updateRow('companies', c.id, { [field]: undefined });
  }

  function handleSave() {
    if (!c) return;
    updateRow('companies', c.id, {
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
    });
    saveHeaderPhoto('coverPhotoUrl', dashboardPhoto, 'company');
    saveHeaderPhoto('workerCoverPhotoUrl', workerPhoto, 'company');
    onSaved();
  }

  return (
    <>
      <Card title="Dashboard photo" style={styles.section}>
        <HeaderPhotoField kind="dashboard" value={dashboardPhoto} onChange={setDashboardPhoto} />
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>
          The Today card at the top of your dashboard.
        </Text>
      </Card>
      <Card title="Workers' home photo" style={styles.section}>
        <HeaderPhotoField kind="worker" value={workerPhoto} onChange={setWorkerPhoto} />
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>
          The top of your workers' Today, Jobs and Activity screens. A job's own cover photo shows instead on days they're scheduled there.
        </Text>
      </Card>
      <Card title={c?.name ?? 'Company'} style={styles.section}>
        <View style={styles.form}>
          <Input label="Business phone" placeholder="(555) 555-0100" value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="phone" />
          <Input label="Business email" placeholder="office@company.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" icon="mail" />
          <AddressFields value={{ address, city, state, zip }} onChange={(v) => { setAddress(v.address); setCity(v.city); setState(v.state); setZip(v.zip); }} />
        </View>
      </Card>
      <Button title="Save & Finish Setup" onPress={handleSave} icon="check" fullWidth />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  progressDot: { flex: 1, height: 6, borderRadius: 3 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'] },
  section: { marginBottom: spacing.lg },
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  codeBox: {
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  skipLink: { paddingTop: spacing.sm },
});
