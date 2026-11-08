import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { crewStopMessage } from '@/lib/maintenanceLeader';
import { formatClock } from '@/components/maintenance/format';
import { useFinishingStop, missingRequirements, uploadingPhotoCount } from '@/data/maintenanceFinish';
import { db } from '@/data/store';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { useT } from '@/i18n';
import type { MaintenanceRouteDetail, MaintenanceStopDetail } from '@/types/maintenance';

interface BarProps {
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  disabled?: boolean;
  busy?: boolean;
  /** Why it is greyed out (shown right above the button), or what it is waiting for. */
  reason?: string;
  onPress?: () => void;
}

/** The ONE primary button of the day, pinned at the bottom of Today. Dark green when it can be pressed, plainly grey when it cannot. */
export function ActionBar({ label, icon, disabled, busy, reason, onPress }: BarProps) {
  const { colors } = useTheme();
  const off = !!disabled;
  return (
    <View>
      {reason ? <Text style={[typeScale.bodySmall, styles.reason, { color: colors.textSecondary }]} numberOfLines={2}>{reason}</Text> : null}
      <Pressable
        onPress={onPress}
        disabled={off || !!busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: off, busy: !!busy }}
        style={({ pressed }) => [styles.button, { backgroundColor: off ? colors.border : colors.primaryDark, opacity: pressed && !off ? 0.9 : 1 }]}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Feather name={icon} size={20} color={off ? colors.textTertiary : '#FFFFFF'} />}
        <Text style={[typeScale.labelLarge, styles.label, { color: off ? colors.textTertiary : '#FFFFFF' }]} numberOfLines={1}>{label}</Text>
      </Pressable>
    </View>
  );
}

/**
 * The action for the next stop: I'M HERE, then FINISH STOP. Only the route's leader can press them; everyone else sees the same button
 * greyed out with who it is waiting for. FINISH STOP stays grey, with what is still missing, until every requirement is met (the same
 * rules the stop screen and the server enforce).
 */
export function StopActionBar({ stop, route, leader, starting, onArrive, onFinish }: {
  stop: MaintenanceStopDetail; route: MaintenanceRouteDetail; leader: boolean; starting?: boolean; onArrive: () => void; onFinish: () => void;
}) {
  const t = useT();
  const finishing = useFinishingStop(stop.id);
  const onSite = stop.status === 'arrived';
  const leaderName = route.lead ? `${route.lead.firstName} ${route.lead.lastName}`.trim() : undefined;
  const arrivedBy = stop.arrivedBy ? db.people[stop.arrivedBy]?.firstName : undefined;

  if (!leader) {
    return (
      <ActionBar
        label={onSite ? t('FINISH STOP') : t("I'M HERE")}
        icon={onSite ? 'check-circle' : 'navigation'}
        disabled
        reason={crewStopMessage(stop.status, leaderName, stop.arrivedAt ? formatClock(stop.arrivedAt) : null, arrivedBy, !!leaderName)}
      />
    );
  }
  if (!onSite) {
    return <ActionBar label={starting ? t('Finding your location…') : t("I'M HERE")} icon="navigation" busy={!!starting} disabled={!!starting} onPress={onArrive} />;
  }
  const missing = missingRequirements(stop);
  const uploading = uploadingPhotoCount(stop);
  const reason = finishing ? undefined
    : missing.length > 1 ? t('{first} and {n} more', { first: missing[0], n: missing.length - 1 })
    : missing.length === 1 ? missing[0]
    : uploading === 1 ? t('1 photo is still uploading.')
    : uploading > 1 ? t('{n} photos are still uploading.', { n: uploading })
    : undefined;
  return (
    <ActionBar
      label={finishing ? t('SAVING…') : t('FINISH STOP')}
      icon="check-circle"
      busy={finishing}
      disabled={missing.length > 0 || uploading > 0 || finishing}
      reason={reason}
      onPress={onFinish}
    />
  );
}

const styles = StyleSheet.create({
  button: { height: 60, borderRadius: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  label: { fontWeight: '800', letterSpacing: 0.6, flexShrink: 1 },
  reason: { textAlign: 'center', marginBottom: spacing.sm, paddingHorizontal: spacing.sm },
});
