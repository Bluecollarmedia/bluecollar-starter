/**
 * Compact grouped-form pieces for the quote / invoice editor: label-left rows
 * inside a ListSection, so a whole form fits on an iPhone without a label
 * repeated above every box.
 */

import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, TextInputProps } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, sizing } from '@/theme/spacing';
import { localDateKey } from '@/lib/ids';
import { IosDateSheet, openAndroidDatePicker } from '@/components/ui/DateField';
import { formatDocDate } from '@/lib/documentHtml';

function keyToDate(key?: string): Date {
  if (!key) return new Date();
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

/** "Label ........ value" row with a native date picker. */
export function DateRow({ label, value, onChange, minimumDate, optional, onClear }: {
  label: string;
  value?: string;
  onChange: (key: string) => void;
  minimumDate?: string;
  optional?: boolean;
  onClear?: () => void;
}) {
  const { colors } = useTheme();
  const [showSheet, setShowSheet] = useState(false);

  let control: React.ReactNode;
  if (Platform.OS === 'web') {
    control = React.createElement('input', {
      type: 'date',
      value: value ?? '',
      min: minimumDate,
      onChange: (e: { target: { value: string } }) => (e.target.value ? onChange(e.target.value) : onClear?.()),
      style: { font: 'inherit', fontSize: 16, border: 0, background: 'transparent', color: colors.textPrimary, textAlign: 'right' },
      'aria-label': label,
    });
  } else if (Platform.OS === 'ios' && (value || !optional)) {
    control = (
      <DateTimePicker
        value={keyToDate(value)}
        mode="date"
        display="compact"
        minimumDate={minimumDate ? keyToDate(minimumDate) : undefined}
        accentColor={colors.primary}
        onChange={(_e: DateTimePickerEvent, d?: Date) => d && onChange(localDateKey(d))}
      />
    );
  } else {
    control = (
      <Pressable
        onPress={() => (Platform.OS === 'ios' ? setShowSheet(true) : openAndroidDatePicker({ value, minimumDate, onPick: onChange }))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${value ? formatDocDate(value) : 'Not set'}. Opens the date picker`}
      >
        <Text style={[typeScale.bodyLarge, { color: value ? colors.textPrimary : colors.primary }]}>
          {value ? formatDocDate(value) : 'Add'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.row}>
      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{label}</Text>
      {control}
      {optional && value && onClear && Platform.OS !== 'web' && (
        <Pressable onPress={onClear} hitSlop={8} accessibilityLabel={`Remove ${label}`}>
          <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginLeft: spacing.sm }]}>Clear</Text>
        </Pressable>
      )}
      {Platform.OS === 'ios' && (
        <IosDateSheet visible={showSheet} onClose={() => setShowSheet(false)} onPick={onChange} title={label} value={value} minimumDate={minimumDate} />
      )}
    </View>
  );
}

/** "Label ........ [input]" row. */
export function InputRow({ label, suffix, error, ...props }: TextInputProps & { label: string; suffix?: string; error?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typeScale.bodyLarge, { color: error ? colors.error : colors.textPrimary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textTertiary}
        style={[typeScale.bodyLarge, styles.input, { color: colors.textPrimary }]}
        accessibilityLabel={label}
        {...props}
      />
      {!!suffix && <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{suffix}</Text>}
    </View>
  );
}

/** Read-only "Label ........ value" row. */
export function ValueRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end', minWidth: 0 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, textAlign: 'right' }]} numberOfLines={1}>{value}</Text>
        {!!sub && <Text style={[typeScale.caption, { color: colors.textSecondary, textAlign: 'right' }]} numberOfLines={1}>{sub}</Text>}
      </View>
    </View>
  );
}

/** Multi-line text area that fills a ListSection. */
export function NoteField({ placeholder, value, onChangeText, label }: { placeholder: string; value: string; onChangeText: (t: string) => void; label: string }) {
  const { colors } = useTheme();
  return (
    <TextInput
      multiline
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      accessibilityLabel={label}
      textAlignVertical="top"
      style={[typeScale.bodyLarge, styles.note, { color: colors.textPrimary }]}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: sizing.touchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  input: { flex: 1, textAlign: 'right', paddingVertical: Platform.OS === 'web' ? 4 : 0, minWidth: 60 },
  note: { minHeight: 88, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
});
