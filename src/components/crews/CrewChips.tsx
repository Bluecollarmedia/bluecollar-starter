/**
 * One tap puts a whole crew on a job or route. The people stay editable: the list under these chips
 * still adds or removes anyone, and tapping a crew again takes its people back off.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import { typeScale } from '@/theme/typography';
import { radius, spacing } from '@/theme/spacing';
import type { Crew } from '@/types/crew';

/** `ok: false` with no reason hides the person quietly (not on this list, or already on it); with a reason it is shown. */
export type CrewPerson = { ok: true } | { ok: false; reason?: string };

interface Props {
  crews: Crew[];
  /** The people picked right now. */
  picked: string[];
  onChange: (next: string[]) => void;
  /** Whether a crew member can be added here. Defaults to everyone. */
  check?: (personId: string) => CrewPerson;
}

export function CrewChips({ crews, picked, onChange, check }: Props) {
  const { colors } = useTheme();
  const [note, setNote] = React.useState('');
  if (crews.length === 0) return null;

  const split = (crew: Crew) => {
    const add: string[] = [];
    const skipped: string[] = [];
    for (const pid of crew.memberIds) {
      const c = check ? check(pid) : ({ ok: true } as CrewPerson);
      if (c.ok) add.push(pid);
      else if (c.reason) skipped.push(`${db.people[pid]?.firstName ?? 'Someone'} ${c.reason}`);
    }
    return { add, skipped };
  };

  const toggle = (crew: Crew) => {
    const { add, skipped } = split(crew);
    const allIn = add.length > 0 && add.every((id) => picked.includes(id));
    onChange(allIn ? picked.filter((id) => !add.includes(id)) : [...picked, ...add.filter((id) => !picked.includes(id))]);
    setNote(!allIn && skipped.length ? `Not added: ${skipped.join('; ')}. You can still add them below.` : '');
  };

  return (
    <View>
      <View style={styles.row}>
        {crews.map((c) => {
          const { add } = split(c);
          const allIn = add.length > 0 && add.every((id) => picked.includes(id));
          return (
            <Pressable
              key={c.id}
              onPress={() => toggle(c)}
              disabled={add.length === 0}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: allIn ? c.color : `${c.color}1F` },
                add.length === 0 && { opacity: 0.45 },
                pressed && { transform: [{ scale: 0.96 }] },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: allIn }}
              accessibilityLabel={`${allIn ? 'Remove' : 'Add'} ${c.name}`}
            >
              <Icon name={allIn ? 'check' : 'plus'} size={13} color={allIn ? '#FFFFFF' : c.color} />
              <Text style={[typeScale.bodySmall, { color: allIn ? '#FFFFFF' : c.color, fontWeight: '700' }]} numberOfLines={1}>
                {c.name} · {add.length}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {note ? <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    maxWidth: '100%',
  },
});
