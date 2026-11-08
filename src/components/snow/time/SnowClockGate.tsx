/**
 * The Snow worker's Route tab. It ALWAYS shows the worker's route and stops: there is no Clock In screen in the way, and nothing here clocks anyone
 * in or out. Clocking in and out is manual, from the Time Clock tab only, any time, whether or not a storm is dispatched or a job is started.
 * A quiet "Clocked in since ..." line at the top shows whether the worker is clocked in. The state comes from the database's clock (useSnowClock).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LoadingSpinner } from '@/components/ui';
import { MyRouteScreen } from '@/components/snow/routes/MyRouteScreen';
import { useTheme } from '@/providers/ThemeProvider';
import { useSnowClock } from '@/hooks/useSnowClock';
import { SnowStaleShiftCard } from '@/components/snow/time/SnowStaleShiftCard';

export function SnowClockGate() {
  const { colors } = useTheme();
  const { open, stale, loading, busy, claimStale } = useSnowClock();
  // A shift that was never clocked out of is NEVER "clocked in" (useSnowClock keeps it out of `open`): one calm card, today's work carries on.
  const staleCard = stale ? <SnowStaleShiftCard shift={stale} busy={busy} onAnswer={(iso) => claimStale(stale.id, iso)} /> : null;
  if (loading) {
    return <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}><LoadingSpinner /></View>;
  }
  return <MyRouteScreen clockedInSince={open?.clockInAt} topNotice={staleCard} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
