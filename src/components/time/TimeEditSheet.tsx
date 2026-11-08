import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ListSection } from '@/components/ui';
import { DateRow, NoteField } from '@/components/financials/FormBits';
import { showMessage } from '@/components/financials/ActionSheet';
import { FormSheet, SheetLabel } from '@/components/materials/FormSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { localDateKey, localDateTime } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, sizing } from '@/theme/spacing';
import type { Result } from '@/data/timeTracking';
import { useT } from '@/i18n';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export interface TimeField {
  key: string;
  label: string;
  /** The time as it is now (ISO). Empty for a new entry or a missing time. */
  value?: string | null;
  /** May be left empty (for example a clock-out that is still missing). */
  optional?: boolean;
  /** Where the date picker starts when there is no value yet (YYYY-MM-DD). */
  defaultDate?: string;
}

/** Date + time of day, with the phone's own pickers (nobody types a time). */
function TimeOfDay({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const t = useT();
  const { colors } = useTheme();
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'time', value: hhmm(value),
      onChange: (e: { target: { value: string } }) => { if (e.target.value) onChange(localDateTime(localDateKey(value), e.target.value)); },
      style: { font: 'inherit', fontSize: 16, border: 0, background: 'transparent', color: colors.textPrimary, textAlign: 'right' }, 'aria-label': t('Time'),
    });
  }
  if (Platform.OS === 'ios') {
    return <DateTimePicker value={value} mode="time" display="compact" accentColor={colors.primary} onChange={(_e, d) => d && onChange(d)} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => DateTimePickerAndroid.open({ value, mode: 'time', onChange: (e: DateTimePickerEvent, d?: Date) => { if (e.type === 'set' && d) onChange(d); } })}
      hitSlop={8}
    >
      <Text style={[typeScale.bodyLarge, { color: colors.primary }]}>{value.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Text>
    </Pressable>
  );
}

/**
 * One sheet for every owner correction: pick the real time(s), say why. Nothing is saved without a reason (when one is required), and
 * the original is kept in the history by the database.
 */
export function TimeEditSheet({ visible, title, description, fields, reasonRequired = true, saveLabel = 'Save', onSave, onClose }: {
  visible: boolean;
  title: string;
  description?: string;
  fields: TimeField[];
  reasonRequired?: boolean;
  saveLabel?: string;
  onSave: (values: Record<string, Date | null>, reason: string) => Promise<Result>;
  onClose: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [vals, setVals] = useState<Record<string, Date | null>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const next: Record<string, Date | null> = {};
    for (const f of fields) next[f.key] = f.value ? new Date(f.value) : f.optional ? null : localDateTime(f.defaultDate ?? localDateKey(new Date()), '08:00');
    setVals(next);
    setReason('');
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const save = async () => {
    if (saving) return;
    if (reasonRequired && reason.trim().length < 3) { showMessage(t('Add a reason'), t('Say why this is being changed, for example "Forgot to clock out".')); return; }
    setSaving(true);
    const res = await onSave(vals, reason.trim());
    setSaving(false);
    if (!res.ok) showMessage(t("Couldn't save"), res.error);
    else onClose();
  };

  return (
    <FormSheet visible={visible} title={t(title)} saveLabel={saving ? t('Saving…') : t(saveLabel)} onSave={save} onClose={onClose}>
      {description ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.md, marginHorizontal: spacing.xs }]}>{t(description)}</Text> : null}
      {fields.map((f) => {
        const v = vals[f.key];
        return (
          <View key={f.key}>
            <SheetLabel>{t(f.label).toUpperCase()}</SheetLabel>
            <ListSection>
              {v ? (
                <>
                  <DateRow label={t('Date')} value={localDateKey(v)} onChange={(k) => setVals((p) => ({ ...p, [f.key]: localDateTime(k, hhmm(v)) }))} />
                  <View style={styles.row}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{t('Time')}</Text>
                    <TimeOfDay value={v} onChange={(d) => setVals((p) => ({ ...p, [f.key]: d }))} />
                  </View>
                  {f.optional ? (
                    <Pressable onPress={() => setVals((p) => ({ ...p, [f.key]: null }))} style={styles.row} accessibilityRole="button">
                      <Text style={[typeScale.bodyMedium, { color: colors.error }]}>{t('Clear this time')}</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Pressable onPress={() => setVals((p) => ({ ...p, [f.key]: localDateTime(f.defaultDate ?? localDateKey(new Date()), '16:00') }))} style={styles.row} accessibilityRole="button">
                  <Text style={[typeScale.bodyLarge, { color: colors.primary }]}>{t('Set a time')}</Text>
                </Pressable>
              )}
            </ListSection>
          </View>
        );
      })}
      <ListSection title={t('REASON')}>
        <NoteField label={t('Reason for the change')} placeholder={t('e.g. Forgot to clock out')} value={reason} onChangeText={setReason} />
      </ListSection>
      <Text style={[typeScale.caption, { color: colors.textTertiary, marginHorizontal: spacing.xs, marginBottom: spacing.md }]}>
        {t('What was recorded before stays in the history next to this change, with your name and the time you made it.')}
      </Text>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: sizing.touchTarget, paddingHorizontal: spacing.md },
});
