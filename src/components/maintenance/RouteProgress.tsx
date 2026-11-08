import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import type { MaintenanceStopDetail } from '@/types/maintenance';
import { displayStatus } from './types';
import { useT } from '@/i18n';

/** Past this many stops the dots get too small to read, so a bar is shown instead. */
const MAX_DOTS = 10;

/** The step tracker under "Today's Route": one dot per stop, in route order. */
export function RouteProgress({ stops, nextStopId }: { stops: MaintenanceStopDetail[]; nextStopId?: string }) {
  const t = useT();
  const { colors } = useTheme();
  const done = stops.filter(s => s.status === 'completed' || s.status === 'skipped').length;
  const completed = stops.filter(s => s.status === 'completed').length;
  const label = stops.length === 1
    ? t('{done} of 1 stop completed', { done: completed })
    : t('{done} of {total} stops completed', { done: completed, total: stops.length });

  return (
    <View accessible accessibilityLabel={label}>
      {stops.length <= MAX_DOTS ? (
        <View style={styles.track}>
          {stops.map((s, i) => {
            const isDone = s.status === 'completed';
            const isSkipped = s.status === 'skipped';
            const shown = displayStatus(s, nextStopId);
            const isCurrent = shown === 'next' || shown === 'arrived';
            return (
              <React.Fragment key={s.id}>
                {i > 0 && (
                  <View
                    style={[
                      styles.line,
                      { backgroundColor: stops[i - 1].status === 'completed' || stops[i - 1].status === 'skipped' ? colors.primary : colors.border },
                    ]}
                  />
                )}
                <View
                  style={[
                    styles.dot,
                    isDone
                      ? { backgroundColor: colors.primary, borderColor: colors.primary }
                      : isSkipped
                        ? { backgroundColor: colors.border, borderColor: colors.border }
                        : { backgroundColor: colors.surface, borderColor: isCurrent ? colors.primary : colors.border },
                  ]}
                >
                  {isDone && <Feather name="check" size={13} color="#FFFFFF" />}
                  {isSkipped && <Feather name="minus" size={13} color={colors.textSecondary} />}
                  {isCurrent && <View style={[styles.currentInner, { backgroundColor: colors.primary }]} />}
                </View>
              </React.Fragment>
            );
          })}
        </View>
      ) : (
        <View style={[styles.bar, { backgroundColor: colors.border }]}>
          <View style={[styles.barFill, { backgroundColor: colors.primary, width: `${(done / stops.length) * 100}%` }]} />
        </View>
      )}
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>{label}</Text>
    </View>
  );
}

const DOT = 24;

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  currentInner: { width: 8, height: 8, borderRadius: 4 },
  line: { flex: 1, maxWidth: 40, height: 2 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
});
