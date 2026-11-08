/**
 * Owner sheet to fix a Snow shift's clock-in and clock-out times (update 028,
 * snow_correct_shift). A reason is required. The worker's original times are
 * never changed: the correction is stored next to them with the owner's name,
 * and the shift list shows the corrected times and the reason.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ListSection, Switch } from '@/components/ui';
import { NoteField } from '@/components/financials/FormBits';
import { showMessage } from '@/components/financials/ActionSheet';
import { FormSheet, SheetLabel } from '@/components/materials/FormSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { correctShift, type SnowShift } from '@/data/snowShifts';
import { typeScale } from '@/theme/typography';
import { spacing, sizing } from '@/theme/spacing';

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const label = (d: Date) =>
  d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ShiftCorrectionSheet({ shift, who, onClose, onSaved }: {
  /** The shift to correct; the sheet is shown while this is set. */
  shift: SnowShift | null;
  who?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors } = useTheme();
  const [clockIn, setClockIn] = useState(new Date());
  const [clockOut, setClockOut] = useState(new Date());
  const [hasOut, setHasOut] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!shift) return;
    setClockIn(new Date(shift.clockInAt));
    setClockOut(shift.clockOutAt ? new Date(shift.clockOutAt) : new Date());
    setHasOut(!!shift.clockOutAt);
    setNote('');
    setSaving(false);
  }, [shift]);

  async function save() {
    if (!shift || saving) return;
    if (!note.trim()) return showMessage('Add a reason', 'Say why the time is being corrected, e.g. "Forgot to clock out".');
    if (hasOut && clockOut < clockIn) return showMessage('Check the times', 'Clock out can\'t be before clock in.');
    setSaving(true);
    const res = await correctShift(shift.id, clockIn.toISOString(), hasOut ? clockOut.toISOString() : null, note.trim());
    setSaving(false);
    if (!res.ok) return showMessage('Couldn\'t save the correction', res.error);
    onSaved();
    onClose();
  }

  return (
    <FormSheet visible={!!shift} title={who ? `Correct ${who}'s shift` : 'Correct shift'} saveLabel={saving ? 'Saving…' : 'Save'} onSave={save} onClose={onClose}>
      <SheetLabel>TIMES</SheetLabel>
      <ListSection>
        <TimeRow title="Clock in" value={clockIn} onChange={setClockIn} />
        {shift && !shift.originalOut ? (
          <View style={styles.row}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>Clock out</Text>
            <Switch value={hasOut} onValueChange={setHasOut} accessibilityLabel="Set a clock-out time" />
          </View>
        ) : null}
        {hasOut ? <TimeRow title="Clock out" value={clockOut} onChange={setClockOut} /> : null}
      </ListSection>
      <ListSection title="REASON">
        <NoteField label="Reason for the correction" placeholder="e.g. Forgot to clock out" value={note} onChangeText={setNote} />
      </ListSection>
      <Text style={[typeScale.caption, { color: colors.textTertiary, marginHorizontal: spacing.xs, marginBottom: spacing.md }]}>
        The original clock times stay on record. Your correction is added next to them with your name and this reason.
      </Text>
    </FormSheet>
  );
}

/** One date + time, with the right picker for each platform. */
function TimeRow({ title, value, onChange }: { title: string; value: Date; onChange: (d: Date) => void }) {
  const { colors } = useTheme();
  const [step, setStep] = useState<'date' | 'time' | null>(null);

  let control: React.ReactNode;
  if (Platform.OS === 'web') {
    control = React.createElement('input', {
      type: 'datetime-local',
      value: toLocalInput(value),
      onChange: (e: { target: { value: string } }) => {
        const d = new Date(e.target.value);
        if (!Number.isNaN(d.getTime())) onChange(d);
      },
      style: { font: 'inherit', fontSize: 16, border: 0, background: 'transparent', color: colors.textPrimary },
      'aria-label': title,
    });
  } else if (Platform.OS === 'ios') {
    control = (
      <DateTimePicker value={value} mode="datetime" display="compact" accentColor={colors.primary} onChange={(_e, d) => d && onChange(d)} />
    );
  } else {
    control = (
      <>
        <Pressable onPress={() => setStep('date')} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Pick the ${title.toLowerCase()} time`}>
          <Text style={[typeScale.bodyLarge, { color: colors.primary }]}>{label(value)}</Text>
        </Pressable>
        {step ? (
          <DateTimePicker
            value={value}
            mode={step}
            display="default"
            onChange={(_e: DateTimePickerEvent, d?: Date) => {
              if (!d) return setStep(null);
              if (step === 'date') {
                const next = new Date(value);
                next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                onChange(next);
                setStep('time');
              } else {
                const next = new Date(value);
                next.setHours(d.getHours(), d.getMinutes(), 0, 0);
                onChange(next);
                setStep(null);
              }
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <View style={styles.row}>
      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{title}</Text>
      {control}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: sizing.touchTarget, paddingHorizontal: spacing.md },
});
