import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Input, Avatar, CrewLabel } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useCrews } from '@/hooks/useCrews';
import { db, useDb } from '@/data/store';
import { CREW_COLORS } from '@/types/crew';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic, fixed } from '@/theme/colors';
import { haptics } from '@/lib/haptics';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';

function notify(title: string, msg: string) {
  showMessage(title, msg);
}

/** New or edit crew: name, label color and who's in it. */
export default function CrewEditScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const { crews, crewsOf, isNameFree, createCrew, updateCrew, setCrewMembers, deleteCrew } = useCrews();
  const existing = crews.find(c => c.id === params.id);

  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? CREW_COLORS[crews.length % CREW_COLORS.length]);
  const [memberIds, setMemberIds] = useState<string[]>(existing?.memberIds ?? []);

  const v = useDb();
  const workers = useMemo(() =>
    db.members.filter(m => m.role === 'worker' && m.status === 'active' && !!m.person),
  [v]);

  function toggle(personId: string) {
    haptics.select();
    setMemberIds(prev => prev.includes(personId) ? prev.filter(id => id !== personId) : [...prev, personId]);
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return notify('Name Needed', 'Give the crew a name, like "Paving Crew".');
    if (!isNameFree(trimmed, existing?.id)) return notify('Name Taken', `There's already a crew called "${trimmed}".`);
    if (existing) {
      if (trimmed !== existing.name || color !== existing.color) updateCrew(existing.id, { name: trimmed, color });
      setCrewMembers(existing.id, memberIds);
    } else {
      createCrew(trimmed, color, memberIds);
    }
    haptics.success();
    router.back();
  }

  function handleDelete() {
    if (!existing) return;
    const msg = `Delete ${existing.name}? Its workers stay on your team, just without a crew.`;
    const run = () => { haptics.destructive(); deleteCrew(existing.id); router.back(); };
    confirmAction('Delete Crew', msg, 'Delete Crew', run, true, 'Keep');
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <KeyboardAwareScrollView bounces={false}
        bottomOffset={KEYBOARD_GAP}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.closeButton, { backgroundColor: colors.surface }, shadow.sm]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Icon name="x" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.displayLarge, { color: colors.textPrimary, marginTop: spacing.md }]}>
          {existing ? 'Edit Crew' : 'New Crew'}
        </Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textTertiary, marginTop: 2 }]}>
          Group workers so you can pick the whole crew at once. A worker can be in more than one crew
        </Text>

        <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
          <Input label="Crew name" value={name} onChangeText={setName} placeholder="Paving Crew" autoCapitalize="words" />
          <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>Label color</Text>
          <View style={styles.swatches}>
            {CREW_COLORS.map(c => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[styles.swatch, { backgroundColor: c }, c === color && { borderColor: colors.textPrimary }]}
                accessibilityRole="button"
                accessibilityLabel={`Color ${c}`}
                accessibilityState={{ selected: c === color }}
              >
                {c === color && <Icon name="check" size={16} color={fixed.white} />}
              </Pressable>
            ))}
          </View>
          <View style={styles.previewRow}>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Shows as</Text>
            <CrewLabel name={name.trim() || 'Crew name'} color={color} />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
          <View style={styles.cardHeader}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flex: 1 }]}>Workers</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{memberIds.length} selected</Text>
          </View>
          {workers.length === 0 && (
            <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>
              No active workers yet.
            </Text>
          )}
          {workers.map(w => {
            const p = w.person!;
            const selected = memberIds.includes(w.personId);
            const otherCrews = crewsOf(w.personId).filter(c => c.id !== existing?.id);
            const inOther = otherCrews.length > 0 ? otherCrews.map(c => c.name).join(', ') : undefined;
            return (
              <Pressable
                key={w.personId}
                onPress={() => toggle(w.personId)}
                style={({ pressed }) => [styles.workerRow, pressed && { opacity: 0.7 }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${p.firstName} ${p.lastName}${inOther ? `, also in ${inOther}` : ''}`}
              >
                <Avatar firstName={p.firstName} lastName={p.lastName} size={36} uri={p.avatarUrl} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{p.firstName} {p.lastName}</Text>
                  {inOther && (
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
                      Also in {inOther}
                    </Text>
                  )}
                </View>
                <Icon name={selected ? 'check-circle' : 'circle'} size={24} color={selected ? color : colors.border} />
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: pressed ? colors.primaryDark : colors.primary }]}
          accessibilityRole="button"
        >
          <Icon name="check" size={18} color={colors.textOnPrimary} />
          <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, fontSize: 17 }]}>
            {existing ? 'Save Crew' : 'Create Crew'}
          </Text>
        </Pressable>

        {existing && (
          <Pressable onPress={handleDelete} style={styles.deleteButton} accessibilityRole="button">
            <Icon name="trash-2" size={16} color={semantic.error} />
            <Text style={[typeScale.bodyLarge, { color: semantic.error, fontWeight: '600' }]}>Delete Crew</Text>
          </Pressable>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'transparent',
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  workerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    height: 56, borderRadius: radius.full, marginTop: spacing.xl,
  },
  deleteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    paddingVertical: spacing.md, marginTop: spacing.sm,
  },
});
