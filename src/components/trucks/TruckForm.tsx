/**
 * One form for adding a truck and for editing an existing one: name, make, model, year, plate, VIN, color, status, a photo
 * (take / choose / remove) and the short notes box. When adding, the owner can also attach documents (insurance, PDFs); they are
 * uploaded as soon as the truck is saved. On an existing truck, documents and private notes live on the truck's own page.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, Input, OptimizedImage, GlassIconButton } from '@/components/ui';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { TruckDocumentSheet } from './TruckDocumentSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import { attachImage } from '@/data/actions';
import { useTrucks } from '@/hooks/useTrucks';
import { addTruckDocument, useIsOwner, type DocumentInput } from '@/data/truckFiles';
import { pickImage } from '@/lib/pickImage';
import { kindLabel, formatSize } from '@/lib/truckDocs';
import { semantic } from '@/theme/colors';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { TruckStatus } from '@/types/truck';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { showMessage } from '@/components/financials/ActionSheet';

const STATUS_OPTIONS: { key: TruckStatus; label: string; dot: string }[] = [
  { key: 'available', label: 'Available', dot: semantic.success },
  { key: 'assigned', label: 'Assigned', dot: semantic.info },
  { key: 'maintenance', label: 'Maintenance', dot: semantic.warning },
  { key: 'out_of_service', label: 'Out of Service', dot: semantic.error },
];

const alertBox = (title: string, msg: string) => showMessage(title, msg);

export function TruckForm({ truckId }: { truckId?: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { addTruck, updateTruck, allTrucks } = useTrucks();
  const isOwner = useIsOwner();
  const existing = truckId ? allTrucks.find((t) => t.id === truckId) : undefined;
  const editing = !!truckId;

  const [name, setName] = useState(existing?.name ?? '');
  const [make, setMake] = useState(existing?.make ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [year, setYear] = useState(existing?.year ? String(existing.year) : '');
  const [plate, setPlate] = useState(existing?.licensePlate ?? '');
  const [vin, setVin] = useState(existing?.vin ?? '');
  const [color, setColor] = useState(existing?.color ?? '');
  const [status, setStatus] = useState<TruckStatus>(existing?.status ?? 'available');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  // The photo shown: the saved one, a newly picked one, or none. `photoChanged` says whether to save it.
  const [photoUri, setPhotoUri] = useState<string | undefined>(existing?.photoUrl);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [docSheet, setDocSheet] = useState(false);
  const [staged, setStaged] = useState<DocumentInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function pick(source: 'camera' | 'library') {
    setPhotoSheet(false);
    // The sheet has to be gone before iOS will show the picker.
    const res = await pickImage(source, { afterSheetMs: 650 });
    if (res.status === 'picked') { setPhotoUri(res.uri); setPhotoChanged(true); setError(null); }
    else if (res.status === 'error') setError(res.message);
  }

  async function save() {
    if (!name.trim()) { alertBox('Required', 'Please enter a truck name.'); return; }
    setSaving(true);
    setError(null);
    const fields = {
      name: name.trim(),
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      year: year.trim() ? Number(year.trim()) : undefined,
      licensePlate: plate.trim() || undefined,
      vin: vin.trim() || undefined,
      color: color.trim() || undefined,
      status,
      notes: notes.trim() || undefined,
    };
    let id = truckId;
    if (editing && truckId) {
      // Cleared boxes are saved as empty (null), so a removed value really goes away.
      updateTruck(truckId, {
        ...fields,
        make: fields.make ?? null, model: fields.model ?? null, year: fields.year ?? null, licensePlate: fields.licensePlate ?? null,
        vin: fields.vin ?? null, color: fields.color ?? null, notes: fields.notes ?? null,
        ...(photoChanged && !photoUri ? { photoUrl: null } : {}),
      } as never);
    } else {
      id = addTruck({ companyId: db.companyId, ...fields }).id;
    }
    if (id && photoChanged && photoUri) attachImage('trucks', id, 'photoUrl', photoUri, 'trucks');

    // Documents chosen while adding are uploaded now that the truck exists.
    if (!editing && id && staged.length) {
      const failed: string[] = [];
      for (const d of staged) {
        const r = await addTruckDocument(id, d);
        if (!r.ok) failed.push(`${d.title}: ${r.error}`);
      }
      if (failed.length) alertBox('Some documents were not saved', `${failed.join('\n')}\n\nYou can add them again from the truck's page.`);
    }
    setSaving(false);
    router.back();
  }

  if (editing && !existing) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg }]}>
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Go back" />
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.xl }]}>This truck couldn't be found.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Go back" />
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{editing ? 'Edit Truck' : 'Add Truck'}</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} keyboardShouldPersistTaps="handled">
        <Pressable style={[styles.photoBox, { borderColor: colors.borderLight }]} onPress={() => setPhotoSheet(true)} accessibilityRole="button" accessibilityLabel={photoUri ? 'Change the truck photo' : 'Add a truck photo'}>
          {photoUri ? (
            <>
              <OptimizedImage source={photoUri} style={styles.photoPreview} />
              <View style={[styles.photoBadge, { backgroundColor: colors.primary }]}><Icon name="camera" size={14} color={colors.textOnPrimary} /></View>
            </>
          ) : (
            <>
              <View style={[styles.photoCircle, { backgroundColor: colors.primarySurface }]}><Icon name="camera" size={28} color={colors.primary} /></View>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', marginTop: spacing.md }]}>Add a photo (optional)</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>Helps easily identify this vehicle</Text>
            </>
          )}
        </Pressable>
        {photoUri ? (
          <Pressable onPress={() => setPhotoSheet(true)} style={{ alignSelf: 'center' }}><Text style={[typeScale.labelLarge, { color: colors.primary }]}>Change photo</Text></Pressable>
        ) : null}

        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Truck #5" />
        <View style={styles.row}>
          <Input label="Make" value={make} onChangeText={setMake} placeholder="e.g. Ford" containerStyle={{ flex: 1 }} />
          <Input label="Model" value={model} onChangeText={setModel} placeholder="e.g. F-250" containerStyle={{ flex: 1 }} />
        </View>
        <View style={styles.row}>
          <Input label="Year" value={year} onChangeText={(v) => setYear(v.replace(/[^0-9]/g, '').slice(0, 4))} placeholder="e.g. 2022" keyboardType="number-pad" containerStyle={{ flex: 1 }} />
          <Input label="License Plate" value={plate} onChangeText={setPlate} placeholder="e.g. OH-YCO-101" autoCapitalize="characters" containerStyle={{ flex: 1 }} />
        </View>
        <View style={styles.row}>
          <Input label="VIN" value={vin} onChangeText={(v) => setVin(v.toUpperCase().slice(0, 17))} placeholder="17 characters" autoCapitalize="characters" autoCorrect={false} containerStyle={{ flex: 1 }} />
          <Input label="Color" value={color} onChangeText={setColor} placeholder="e.g. White" containerStyle={{ flex: 1 }} />
        </View>

        <View>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Status</Text>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map((opt) => {
              const active = status === opt.key;
              return (
                <Pressable key={opt.key} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setStatus(opt.key)}
                  style={[styles.statusPill, { backgroundColor: active ? `${opt.dot}1A` : colors.backgroundTertiary, borderColor: active ? opt.dot : 'transparent' }]}>
                  <View style={[styles.statusDot, { backgroundColor: opt.dot }]} />
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: active ? '700' : '500' }]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Input label="Notes (optional)" value={notes} onChangeText={(v) => setNotes(v.slice(0, 200))} placeholder="e.g. Primary crew truck" multiline maxLength={200} hint={`${notes.length}/200. Your crew can see this short note.`} />

        {!editing && isOwner ? (
          <View style={[styles.docs, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>Insurance</Text>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Optional. PDFs or photos. Only you can see these.</Text>
            {staged.map((d, i) => (
              <View key={`${d.uri}-${i}`} style={styles.stagedRow}>
                <Icon name={d.mimeType === 'application/pdf' ? 'file-text' : 'image'} size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{d.title}</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{[kindLabel(d.kind), formatSize(d.size)].filter(Boolean).join(' · ')}</Text>
                </View>
                <Pressable onPress={() => setStaged((s) => s.filter((_, j) => j !== i))} hitSlop={10} accessibilityLabel={`Remove ${d.title}`}><Icon name="x" size={18} color={colors.textTertiary} /></Pressable>
              </View>
            ))}
            <Button title="Add Insurance" icon="plus" variant="secondary" onPress={() => setDocSheet(true)} fullWidth />
          </View>
        ) : null}

        {error ? <Text style={[typeScale.bodySmall, { color: colors.error }]}>{error}</Text> : null}
        <Button title={editing ? 'Save Changes' : 'Add Truck'} icon={editing ? 'check' : 'plus'} onPress={save} loading={saving} disabled={saving} fullWidth size="lg" />
      </KeyboardAwareScrollView>

      <TruckDocumentSheet visible={docSheet} onClose={() => setDocSheet(false)} onSubmit={async (input) => { setStaged((s) => [...s, input]); return null; }} />

      <BottomSheetModal visible={photoSheet} onRequestClose={() => setPhotoSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPhotoSheet(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surfaceElevated, paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <View style={[styles.handle, { backgroundColor: colors.borderLight }]} />
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md }]}>Vehicle Photo</Text>
            <Pressable style={styles.option} onPress={() => pick('camera')}><Icon name="camera" size={18} color={colors.textPrimary} /><Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>Take Photo</Text></Pressable>
            <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
            <Pressable style={styles.option} onPress={() => pick('library')}><Icon name="image" size={18} color={colors.textPrimary} /><Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>Choose from Library</Text></Pressable>
            {photoUri ? (
              <>
                <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
                <Pressable style={styles.option} onPress={() => { setPhotoSheet(false); setPhotoUri(undefined); setPhotoChanged(true); }}>
                  <Icon name="trash-2" size={18} color={semantic.error} /><Text style={[typeScale.bodyLarge, { color: semantic.error }]}>Remove Photo</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable style={[styles.cancel, { backgroundColor: colors.backgroundSecondary }]} onPress={() => setPhotoSheet(false)}><Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Cancel</Text></Pressable>
          </Pressable>
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'], gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  photoBox: { height: 180, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoPreview: { width: '100%', height: '100%' },
  photoBadge: { position: 'absolute', right: spacing.sm, bottom: spacing.sm, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  photoCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 38, borderRadius: radius.full, borderWidth: 1.5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  docs: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm },
  stagedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  divider: { height: StyleSheet.hairlineWidth },
  cancel: { height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
});
