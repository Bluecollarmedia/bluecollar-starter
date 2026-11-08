import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { clockOutCrew } from '@/data/timeTracking';
import { crewClockOutMessage } from '@/lib/maintenanceLeader';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

/**
 * Shown to the crew leader (and the owner) once the last stop of the route is finished: "Clock out the whole crew now? / Not yet".
 * Nothing happens by itself. "Not yet" keeps a smaller button so the leader can still do it later.
 */
export function CrewClockOutCard({ routeId }: { routeId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const [stage, setStage] = useState<'ask' | 'later' | 'busy' | 'done'>('ask');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function clockOut() {
    if (stage === 'busy') return;
    haptics.select();
    const before = stage;
    setStage('busy');
    setError(null);
    const res = await clockOutCrew(routeId);
    if (!res.ok) {
      haptics.warning();
      setError(res.error);
      setStage(before === 'later' ? 'later' : 'ask');
      return;
    }
    haptics.success();
    setMessage(crewClockOutMessage(res.data.closed, res.data.stillWorking));
    setStage('done');
  }

  if (stage === 'done') {
    return (
      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Feather name="clock" size={20} color={colors.primaryDark} />
        <Text style={[typeScale.bodySmall, styles.text, { color: colors.textPrimary }]}>{message}</Text>
      </View>
    );
  }

  const busy = stage === 'busy';
  return (
    <View style={[styles.box, styles.column, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {stage === 'later' ? null : (
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('Clock out the whole crew now?')}</Text>
      )}
      {stage === 'later' ? null : (
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
          {t("The last stop is finished. This ends everyone's workday on this route at this moment.")}
        </Text>
      )}
      {error ? <Text style={[typeScale.bodySmall, { color: colors.error }]}>{t(error)}</Text> : null}
      <View style={styles.row}>
        <Pressable
          onPress={clockOut}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('Clock out the whole crew')}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.primaryDark, opacity: busy ? 0.6 : pressed ? 0.9 : 1 }]}
        >
          <Feather name="log-out" size={18} color="#FFFFFF" />
          <Text style={[typeScale.labelLarge, styles.buttonText]}>{busy ? t('Clocking out…') : stage === 'later' ? t('CLOCK OUT THE WHOLE CREW') : t('CLOCK OUT CREW')}</Text>
        </Pressable>
        {stage === 'ask' ? (
          <Pressable
            onPress={() => { haptics.select(); setStage('later'); }}
            accessibilityRole="button"
            accessibilityLabel={t('Not yet')}
            style={({ pressed }) => [styles.later, { borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{t('NOT YET')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  column: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  text: { flex: 1, marginLeft: spacing.md },
  button: { flex: 1, minHeight: 48, borderRadius: radius.lg, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  buttonText: { color: '#FFFFFF' },
  later: { minHeight: 48, borderRadius: radius.lg, paddingHorizontal: spacing.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
