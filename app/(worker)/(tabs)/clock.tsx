import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useTheme } from '@/providers/ThemeProvider';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { WorkdayCard } from '@/components/time/WorkdayCard';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { useT } from '@/i18n';

const timeOfDay = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * The Clock tab: the worker's time clock and nothing else. Clock in (the app also opens here when you are not clocked in yet), clock out, and clock
 * back in if you clocked out by mistake. It is the same workday the Today screen and the owner see (one source), so the two always agree.
 */
export default function ClockScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const t = useT();
  const { workday: w } = useWorkerContext();
  const today = (w.day?.days ?? [])
    .filter((d) => d.status !== 'needs_review' && d.workDate === w.day?.workDate)
    .sort((a, b) => a.clockInAt.localeCompare(b.clockInAt));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: clearance }}
      >
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Clock')}</Text>
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginBottom: spacing.lg }]}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>

        {w.installed === false ? (
          <View style={[styles.card, { backgroundColor: colors.surface }, shadow.md]}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('The time clock is not available yet')}</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>{t('Ask the owner to finish setting up time tracking.')}</Text>
          </View>
        ) : (
          <WorkdayCard portal preShiftTitle={t('Clock in')} preShiftText={t('Tap below to start your workday.')} />
        )}

        {today.length ? (
          <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.sm }]}>{t('Today')}</Text>
            {today.map((d) => (
              <View key={d.id} style={styles.punch}>
                <Text style={[typeScale.bodyMedium, { color: colors.textPrimary }]}>
                  {t('In')} {timeOfDay(d.clockInAt)}
                </Text>
                <Text style={[typeScale.bodyMedium, { color: d.clockOutAt ? colors.textPrimary : colors.success }]}>
                  {d.clockOutAt ? `${t('Out')} ${timeOfDay(d.clockOutAt)}` : t('On the clock')}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.lg },
  punch: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 },
});
