/**
 * Add or change one entry in a truck's maintenance log: a title (tap a suggestion or type your own), the date the service was done,
 * when it is next due (you get a reminder that morning), and notes about what was done.
 */
import { useKeepDraft } from '@/hooks/useKeepDraft';
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, DateField } from '@/components/ui';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useTheme } from '@/providers/ThemeProvider';
import { TITLE_SUGGESTIONS, NOTES_MAX, maintenanceProblem } from '@/lib/truckMaintenance';
import { localDateKey } from '@/lib/ids';
import type { MaintenanceInput } from '@/data/truckFiles';
import type { TruckMaintenance } from '@/types/truck';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

interface Props {
  visible: boolean;
  /** Set to change an existing entry; empty to add a new one. */
  editing?: TruckMaintenance | null;
  onClose: () => void;
  /** Return an error sentence to show, or null when it worked (the sheet then closes). */
  onSubmit: (input: MaintenanceInput) => string | null;
}

export function TruckMaintenanceSheet({ visible, editing, onClose, onSubmit }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [servicedOn, setServicedOn] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Swipe it away and open it again: what you typed is still there (until it is sent or you leave the page).
  const markSaved = useKeepDraft(visible, editing?.id ?? 'new', () => {
    setTitle(editing?.title ?? '');
    setServicedOn(editing?.servicedOn ?? localDateKey(new Date()));
    setDueOn(editing?.dueOn ?? '');
    setNotes(editing?.notes ?? '');
    setError(null);
  });

  function save() {
    const input = { title, servicedOn, dueOn: dueOn || undefined, notes };
    const problem = maintenanceProblem(input);
    if (problem) { setError(problem); return; }
    const err = onSubmit(input);
    if (err) setError(err); else { markSaved(); Keyboard.dismiss(); onClose(); }
  }

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: colors.borderLight }]} />
          <View style={styles.head}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{editing ? 'Change maintenance' : 'Add maintenance'}</Text>
            <Pressable onPress={onClose} hitSlop={10}><Text style={[typeScale.bodySmall, { color: colors.textSecondary, fontWeight: '600' }]}>Cancel</Text></Pressable>
          </View>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.sm }}>
            <Input label="Title" value={title} onChangeText={(t) => { setTitle(t); setError(null); }} placeholder="For example: Oil change" />
            <View style={styles.chips}>
              {TITLE_SUGGESTIONS.map((s) => (
                <Pressable key={s} onPress={() => { setTitle(s); setError(null); }} accessibilityRole="button" style={[styles.chip, { backgroundColor: colors.backgroundTertiary }]}>
                  <Text style={[typeScale.labelSmall, { color: colors.textSecondary }]}>{s}</Text>
                </Pressable>
              ))}
            </View>
            <DateField label="Date of service" value={servicedOn} onChange={(d) => { setServicedOn(d); setError(null); }} placeholder="Select date" />
            <DateField label="Next service due (optional)" value={dueOn} onChange={(d) => { setDueOn(d); setError(null); }} onClear={() => setDueOn('')} placeholder="Select date" />
            {dueOn ? <Text style={[typeScale.caption, { color: colors.textTertiary }]}>You will get a reminder on your phone that morning.</Text> : null}
            <View>
              <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginBottom: 6 }]}>Service performed</Text>
              <TextInput
                value={notes}
                onChangeText={(t) => setNotes(t.slice(0, NOTES_MAX))}
                placeholder="What was done: oil and filter, rotated tires..."
                placeholderTextColor={colors.textTertiary}
                multiline
                style={[typeScale.bodyLarge, styles.notes, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.backgroundSecondary }]}
                accessibilityLabel="Service performed"
              />
            </View>
            {error ? <Text style={[typeScale.bodySmall, { color: colors.error }]}>{error}</Text> : null}
            <Button title={editing ? 'Save Changes' : 'Add Maintenance'} icon="check" onPress={save} fullWidth size="lg" />
          </ScrollView>
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, height: 30, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  notes: { minHeight: 96, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, textAlignVertical: 'top' },
});
