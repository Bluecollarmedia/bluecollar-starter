import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic, brand } from '@/theme/colors';
import { useNotifications } from '@/hooks/useOperations';
import { ownerNotificationTarget } from '@/lib/notificationTarget';
import type { NotificationEventType } from '@/types/operations';

const EVENT_ICONS: Record<NotificationEventType, { icon: string; color: string }> = {
  issue_reported: { icon: 'alert-triangle', color: semantic.warning },
  worker_checked_in: { icon: 'log-in', color: semantic.success },
  worker_checked_out: { icon: 'log-out', color: '#757575' },
  worker_checked_in_late: { icon: 'alert-circle', color: semantic.warning },
  worker_outside_radius: { icon: 'map-pin', color: semantic.error },
  worker_not_checked_in: { icon: 'x-circle', color: semantic.error },
  worker_past_scheduled_end: { icon: 'clock', color: semantic.warning },
  worker_completed_task: { icon: 'check-square', color: semantic.success },
  worker_completed_job: { icon: 'check-circle', color: semantic.success },
  photo_waiting_review: { icon: 'camera', color: semantic.info },
  customer_request_submitted: { icon: 'message-square', color: semantic.info },
  customer_message: { icon: 'message-circle', color: semantic.info },
  service_request: { icon: 'inbox', color: semantic.info },
  schedule_changed: { icon: 'calendar', color: brand.primary },
  schedule_conflict: { icon: 'alert-triangle', color: semantic.error },
  announcement_posted: { icon: 'volume-2', color: brand.primary },
  quote_approved: { icon: 'check-circle', color: semantic.success },
  quote_declined: { icon: 'x-circle', color: semantic.error },
  quote_sent: { icon: 'file-text', color: semantic.info },
  invoice_issued: { icon: 'dollar-sign', color: semantic.info },
  time_skip_request: { icon: 'skip-forward', color: semantic.warning },
  time_over_target: { icon: 'clock', color: semantic.warning },
  time_overtime: { icon: 'trending-up', color: semantic.warning },
  time_unusual: { icon: 'alert-circle', color: semantic.warning },
  time_progress_check: { icon: 'clock', color: semantic.info },
};
const FALLBACK_ICON = { icon: 'bell', color: brand.primary };

function formatTimeAgo(isoStr: string): string {
  const now = Date.now();
  const then = new Date(isoStr).getTime();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function NotificationCenterScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();

  function confirmClearAll() {
    const title = 'Clear all notifications?';
    const message = 'This will remove all notifications from your notification center. Your messages and project data will not be deleted.';
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear All', style: 'destructive', onPress: clearAll },
    ]);
  }

  const sorted = [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, borderBottomColor: colors.borderLight }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>
          Notifications
        </Text>
        <View style={styles.topActions}>
          {unreadCount > 0 && (
            <Pressable onPress={markAllRead} hitSlop={10} accessibilityRole="button" accessibilityLabel="Mark all notifications as read">
              <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Read All</Text>
            </Pressable>
          )}
          {sorted.length > 0 && (
            <Pressable onPress={confirmClearAll} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear all notifications">
              <Text style={[typeScale.labelSmall, { color: colors.error }]}>Clear All</Text>
            </Pressable>
          )}
        </View>
      </View>

      {unreadCount > 0 && (
        <View style={[styles.unreadBanner, { backgroundColor: colors.primarySurface }]}>
          <Text style={[typeScale.labelSmall, { color: colors.primary }]}>
            {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      <ScrollView bounces={false} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {sorted.map((n) => {
          const eventConfig = EVENT_ICONS[n.eventType] ?? FALLBACK_ICON;
          const isUnread = n.status === 'unread';
          return (
            <Pressable
              key={n.id}
              style={[
                styles.notifRow,
                { borderBottomColor: colors.borderLight },
                isUnread && { backgroundColor: colors.primarySurface + '40' },
              ]}
              onPress={() => {
                if (isUnread) markRead(n.id);
                // Only THIS notification is marked read. Then go straight to what it is about (a customer
                // message opens that customer's thread). This screen is a modal: close it first.
                const target = ownerNotificationTarget(n);
                if (!target) return;
                router.back();
                router.push(target as any);
              }}
            >
              <View
                style={[
                  styles.notifIcon,
                  { backgroundColor: eventConfig.color + '18' },
                ]}
              >
                <Icon name={eventConfig.icon as any} size={18} color={eventConfig.color} />
              </View>
              <View style={styles.notifContent}>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: isUnread ? '600' : '400' }]}>
                  {n.title}
                </Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={2}>
                  {n.body}
                </Text>
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing['2xs'] }]}>
                  {formatTimeAgo(n.createdAt)}
                </Text>
              </View>
              {isUnread && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
            </Pressable>
          );
        })}

        {sorted.length === 0 && (
          <EmptyState icon="bell-off" title="No notifications yet" description="You're all caught up." />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 50, justifyContent: 'flex-end' },
  unreadBanner: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  content: { paddingBottom: spacing['5xl'] },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: 1,
  },
  notifIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifContent: { flex: 1 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: spacing.xs,
  },
  empty: { alignItems: 'center', paddingVertical: spacing['4xl'] },
});
