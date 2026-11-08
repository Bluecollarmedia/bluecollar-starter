/**
 * Add one service to a maintenance property. Opened from the property's Services list, so it asks only about the service:
 * what it is, how often, and (tucked away) the extras. It never shows the property's address, customer or contract.
 *
 *   /(owner)/maintenance-service-add?propertyId=…
 */
import { PhotoRuleEditor } from '@/components/maintenance/PhotoRuleEditor';
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { ListSection, Switch } from '@/components/ui';
import { DateRow, InputRow, NoteField } from '@/components/financials/FormBits';
import { useTheme } from '@/providers/ThemeProvider';
import { useMaintenanceProperty } from '@/hooks/useMaintenance';
import { createContract, addServiceRule, ruleProblem } from '@/data/maintenance';
import { FREQUENCIES, newDraft, draftToInput, spreadForDraft, toInt, type ServiceDraft } from '@/lib/maintenanceServiceDraft';
import { todayKey } from '@/lib/ids';
import { haptics } from '@/lib/haptics';
import { SERVICE_TYPES } from '@/types/maintenance';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

function notify(title: string, msg: string) {
  if (Platform.OS === 'web') alert(msg);
  else Alert.alert(title, msg);
}

export default function MaintenanceServiceAddScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { propertyId } = useLocalSearchParams<{ propertyId?: string }>();
  const detail = useMaintenanceProperty(propertyId);
  const contract = detail ? detail.activeContract ?? detail.contracts[0] : undefined;

  const [draft, setDraft] = useState<ServiceDraft>(() => newDraft('lawn_cut', undefined, undefined));
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<ServiceDraft>) => setDraft((d) => ({ ...d, ...p }));

  const seasonStart = contract?.seasonStart;
  const seasonEnd = contract?.seasonEnd;

  function chooseType(type: string) {
    haptics.select();
    // A fresh draft for the chosen type (its suggested schedule and name), keeping nothing from the last pick.
    setDraft(newDraft(type, seasonStart, seasonEnd));
  }

  function setFrequency(key: ServiceDraft['frequency']) {
    haptics.select();
    if (key === 'fixed_dates') {
      const next = { ...draft, frequency: key, seasonQuantity: draft.seasonQuantity || '1' };
      patch({ frequency: key, seasonQuantity: next.seasonQuantity, scheduledDates: spreadForDraft(next, seasonStart, seasonEnd) });
    } else {
      patch({ frequency: key });
    }
  }

  function setVisits(text: string) {
    const next = { ...draft, seasonQuantity: text };
    const dates = spreadForDraft(next, seasonStart, seasonEnd);
    patch({ seasonQuantity: text, ...(dates.length ? { scheduledDates: dates } : {}) });
  }

  function setDates(dates: string[]) {
    patch({ scheduledDates: dates, seasonQuantity: String(dates.length) });
  }

  function save() {
    if (saving || !detail) return;
    const input = draftToInput(draft, (contract ? detail.rules?.length : 0) ?? 0);
    const problem = ruleProblem(input);
    if (problem) return notify(draft.label.trim() || 'Service', problem);
    setSaving(true);
    // A property made before it had a contract gets one now, so a service always belongs to a contract.
    const contractId = contract?.id ?? createContract(detail.property.id, { name: `${todayKey().slice(0, 4)} season` }).id;
    const res = addServiceRule(contractId, input);
    setSaving(false);
    if (!res.ok) return notify("Couldn't add the service", res.error);
    haptics.success();
    router.back();
  }

  if (!detail) return null;
  const fixed = draft.frequency === 'fixed_dates';

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <KeyboardAwareScrollView bounces={false}
        bottomOffset={KEYBOARD_GAP}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} style={[styles.closeButton, { backgroundColor: colors.surface }, shadow.sm]} accessibilityRole="button" accessibilityLabel="Close">
          <Icon name="x" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.displayLarge, { color: colors.textPrimary, marginTop: spacing.md }]}>Add Service</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textTertiary, marginTop: 2, marginBottom: spacing.lg }]}>{detail.property.name}</Text>

        <ListSection title="WHAT KIND OF SERVICE?">
          <View style={styles.pad}>
            <View style={styles.chipWrap}>
              {SERVICE_TYPES.map((t) => {
                const on = draft.serviceType === t.key;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => chooseType(t.key)}
                    style={[styles.chip, { backgroundColor: on ? colors.primary : colors.backgroundTertiary }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[typeScale.labelSmall, { color: on ? colors.textOnPrimary : colors.textPrimary }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <InputRow label="Name" value={draft.label} onChangeText={(t) => patch({ label: t })} placeholder="Lawn cut" autoCapitalize="sentences" />
        </ListSection>

        <ListSection title="HOW OFTEN?">
          <View style={styles.pad}>
            <View style={styles.chipWrap}>
              {FREQUENCIES.map((f) => {
                const on = draft.frequency === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setFrequency(f.key)}
                    style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border, borderWidth: StyleSheet.hairlineWidth }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[typeScale.labelSmall, { color: on ? colors.textOnPrimary : colors.textPrimary }]}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {draft.frequency === 'every_n_days' && (
            <InputRow label="Days between visits" value={draft.intervalDays} onChangeText={(t) => patch({ intervalDays: t })} keyboardType="number-pad" placeholder="10" suffix="days" />
          )}
          {fixed && (
            <>
              <InputRow label="Number of visits" value={draft.seasonQuantity} onChangeText={setVisits} keyboardType="number-pad" placeholder="6" suffix="visits" />
              <Text style={[typeScale.caption, { color: colors.textTertiary, paddingHorizontal: spacing.md, paddingBottom: spacing.xs }]}>
                The visits are spread evenly across the season. You can change any date, or add your own.
              </Text>
              {draft.scheduledDates.map((date, i) => (
                <View key={`${i}-${date}`} style={styles.dateLine}>
                  <View style={{ flex: 1 }}>
                    <DateRow label={`Visit ${i + 1}`} value={date} onChange={(k) => setDates(draft.scheduledDates.map((x, j) => (j === i ? k : x)))} />
                  </View>
                  <Pressable onPress={() => setDates(draft.scheduledDates.filter((_, j) => j !== i))} hitSlop={10} style={{ paddingHorizontal: spacing.md }} accessibilityRole="button" accessibilityLabel={`Remove visit ${i + 1}`}>
                    <Icon name="x" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={() => setDates([...draft.scheduledDates, draft.scheduledDates.slice(-1)[0] ?? seasonEnd ?? seasonStart ?? todayKey()])}
                style={styles.addDate}
                accessibilityRole="button"
              >
                <Icon name="plus" size={16} color={colors.primary} />
                <Text style={[typeScale.bodyLarge, { color: colors.primary }]}>Add a date</Text>
              </Pressable>
            </>
          )}
        </ListSection>

        <Pressable onPress={() => setMore((v) => !v)} style={styles.moreRow} accessibilityRole="button" accessibilityState={{ expanded: more }}>
          <Text style={[typeScale.bodyLarge, { color: colors.primary, flex: 1 }]}>{more ? 'Fewer options' : 'More options'}</Text>
          <Icon name={more ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
        </Pressable>
        {more && (
          <ListSection title="OPTIONAL">
            <PhotoRuleEditor
              label="Completion photos required"
              on={draft.requiresPhotos}
              count={draft.minPhotos}
              onChange={(on, count) => patch({ requiresPhotos: on, minPhotos: count })}
              hint="When on, the crew takes one photo for each task before ticking it, and at least this many photos in all."
            />
            <NoteField label="Checklist" placeholder={'Checklist for every visit, one per line\nBlow off driveway and walks'} value={draft.checklist} onChangeText={(t) => patch({ checklist: t })} />
            <NoteField label="Instructions" placeholder="Standing instructions for this service" value={draft.instructions} onChangeText={(t) => patch({ instructions: t })} />
            {!fixed && <DateRow label="Last done" value={draft.lastCompletedOn} onChange={(k) => patch({ lastCompletedOn: k })} optional onClear={() => patch({ lastCompletedOn: undefined })} />}
          </ListSection>
        )}

        <Pressable
          onPress={save}
          disabled={saving}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: pressed ? colors.primaryDark : colors.primary, opacity: saving ? 0.6 : 1 }]}
          accessibilityRole="button"
        >
          <Icon name="check" size={18} color={colors.textOnPrimary} />
          <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, fontSize: 17 }]}>Add Service</Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pad: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.full },
  dateLine: { flexDirection: 'row', alignItems: 'center' },
  addDate: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, minHeight: 48 },
  moreRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 52 },
  primaryButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 56, borderRadius: radius.full, marginTop: spacing.md },
});
