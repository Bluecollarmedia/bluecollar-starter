import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Switch } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export const MAX_PHOTOS = 20;

/**
 * "Photos required" with how many. Used for a service (when it is set up), for one stop, and for a whole route, so the owner chooses the
 * same way everywhere: switch it off, or on with a number of photos. When on, the crew also needs ONE PHOTO PER TASK before ticking it.
 */
export function PhotoRuleEditor({ label = 'Photos required', on, count, onChange, hint }: {
  label?: string;
  on: boolean;
  count: number;
  onChange: (on: boolean, count: number) => void;
  hint?: string;
}) {
  const { colors } = useTheme();
  const set = (n: number) => onChange(true, Math.max(1, Math.min(MAX_PHOTOS, n)));
  return (
    <View>
      <View style={styles.row}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{label}</Text>
        <Switch value={on} onValueChange={(v) => onChange(v, Math.max(1, count))} accessibilityLabel={label} />
      </View>
      {on ? <PhotoCountStepper count={count} onChange={set} /> : null}
      {hint ? <Text style={[typeScale.caption, { color: colors.textTertiary, paddingHorizontal: spacing.md, paddingBottom: spacing.xs }]}>{hint}</Text> : null}
    </View>
  );
}

/** "How many photos", 1 to 20. */
export function PhotoCountStepper({ count, onChange }: { count: number; onChange: (n: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, flex: 1 }]}>How many photos</Text>
      <View style={styles.stepper}>
        <Pressable onPress={() => onChange(count - 1)} disabled={count <= 1} accessibilityRole="button" accessibilityLabel="Fewer photos" hitSlop={8}
          style={[styles.step, { borderColor: colors.border, opacity: count <= 1 ? 0.4 : 1 }]}>
          <Icon name="minus" size={18} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, minWidth: 28, textAlign: 'center' }]} accessibilityLabel={`${count} photos`}>{count}</Text>
        <Pressable onPress={() => onChange(count + 1)} disabled={count >= MAX_PHOTOS} accessibilityRole="button" accessibilityLabel="More photos" hitSlop={8}
          style={[styles.step, { borderColor: colors.border, opacity: count >= MAX_PHOTOS ? 0.4 : 1 }]}>
          <Icon name="plus" size={18} color={colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: { width: 40, height: 40, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
