/**
 * Pick the date and time for a materials prep reminder. Quick choices are
 * relative to the job's next scheduled day; any date and time can be set.
 */

import { useKeepDraft } from '@/hooks/useKeepDraft';
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button, ListSection } from '@/components/ui';
import { NoteField } from '@/components/financials/FormBits';
import { showMessage } from '@/components/financials/ActionSheet';
import { FormSheet, ChipRow, SheetLabel } from './FormSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { formatDocDate } from '@/lib/documentHtml';
import { materialRemindersSupported } from '@/lib/materialReminders';
import { typeScale } from '@/theme/typography';
import { spacing, sizing } from '@/theme/spacing';

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function formatReminder(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function ReminderSheet({ visible, initial, initialNote, jobDate, hasReminder, onSave, onClear, onClose }: {
  visible: boolean;
  initial: Date;
  initialNote?: string;
  jobDate?: string;
  hasReminder: boolean;
  onSave: (at: Date, note?: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [at, setAt] = useState(initial);
  const [note, setNote] = useState('');
  const [androidPicker, setAndroidPicker] = useState<'date' | 'time' | null>(null);

  // Swipe the sheet down and open it again: what you typed is still there (until it is saved or you leave the page).
  const markSaved = useKeepDraft(visible, 'reminder', () => { setAt(initial); setNote(initialNote ?? ''); });

  const daysBefore = (n: number) => {
    if (!jobDate) return;
    const [y, m, d] = jobDate.split('-').map(Number);
    setAt(new Date(y, m - 1, d - n, 8, 0, 0, 0));
  };
  const preset = jobDate ? (['1', '2', '3'] as const).find((n) => {
    const [y, m, d] = jobDate.split('-').map(Number);
    return new Date(y, m - 1, d - Number(n), 8).getTime() === at.getTime();
  }) : undefined;

  const save = () => {
    if (at.getTime() <= Date.now()) {
      showMessage('Pick a later time', 'The reminder time has already passed.');
      return;
    }
    markSaved();
    onSave(at, note);
  };

  const onPick = (_e: DateTimePickerEvent, d?: Date) => {
    setAndroidPicker(null);
    if (d) setAt(d);
  };

  let control: React.ReactNode;
  if (Platform.OS === 'web') {
    control = React.createElement('input', {
      type: 'datetime-local',
      value: toLocalInput(at),
      onChange: (e: { target: { value: string } }) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setAt(d); },
      style: { font: 'inherit', fontSize: 16, border: 0, background: 'transparent', color: colors.textPrimary, textAlign: 'right' },
      'aria-label': 'Reminder date and time',
    });
  } else if (Platform.OS === 'ios') {
    control = (
      <View style={{ flexDirection: 'row' }}>
        <DateTimePicker value={at} mode="date" display="compact" minimumDate={new Date()} accentColor={colors.primary} onChange={(_e, d) => d && setAt(d)} />
        <DateTimePicker value={at} mode="time" display="compact" accentColor={colors.primary} onChange={(_e, d) => d && setAt(d)} />
      </View>
    );
  } else {
    control = (
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Pressable onPress={() => setAndroidPicker('date')} hitSlop={8}><Text style={[typeScale.bodyLarge, { color: colors.primary }]}>{at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text></Pressable>
        <Pressable onPress={() => setAndroidPicker('time')} hitSlop={8}><Text style={[typeScale.bodyLarge, { color: colors.primary }]}>{at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Text></Pressable>
      </View>
    );
  }

  return (
    <FormSheet visible={visible} title="Prep Reminder" onSave={save} onClose={onClose}>
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.md, marginHorizontal: spacing.xs }]}>
        {jobDate ? `The job is scheduled for ${formatDocDate(jobDate)}.` : 'This job isn’t on the schedule yet. You can still set a reminder.'}
      </Text>
      {jobDate && (
        <ChipRow
          options={[{ key: '1', label: 'Day before, 8 AM' }, { key: '2', label: '2 days before' }, { key: '3', label: '3 days before' }]}
          value={preset}
          onChange={(k) => k && daysBefore(Number(k))}
        />
      )}
      <SheetLabel>REMIND ME</SheetLabel>
      <ListSection>
        <View style={styles.row}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>Date & time</Text>
          {control}
        </View>
      </ListSection>
      <ListSection title="NOTE (OPTIONAL)">
        <NoteField label="Reminder note" placeholder="e.g. Order sod for Thursday" value={note} onChangeText={setNote} />
      </ListSection>
      <Text style={[typeScale.caption, { color: colors.textTertiary, marginHorizontal: spacing.xs, marginBottom: spacing.md }]}>
        {materialRemindersSupported
          ? 'You’ll get a notification on your phone at this time (your other phones pick it up next time the app opens). It also shows in Materials.'
          : 'On the website the reminder shows in Materials. Phone notifications come from the Brighton iPhone app.'}
      </Text>
      {hasReminder && <Button title="Remove Reminder" variant="ghost" onPress={() => { markSaved(); onClear(); }} fullWidth />}
      {Platform.OS === 'android' && androidPicker && (
        <DateTimePicker value={at} mode={androidPicker} display="default" minimumDate={androidPicker === 'date' ? new Date() : undefined} onChange={onPick} />
      )}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: sizing.touchTarget, paddingHorizontal: spacing.md },
});
