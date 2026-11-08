/**
 * Create Storm (Owner). Pick the service or services, name the storm, save it as a
 * draft. Nothing is dispatched or sent; the owner plans routes next and
 * dispatches from the storm screen.
 *
 * Working layout in the existing app style; no approved mockup yet.
 */
import { toggleService } from '@/lib/snowServices';
import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, InlineNotice, Input, ScreenHeader } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { createStorm, defaultStormName, SERVICE_LABEL } from '@/data/snowStorms';
import { uuid } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { SNOW_SERVICES, type SnowService } from '@/types/snow';
import { SERVICE_ICON } from '@/types/snow';

const SERVICE_HINT: Record<SnowService, string> = {
  plowing: 'Lots and driveways',
  shoveling: 'Walks, entrances and steps',
  salting: 'Ice treatment',
};

export function StormNewScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [services, setServices] = useState<SnowService[]>([]);
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id for this form, so a double tap or a retry makes one storm.
  const requestId = useRef(uuid()).current;

  function pick(s: SnowService) {
    const next = toggleService(services, s);
    setServices(next);
    if (!nameEdited && next.length) setName(defaultStormName(next));
  }

  async function save() {
    if (services.length === 0) return setError('Choose at least one service.');
    if (!name.trim()) return setError('Give the storm a name.');
    setSaving(true);
    setError(null);
    const res = await createStorm({ name, services, notes, requestId });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    router.replace({ pathname: '/snow/owner/storm/[id]', params: { id: res.data.storm.id } });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.groupedBackground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Storm plan" subtitle="Saved as a draft. You dispatch it when the plan is ready." />
      <ScrollView bounces={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['2xl'] }} keyboardShouldPersistTaps="handled">
        <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>Services</Text>
        <View style={[styles.group, { backgroundColor: colors.surface }]}>
          {SNOW_SERVICES.map((s, i) => {
            const selected = services.includes(s);
            return (
              <Pressable
                key={s}
                onPress={() => pick(s)}
                style={({ pressed }) => [
                  styles.option,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
                  pressed && { opacity: 0.6 },
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ selected }}
                accessibilityLabel={SERVICE_LABEL[s]}
              >
                <View style={[styles.optionIcon, { backgroundColor: colors.primarySurface }]}>
                  <Icon name={SERVICE_ICON[s]} size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{SERVICE_LABEL[s]}</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{SERVICE_HINT[s]}</Text>
                </View>
                <Icon name={selected ? 'check-square' : 'square'} size={22} color={selected ? colors.primary : colors.textTertiary} />
              </Pressable>
            );
          })}
        </View>
        <Text style={[typeScale.caption, styles.help, { color: colors.textTertiary }]}>
          Pick every service this storm covers. The storm's route does them together (plowing + salting on one truck); you can add more routes, or one from a saved template, on the storm screen.
        </Text>

        <Input
          label="Route name"
          value={name}
          onChangeText={(t) => { setName(t); setNameEdited(true); }}
          placeholder="e.g. Jan 12 Plowing"
          returnKeyType="next"
          containerStyle={{ marginTop: spacing.xl }}
        />
        <Input
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything the plan should remember"
          multiline
          containerStyle={{ marginTop: spacing.lg }}
        />

        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginTop: spacing.lg }} /> : null}
        <Button title="Create Route" onPress={save} loading={saving} disabled={services.length === 0} fullWidth style={{ marginTop: spacing.xl }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: { marginLeft: spacing.sm, marginBottom: spacing.sm, marginTop: spacing.md },
  help: { marginTop: spacing.sm, marginHorizontal: spacing.sm },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 60 },
  optionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
