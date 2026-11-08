/**
 * Small pieces shared by the owner's route review and property history.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { locationLabel } from '@/data/maintenance';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { LocationStatus, RouteStatus, StopStatus } from '@/types/maintenance';

type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export const STOP_STATUS: Record<StopStatus, { label: string; status: Tone }> = {
  pending: { label: 'Not started', status: 'neutral' },
  arrived: { label: 'On site', status: 'info' },
  completed: { label: 'Finished', status: 'success' },
  skipped: { label: 'Skipped', status: 'neutral' },
};

export const ROUTE_STATUS: Record<RouteStatus, { label: string; status: Tone }> = {
  planned: { label: 'Planned', status: 'neutral' },
  in_progress: { label: 'In progress', status: 'info' },
  completed: { label: 'Completed', status: 'success' },
  cancelled: { label: 'Cancelled', status: 'neutral' },
};

export function locationTone(status?: LocationStatus): Tone {
  if (status === 'verified') return 'success';
  if (status === 'outside_radius' || status === 'low_accuracy') return 'warning';
  return 'neutral';
}

/** "GPS verified" / "No GPS signal"… with an icon. Never says verified unless it was. */
export function LocationTag({ status }: { status?: LocationStatus }) {
  const { colors } = useTheme();
  const tone = locationTone(status);
  const color = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : colors.textSecondary;
  return (
    <View style={styles.tag}>
      <Icon name={tone === 'success' ? 'map-pin' : 'alert-circle'} size={12} color={color} />
      <Text style={[typeScale.caption, { color }]} numberOfLines={1}>{locationLabel(status)}</Text>
    </View>
  );
}

/** Small rounded label, e.g. "Lead". */
export function Pill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { colors } = useTheme();
  const bg = tone === 'success' ? colors.successLight : tone === 'warning' ? colors.warningLight
    : tone === 'error' ? colors.errorLight : tone === 'info' ? colors.infoLight : colors.borderLight;
  const fg = tone === 'success' ? colors.success : tone === 'warning' ? colors.warning
    : tone === 'error' ? colors.error : tone === 'info' ? colors.info : colors.textSecondary;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[typeScale.caption, { color: fg, fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[typeScale.overline, { color: colors.textSecondary, flex: 1 }]}>{children}</Text>
      {right}
    </View>
  );
}

export function formatServiceDate(dateKey: string, opts: { relative?: boolean; today?: string } = {}): string {
  if (opts.relative && opts.today) {
    if (dateKey === opts.today) return 'Today';
    const [y, m, d] = opts.today.split('-').map(Number);
    const yest = new Date(y, m - 1, d - 1);
    const tom = new Date(y, m - 1, d + 1);
    const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    if (dateKey === key(yest)) return 'Yesterday';
    if (dateKey === key(tom)) return 'Tomorrow';
  }
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, alignSelf: 'flex-start' },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm, marginHorizontal: spacing.xs },
});
