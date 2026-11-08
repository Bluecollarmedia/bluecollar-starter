import { useBackStep } from '@/hooks/useBackStep';
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Switch } from '@/components/ui/Switch';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Avatar, ScreenHeader, GlassIconButton, SegmentedTabs } from '@/components/ui';
import { IconTile } from '@/components/settings/SettingsList';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { useNotifications } from '@/hooks/useOperations';
import { EVENT_LABELS, ALL_EVENTS } from '@/lib/notificationEvents';
import { db, useDb } from '@/data/store';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

type Tab = 'defaults' | 'overrides';

export default function NotificationPreferencesScreen() {
  const tabBarClearance = useTabBarClearance();
  const { colors } = useTheme();
  const router = useRouter();
  const { unreadCount, preferences, getCompanyDefault, getWorkerOverride, updatePreference, setWorkerOverride } = useNotifications();

  const [tab, setTab] = useState<Tab>('defaults');
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  // The back swipe leaves one worker's settings for the list first, not the whole screen.
  useBackStep(selectedWorker != null, () => setSelectedWorker(null));

  useDb();
  const workers = db.members.filter((m) => m.role === 'worker' && m.status === 'active' && !!m.person);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader
        title="Notifications"
        subtitle="What gets sent, and to whom"
        right={
          <GlassIconButton
            icon="bell"
            onPress={() => router.push('/(owner)/notification-center' as any)}
            accessibilityLabel="Notification history"
            badge={unreadCount}
          />
        }
      />

      <SegmentedTabs
        options={[
          { value: 'defaults' as Tab, label: 'Company Defaults' },
          { value: 'overrides' as Tab, label: 'Worker Overrides' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        {tab === 'defaults' && (
          <>
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              These are the default notification settings for all workers. You can override these per-worker in the Overrides tab.
            </Text>
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {ALL_EVENTS.map((eventType, i) => {
              const pref = getCompanyDefault(eventType);
              const info = EVENT_LABELS[eventType];
              const enabled = pref?.enabled ?? true;
              return (
                <View key={eventType} style={[styles.prefRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                  <IconTile name={info.icon as any} color={enabled ? colors.primaryOnWhite : colors.textTertiary} />
                  <View style={styles.prefInfo}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{info.label}</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 1 }]}>{info.description}</Text>
                  </View>
                  <Switch
                    value={enabled}
                    onValueChange={(val) => {
                      if (pref) updatePreference(pref.id, val);
                    }}
                  />
                </View>
              );
            })}
            </View>
          </>
        )}

        {tab === 'overrides' && !selectedWorker && (
          <>
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              Select a worker to set notification overrides that differ from company defaults.
            </Text>
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {workers.map((m, i) => {
              const overrideCount = preferences.filter((p) => p.personId === m.personId).length;
              return (
                <Pressable
                  key={m.personId}
                  style={[styles.workerRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}
                  onPress={() => setSelectedWorker(m.personId)}
                  accessibilityRole="button"
                >
                  <Avatar firstName={m.person!.firstName} lastName={m.person!.lastName} size={36} uri={m.person!.avatarUrl} />
                  <View style={styles.workerInfo}>
                    <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                      {m.person!.firstName} {m.person!.lastName}
                    </Text>
                    {overrideCount > 0 && (
                      <Text style={[typeScale.caption, { color: colors.primaryOnWhite }]}>
                        {overrideCount} override{overrideCount !== 1 ? 's' : ''}
                      </Text>
                    )}
                  </View>
                  <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                </Pressable>
              );
            })}
            </View>
          </>
        )}

        {tab === 'overrides' && selectedWorker && (
          <>
            <Pressable
              style={styles.backLink}
              onPress={() => setSelectedWorker(null)}
              accessibilityRole="button"
            >
              <Icon name="arrow-left" size={16} color={colors.primaryOnWhite} />
              <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite }]}>All Workers</Text>
            </Pressable>
            {(() => {
              const w = workers.find((m) => m.personId === selectedWorker);
              return (
                <View style={[styles.workerHeader, { borderBottomColor: colors.borderLight }]}>
                  <Avatar firstName={w?.person?.firstName ?? '?'} lastName={w?.person?.lastName ?? '?'} size={40} uri={w?.person?.avatarUrl} />
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
                    {w?.person?.firstName} {w?.person?.lastName}
                  </Text>
                </View>
              );
            })()}
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {ALL_EVENTS.map((eventType, i) => {
              const companyDefault = getCompanyDefault(eventType);
              const override = getWorkerOverride(selectedWorker, eventType);
              const info = EVENT_LABELS[eventType];
              const defaultEnabled = companyDefault?.enabled ?? true;
              const currentEnabled = override?.enabled ?? defaultEnabled;
              const hasOverride = override !== undefined;
              return (
                <View key={eventType} style={[styles.prefRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                  <IconTile name={info.icon as any} color={currentEnabled ? colors.primaryOnWhite : colors.textTertiary} />
                  <View style={styles.prefInfo}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{info.label}</Text>
                    {hasOverride && (
                      <Text style={[typeScale.caption, { color: colors.warning }]}>
                        Override (default: {defaultEnabled ? 'ON' : 'OFF'})
                      </Text>
                    )}
                    {!hasOverride && (
                      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                        Using default ({defaultEnabled ? 'ON' : 'OFF'})
                      </Text>
                    )}
                  </View>
                  <Switch
                    value={currentEnabled}
                    onValueChange={(val) => setWorkerOverride(selectedWorker, eventType, val)}
                  />
                </View>
              );
            })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing['5xl'] },
  group: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  prefInfo: { flex: 1 },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  workerInfo: { flex: 1 },
  backLink: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  workerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
  },
});
