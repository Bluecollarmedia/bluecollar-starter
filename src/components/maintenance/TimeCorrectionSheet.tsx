/**
 * Owner sheet to set the real time of a maintenance event (a stop's arrival
 * or finish, or a worker's day start) on the route's date. A note is
 * required, and what the crew recorded stays visible next to the correction.
 */

import { useKeepDraft } from '@/hooks/useKeepDraft';
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ListSection } from '@/components/ui';
import { NoteField } from '@/components/financials/FormBits';
import { showMessage } from '@/components/financials/ActionSheet';
import { FormSheet, SheetLabel } from '@/components/materials/FormSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { localDateTime } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, sizing } from '@/theme/spacing';
import type { Result } from '@/data/maintenance';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function TimeCorrectionSheet({ visible, title, description, dateKey, initial, onSave, onClose }: {
  visible: boolean;
  title: string;
  /** What the crew recorded, in words. */
  description: string;
  /** The route's date; the time is set on this day. */
  dateKey: string;
  initial?: string;
  onSave: (at: Date, note: string) => Promise<Result>;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [time, setTime] = useState('08:00');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [androidPicker, setAndroidPicker] = useState(false);

  // Swipe it away and open it again: what you typed is still there (until it is sent or you leave the page).
  const markSaved = useKeepDraft(visible, 'time-correction', () => { setTime(initial ? hhmm(new Date(initial)) : '08:00'); setNote(''); setSaving(false); });

  const at = localDateTime(dateKey, time);

  const save = async () => {
    if (saving) return;
    if (!note.trim()) {
      showMessage('Add a note', 'Say why the time is being corrected, e.g. "Crew forgot to tap I\'m Here".');
      return;
    }
    setSaving(true);
    const res = await onSave(at, note.trim());
    setSaving(false);
    if (!res.ok) showMessage('Couldn’t save the correction', res.error);
    else { markSaved(); onClose(); }
  };

  let control: React.ReactNode;
  if (Platform.OS === 'web') {
    control = React.createElement('input', {
      type: 'time',
      value: time,
      onChange: (e: { target: { value: string } }) => e.target.value && setTime(e.target.value),
      style: { font: 'inherit', fontSize: 16, border: 0, background: 'transparent', color: colors.textPrimary, textAlign: 'right' },
      'aria-label': 'Corrected time',
    });
  } else if (Platform.OS === 'ios') {
    control = (
      <DateTimePicker value={at} mode="time" display="compact" accentColor={colors.primary} onChange={(_e, d) => d && setTime(hhmm(d))} />
    );
  } else {
    control = (
      <Pressable onPress={() => setAndroidPicker(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Pick the corrected time">
        <Text style={[typeScale.bodyLarge, { color: colors.primary }]}>
          {at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </Text>
      </Pressable>
    );
  }

  return (
    <FormSheet visible={visible} title={title} saveLabel={saving ? 'Saving…' : 'Save'} onSave={save} onClose={onClose}>
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.md, marginHorizontal: spacing.xs }]}>
        {description}
      </Text>
      <SheetLabel>CORRECTED TIME</SheetLabel>
      <ListSection>
        <View style={styles.row}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>
            {new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </Text>
          {control}
        </View>
      </ListSection>
      <ListSection title="REASON">
        <NoteField label="Reason for the correction" placeholder="e.g. Crew forgot to tap I'm Here" value={note} onChangeText={setNote} />
      </ListSection>
      <Text style={[typeScale.caption, { color: colors.textTertiary, marginHorizontal: spacing.xs, marginBottom: spacing.md }]}>
        The crew’s original record isn’t changed. Your correction is shown next to it, with your name.
      </Text>
      {Platform.OS === 'android' && androidPicker && (
        <DateTimePicker
          value={at}
          mode="time"
          display="default"
          onChange={(_e: DateTimePickerEvent, d?: Date) => { setAndroidPicker(false); if (d) setTime(hhmm(d)); }}
        />
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: sizing.touchTarget, paddingHorizontal: spacing.md },
});
