import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Platform, Image } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import * as ImagePicker from 'expo-image-picker';
import { keepPicked } from '@/lib/keepPickedFile';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Button, Input, Card, DateField } from '@/components/ui';
import { QuickAddCustomer } from '@/components/customers/QuickAddCustomer';
import { PropertyChoice } from '@/components/properties/PropertyChoice';
import { propertyForSave } from '@/data/properties';
import type { Property } from '@/types/property';
import { useCustomers } from '@/hooks/useCustomers';
import { generateProjectCode } from '@/hooks/useCustomerAccess';
import { useProject } from '@/hooks/useProject';
import { insertRow } from '@/data/store';
import { AddressFields, missingAddressPart, type AddressCheck } from '@/components/ui/AddressFields';
import { verifyAddress, DEFAULT_CHECKIN_RADIUS_M } from '@/lib/maps';
import { logProjectHistory, attachImage } from '@/data/actions';
import { getProjectImageUri } from '@/lib/projectImages';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { ProjectStatus } from '@/types/project';

const STATUS_OPTIONS: { key: ProjectStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function showAlert(title: string, msg: string) {
  if (Platform.OS === 'web') alert(msg);
  else Alert.alert(title, msg);
}

/** New Project, or Edit Project when opened with `?editId=<projectId>`. */
export default function NewProjectScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `customerId` is set when this is opened from a customer's own page: that customer is already the customer, so it is not asked again.
  const { editId, customerId: fromCustomer } = useLocalSearchParams<{ editId?: string; customerId?: string }>();
  const { project: existing, updateProject } = useProject(editId ?? '');
  const isEdit = !!editId && !!existing;
  const { allCustomers } = useCustomers();

  const [name, setName] = useState(existing?.name ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [city, setCity] = useState(existing?.city ?? '');
  const [state, setState] = useState(existing?.state ?? '');
  const [zip, setZip] = useState(existing?.zip ?? '');
  const [addressCheck, setAddressCheck] = useState<AddressCheck>(
    existing?.latitude != null && existing?.longitude != null ? { latitude: existing.latitude, longitude: existing.longitude } : {},
  );
  const [checking, setChecking] = useState(false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [customerId, setCustomerId] = useState<string | undefined>(existing?.customerId ?? (editId ? undefined : fromCustomer));
  const lockedCustomer = !editId && !!fromCustomer && allCustomers.some((c) => c.person.id === fromCustomer);
  const [propertyId, setPropertyId] = useState<string | undefined>(existing?.propertyId);
  const [startDate, setStartDate] = useState(existing?.startDate ?? '');
  const [endDate, setEndDate] = useState(existing?.estimatedEndDate ?? '');
  const [status, setStatus] = useState<ProjectStatus>(existing?.status ?? 'active');
  const [progress, setProgress] = useState(existing?.progress ?? 0);
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission Needed', 'Photo library access is needed to choose a project photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) setPhotoUri(await keepPicked(result.assets[0].uri));
  }

  const customers = useMemo(
    () => allCustomers.slice().sort((a, b) => `${a.person.firstName} ${a.person.lastName}`.localeCompare(`${b.person.firstName} ${b.person.lastName}`)),
    [allCustomers],
  );

  async function handleSave() {
    if (!name.trim()) {
      showAlert('Required', 'Please enter a project name.');
      return;
    }
    const missingAddress = missingAddressPart({ address, city, state, zip });
    if (missingAddress) {
      showAlert('Address needed', missingAddress);
      return;
    }
    for (const [label, value] of [['Start date', startDate], ['Estimated end date', endDate]] as const) {
      if (value.trim() && !DATE_RE.test(value.trim())) {
        showAlert('Check the date', `${label} should look like 2026-05-01 (year-month-day).`);
        return;
      }
    }

    // Look the address up on the map so Open Maps goes to the exact spot.
    if (Platform.OS !== 'web' && addressCheck.latitude == null && !addressCheck.overridden) {
      setChecking(true);
      const r = await verifyAddress({ address, city, state, zip });
      setChecking(false);
      if (r.status === 'found') {
        const found = { latitude: r.latitude, longitude: r.longitude };
        setAddressCheck(found);
        save(found);
        return;
      }
      if (r.status === 'not_found') {
        Alert.alert(
          'Address not found on the map',
          'Double-check the address. If it\u2019s right (a new build, for example), you can save it as typed.',
          [
            { text: 'Fix Address', style: 'cancel' },
            { text: 'Save As Typed', onPress: () => { setAddressCheck({ overridden: true }); save({ overridden: true }); } },
          ],
        );
        return;
      }
    }
    save(addressCheck);
  }

  /** Picking one of the customer's saved properties fills the address; picking "New address" lets you type one. */
  function pickProperty(p: Property | null) {
    if (!p) { setPropertyId(undefined); return; }
    setPropertyId(p.id);
    setAddress(p.address); setCity(p.city ?? ''); setState(p.state ?? ''); setZip(p.zip ?? '');
    setAddressCheck(p.latitude != null && p.longitude != null ? { latitude: p.latitude, longitude: p.longitude } : {});
  }

  function changeCustomer(id: string | undefined) {
    if (id !== customerId) setPropertyId(undefined);
    setCustomerId(id);
  }

  async function save(check: AddressCheck) {
    // The address is saved ONCE for the customer (or their existing property is reused); this project links to it.
    const linked = await propertyForSave({
      customerId, propertyId,
      fields: { address, city, state: state.trim().toUpperCase(), zip, latitude: check.latitude, longitude: check.longitude },
    });
    if (linked.error) { showAlert('Couldn\'t save the property', linked.error); return; }
    const fields = {
      propertyId: linked.propertyId,
      name: name.trim(),
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim().toUpperCase() || undefined,
      zip: zip.trim() || undefined,
      notes: notes.trim() || undefined,
      customerId,
      startDate: startDate.trim() || undefined,
      estimatedEndDate: endDate.trim() || undefined,
      latitude: check.latitude,
      longitude: check.longitude,
    };

    if (isEdit) {
      updateProject({ ...fields, status, progress });
      if (photoUri) attachImage('projects', existing!.id, 'coverPhotoUrl', photoUri, `projects/${existing!.id}`);
      router.back();
      return;
    }

    const project = insertRow('projects', {
      ...fields,
      status: 'active',
      progress: 0,
      customerProjectCode: generateProjectCode(),
    });
    insertRow('project_settings', {
      projectId: project.id,
      customerInteractionEnabled: true,
      completionPhotoRequired: false,
      checkinRadiusMeters: DEFAULT_CHECKIN_RADIUS_M,
      customerCanRequest: true,
      customerCanViewPhotos: true,
      customerCanComment: true,
    });
    logProjectHistory(project.id, 'project_created', `Project created: ${fields.name}`);
    if (photoUri) attachImage('projects', project.id, 'coverPhotoUrl', photoUri, `projects/${project.id}`);
    router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Cancel">
            <Icon name="x" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>
            {isEdit ? 'Edit Project' : 'New Project'}
          </Text>
        </View>
      </View>

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          {isEdit && (
            <Card title="Status & Progress" style={{ marginBottom: spacing.lg }}>
              <View style={styles.chipRow}>
                {(existing?.status === 'prospect' ? [{ key: 'prospect' as const, label: 'Prospect' }, ...STATUS_OPTIONS] : STATUS_OPTIONS).map((opt) => {
                  const active = status === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => setStatus(opt.key)}
                      style={[styles.chip, { backgroundColor: active ? colors.primary : colors.backgroundTertiary }]}
                    >
                      <Text style={[typeScale.labelSmall, { color: active ? '#FFFFFF' : colors.textSecondary, fontWeight: '600' }]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.lg }]}>Progress</Text>
              <View style={styles.progressRow}>
                <Pressable
                  onPress={() => setProgress((v) => Math.max(0, v - 5))}
                  style={[styles.stepButton, { borderColor: colors.border }]}
                  accessibilityLabel="Decrease progress"
                >
                  <Icon name="minus" size={18} color={colors.textPrimary} />
                </Pressable>
                <Text style={[typeScale.displaySmall, { color: colors.primary, minWidth: 80, textAlign: 'center' }]}>
                  {progress}%
                </Text>
                <Pressable
                  onPress={() => setProgress((v) => Math.min(100, v + 5))}
                  style={[styles.stepButton, { borderColor: colors.border }]}
                  accessibilityLabel="Increase progress"
                >
                  <Icon name="plus" size={18} color={colors.textPrimary} />
                </Pressable>
              </View>
              <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
                The customer sees this on their project page.
              </Text>
            </Card>
          )}

          <Card title="Project Photo" style={{ marginBottom: spacing.lg }}>
            <Pressable onPress={handlePickPhoto} accessibilityRole="button" accessibilityLabel="Choose project photo">
              {photoUri || existing?.coverPhotoUrl ? (
                <Image
                  source={{ uri: photoUri ?? (existing ? getProjectImageUri(existing) : undefined) }}
                  style={styles.photoPreview}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.photoPreview, styles.photoEmpty, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
                  <Icon name="camera" size={24} color={colors.textTertiary} />
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                    Add a photo of the property (optional)
                  </Text>
                </View>
              )}
            </Pressable>
            {(photoUri || existing?.coverPhotoUrl) && (
              <Button title="Choose a different photo" onPress={handlePickPhoto} variant="ghost" size="sm" />
            )}
          </Card>

          {lockedCustomer ? (
            <Card title="Customer" style={{ marginBottom: spacing.lg }}>
              {(() => {
                const c = allCustomers.find((x) => x.person.id === customerId);
                return (
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>
                    {c ? `${c.person.firstName} ${c.person.lastName}`.trim() || c.person.email : 'Customer'}
                  </Text>
                );
              })()}
            </Card>
          ) : (
          <Card title="Customer" style={{ marginBottom: spacing.lg }}>
            {customers.length === 0 ? (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                No customers yet. Add one below, then send them a private link from their page so they can see the project.
              </Text>
            ) : (
              <View style={styles.chipRow}>
                <Pressable
                  onPress={() => changeCustomer(undefined)}
                  style={[styles.chip, { backgroundColor: !customerId ? colors.primary : colors.backgroundTertiary }]}
                >
                  <Text style={[typeScale.labelSmall, { color: !customerId ? '#FFFFFF' : colors.textSecondary, fontWeight: '600' }]}>
                    None
                  </Text>
                </Pressable>
                {customers.map((c) => {
                  const active = customerId === c.person.id;
                  return (
                    <Pressable
                      key={c.person.id}
                      onPress={() => changeCustomer(c.person.id)}
                      style={[styles.chip, { backgroundColor: active ? colors.primary : colors.backgroundTertiary }]}
                    >
                      <Text style={[typeScale.labelSmall, { color: active ? '#FFFFFF' : colors.textSecondary, fontWeight: '600' }]}>
                        {`${c.person.firstName} ${c.person.lastName}`.trim() || c.person.email}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <QuickAddCustomer onAdded={changeCustomer} />
          </Card>
          )}

          <Card title="Project Info">
            <Input
              label="Project Name"
              placeholder="e.g. Smith Backyard Renovation"
              value={name}
              onChangeText={setName}
              icon="folder"
              containerStyle={styles.fieldGap}
            />
            <PropertyChoice customerId={customerId} propertyId={propertyId} onSelect={pickProperty} />
            {propertyId ? (
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginBottom: spacing.md }]}>{[address, city, state, zip].filter(Boolean).join(', ')}</Text>
            ) : (
            <AddressFields
              required
              style={styles.fieldGap}
              value={{ address, city, state, zip }}
              onChange={(v) => { setAddress(v.address); setCity(v.city); setState(v.state); setZip(v.zip); }}
              check={addressCheck}
              onCheckChange={setAddressCheck}
            />
            )}
            <View style={styles.row}>
              <DateField
                label="Start Date"
                placeholder="Select date"
                value={startDate}
                onChange={(k) => { setStartDate(k); if (endDate && endDate < k) setEndDate(''); }}
                onClear={() => setStartDate('')}
                containerStyle={{ ...styles.fieldGap, flex: 1 }}
              />
              <DateField
                label="Est. End Date"
                placeholder="Select date"
                value={endDate}
                onChange={setEndDate}
                onClear={() => setEndDate('')}
                minimumDate={startDate || undefined}
                containerStyle={{ ...styles.fieldGap, flex: 1 }}
              />
            </View>
          </Card>

          <Card title="Internal Notes" style={{ marginTop: spacing.lg }}>
            <Input
              placeholder="Any notes about this project (not visible to customer)"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              containerStyle={styles.fieldGap}
            />
          </Card>

          <View style={styles.actions}>
            <Button
              title={isEdit ? 'Save Changes' : 'Create Project'}
              onPress={handleSave}
              loading={checking}
              icon={isEdit ? 'check' : 'plus'}
              fullWidth
              size="lg"
            />
            <Button title="Cancel" onPress={() => router.back()} variant="ghost" fullWidth />
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backButton: { padding: spacing.xs },
  scrollContent: { paddingBottom: spacing['5xl'] },
  form: { padding: spacing.lg },
  fieldGap: { marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, marginVertical: spacing.md },
  stepButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { marginTop: spacing['2xl'], gap: spacing.sm },
  photoPreview: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md },
  photoEmpty: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
});
