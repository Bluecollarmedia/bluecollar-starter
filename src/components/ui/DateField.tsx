/**
 * DateField: THE way to ask for a date. It looks like a normal form field, and tapping it opens the phone's own date picker.
 * Nobody types a date.
 *   iPhone:   the native wheel picker (month, day and year wheels) in a sheet, with Cancel and Done.
 *   Android:  the system date dialog.
 *   Web:      the browser's date input.
 * Values are plain "YYYY-MM-DD" keys (the same keys the rest of the app stores). Use this instead of an Input whenever a field
 * is a date, so a typed date can't slip back in.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ViewStyle } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { Icon } from './Icon';
import { BottomSheetModal } from './BottomSheetModal';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing, sizing } from '@/theme/spacing';
import { localDateKey } from '@/lib/ids';

/** "2026-10-19" -> a Date at local noon (noon keeps it on the right day in every timezone). */
export function keyToDate(key?: string | null): Date {
  const m = (key ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date();
}

/** How a date key is shown: in the phone's own regional style, like "Oct 19, 2026". */
export function displayDateKey(key?: string | null): string {
  return /^\d{4}-\d{2}-\d{2}/.test(key ?? '') ? keyToDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

interface PickerOptions {
  /** The date the picker shows first. Defaults to the current value, else today. */
  value?: string;
  minimumDate?: string;
  maximumDate?: string;
  /** Where the picker starts when there is no value yet (a birthday starts in 1990, not today). */
  initialPickerDate?: string;
}

/** Android's system date dialog (a no-op elsewhere). */
export function openAndroidDatePicker(opts: PickerOptions & { onPick: (key: string) => void }) {
  if (Platform.OS !== 'android') return;
  DateTimePickerAndroid.open({
    value: keyToDate(opts.value || opts.initialPickerDate),
    mode: 'date',
    minimumDate: opts.minimumDate ? keyToDate(opts.minimumDate) : undefined,
    maximumDate: opts.maximumDate ? keyToDate(opts.maximumDate) : undefined,
    onChange: (e: DateTimePickerEvent, d?: Date) => { if (e.type === 'set' && d) opts.onPick(localDateKey(d)); },
  });
}

/** The iPhone wheel picker in a bottom sheet. Nothing changes until Done. */
export function IosDateSheet({ visible, onClose, onPick, title, value, minimumDate, maximumDate, initialPickerDate }: PickerOptions & {
  visible: boolean; onClose: () => void; onPick: (key: string) => void; title?: string;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<Date>(() => keyToDate(value || initialPickerDate));
  const [wasVisible, setWasVisible] = useState(false);
  if (visible && !wasVisible) { setWasVisible(true); setDraft(keyToDate(value || initialPickerDate)); }
  if (!visible && wasVisible) setWasVisible(false);

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface }]} onPress={() => {}}>
          <View style={styles.sheetHead}>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button"><Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>Cancel</Text></Pressable>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{title ?? 'Choose a date'}</Text>
            <Pressable onPress={() => { onPick(localDateKey(draft)); onClose(); }} hitSlop={10} accessibilityRole="button">
              <Text style={[typeScale.bodyLarge, { color: colors.primary, fontWeight: '700' }]}>Done</Text>
            </Pressable>
          </View>
          <DateTimePicker
            value={draft}
            mode="date"
            display="spinner"
            minimumDate={minimumDate ? keyToDate(minimumDate) : undefined}
            maximumDate={maximumDate ? keyToDate(maximumDate) : undefined}
            accentColor={colors.primary}
            onChange={(_e: DateTimePickerEvent, d?: Date) => d && setDraft(d)}
            style={{ alignSelf: 'center', width: '100%' }}
          />
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

interface Props extends PickerOptions {
  label?: string;
  onChange: (key: string) => void;
  /** Shows a Clear control when there is a value (for optional dates). */
  onClear?: () => void;
  placeholder?: string;
  icon?: keyof typeof Feather.glyphMap;
  error?: string;
  hint?: string;
  containerStyle?: ViewStyle;
}

export function DateField({ label, value, onChange, onClear, minimumDate, maximumDate, initialPickerDate, placeholder = 'Select date', icon = 'calendar', error, hint, containerStyle }: Props) {
  const { colors } = useTheme();
  const [sheet, setSheet] = useState(false);
  const text = displayDateKey(value);
  const borderColor = error ? '#C62828' : colors.border;

  function open() {
    if (Platform.OS === 'android') openAndroidDatePicker({ value, minimumDate, maximumDate, initialPickerDate, onPick: onChange });
    else setSheet(true);
  }

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}
      {Platform.OS === 'web' ? (
        <View style={[styles.box, { borderColor, backgroundColor: colors.backgroundSecondary }]}>
          <Icon name={icon} size={18} color={colors.textTertiary} />
          {React.createElement('input', {
            type: 'date',
            value: value ?? '',
            min: minimumDate,
            max: maximumDate,
            onChange: (e: { target: { value: string } }) => (e.target.value ? onChange(e.target.value) : onClear?.()),
            style: { flex: 1, font: 'inherit', fontSize: 16, border: 0, background: 'transparent', color: colors.textPrimary },
            'aria-label': label ?? 'Date',
          })}
        </View>
      ) : (
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`${label ?? 'Date'}. ${text || 'Not set'}. Opens the date picker`}
          style={({ pressed }) => [styles.box, { borderColor, backgroundColor: pressed ? colors.surface : colors.backgroundSecondary }]}
        >
          <Icon name={icon} size={18} color={colors.textTertiary} />
          <Text style={[typeScale.bodyLarge, { flex: 1, color: text ? colors.textPrimary : colors.textTertiary }]} numberOfLines={1}>{text || placeholder}</Text>
          {onClear && text ? (
            <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Clear ${label ?? 'date'}`}>
              <Icon name="x-circle" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : (
            <Icon name="chevron-down" size={18} color={colors.textTertiary} />
          )}
        </Pressable>
      )}
      {error ? <Text style={[styles.note, { color: '#C62828' }]}>{error}</Text> : hint ? <Text style={[styles.note, { color: colors.textTertiary }]}>{hint}</Text> : null}
      {Platform.OS === 'ios' && (
        <IosDateSheet
          visible={sheet}
          onClose={() => setSheet(false)}
          onPick={onChange}
          title={label}
          value={value}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          initialPickerDate={initialPickerDate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%' },
  label: { ...typeScale.labelLarge, marginBottom: spacing.xs },
  box: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: sizing.inputHeight ?? 52, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  note: { ...typeScale.caption, marginTop: spacing.xs },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: spacing['3xl'], paddingTop: spacing.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
});
