/**
 * Announcements: ONE page. Pick who it is for (Workers or Customers), write it, send it, and the ones already sent are right below.
 * There is no pencil to open a second screen and no separate "message customers" screen.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { StatusBadge } from '@/components/ui';
import { WorkerAnnouncementComposer } from '@/components/announcements/WorkerAnnouncementComposer';
import { MessageCustomersPanel } from '@/components/announcements/MessageCustomersScreen';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { Announcement } from '@/types/announcement';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

type Audience = 'workers' | 'customers';

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffHrs = Math.floor((now.getTime() - d.getTime()) / 3600000);
  if (diffHrs < 1) return 'Just now';
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays}d ago`;
}

export default function AnnouncementsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { announcements } = useAnnouncements();
  const [audience, setAudience] = useState<Audience>('workers');
  const [expandedAnnouncement, setExpandedAnnouncement] = useState<Announcement | null>(null);

  const sorted = [...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>Announcements</Text>
      </View>

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.segment, { backgroundColor: colors.backgroundTertiary }]}>
          {(['workers', 'customers'] as const).map((key) => {
            const on = audience === key;
            return (
              <Pressable
                key={key}
                onPress={() => setAudience(key)}
                style={[styles.segmentItem, on && { backgroundColor: colors.surface }, on && shadow.sm]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={key === 'workers' ? 'Announcement to workers' : 'Message to customers'}
              >
                <Icon name={key === 'workers' ? 'briefcase' : 'users'} size={15} color={on ? colors.primary : colors.textSecondary} />
                <Text style={[typeScale.labelLarge, { color: on ? colors.primary : colors.textSecondary, fontWeight: on ? '700' : '600' }]}>
                  {key === 'workers' ? 'Workers' : 'Customers'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {audience === 'workers' ? (
          <>
            <WorkerAnnouncementComposer />

            {sorted.length > 0 ? (
              <>
                <Text style={[typeScale.overline, { color: colors.textTertiary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>SENT ANNOUNCEMENTS</Text>
                {sorted.map((ann) => (
                  <Pressable
                    key={ann.id}
                    style={[styles.sentCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }, shadow.sm]}
                    onPress={() => setExpandedAnnouncement(ann)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${ann.title}`}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.annHeader}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: spacing.sm }]} numberOfLines={1}>{ann.title}</Text>
                        {ann.priority === 'urgent' ? <StatusBadge label="Urgent" status="error" /> : null}
                      </View>
                      <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                        {ann.author?.firstName} {ann.author?.lastName} · {formatDate(ann.createdAt)}
                      </Text>
                      <View style={styles.readRow}>
                        <Icon name="eye" size={12} color={colors.textTertiary} />
                        <Text style={[typeScale.caption, { color: colors.textTertiary, marginLeft: 4 }]}>{ann.readCount}/{ann.totalRecipients} read</Text>
                      </View>
                    </View>
                    <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                  </Pressable>
                ))}
              </>
            ) : null}
          </>
        ) : (
          <View style={{ marginHorizontal: -spacing.lg }}>
            <MessageCustomersPanel />
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* A sent announcement, opened to read it in full */}
      <BottomSheetModal visible={!!expandedAnnouncement} onRequestClose={() => setExpandedAnnouncement(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setExpandedAnnouncement(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.borderLight }]} />
            {expandedAnnouncement ? (
              <>
                <View style={styles.annHeader}>
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700', flex: 1, marginRight: spacing.sm }]}>{expandedAnnouncement.title}</Text>
                  {expandedAnnouncement.priority === 'urgent' ? <StatusBadge label="Urgent" status="error" /> : null}
                </View>
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                  {expandedAnnouncement.author?.firstName} {expandedAnnouncement.author?.lastName} · {formatDate(expandedAnnouncement.createdAt)}
                </Text>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: spacing.md, lineHeight: 22 }]}>{expandedAnnouncement.body}</Text>
                <View style={[styles.annFooter, { borderTopColor: colors.borderLight }]}>
                  <Icon name="eye" size={14} color={colors.textTertiary} />
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginLeft: spacing.xs }]}>
                    {expandedAnnouncement.readCount}/{expandedAnnouncement.totalRecipients} read
                  </Text>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  backButton: { padding: spacing.xs },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] + 90 },
  segment: { flexDirection: 'row', borderRadius: radius.lg, padding: 4, marginBottom: spacing.lg },
  segmentItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderRadius: radius.md },
  annHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  annFooter: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  sentCard: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, padding: spacing.md, marginBottom: spacing.sm },
  readRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
});
