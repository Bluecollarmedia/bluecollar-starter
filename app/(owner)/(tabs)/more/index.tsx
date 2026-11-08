import React from 'react';
import { useGuardedSignOut } from '@/hooks/useGuardedSignOut';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar, MenuGroup, MenuRow } from '@/components/ui';
import { useOpenIssueCount } from '@/data/issues';
import { useOpenReportCount } from '@/data/contentReports';
import { useServiceRequests } from '@/data/serviceRequests';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { isFeatureOn, leaderPlural, words, w } from '@/config/brand';

export default function MoreScreen() {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance();
  const { user, signOut, memberRole } = useAuth();
  const guardedSignOut = useGuardedSignOut();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const openIssueCount = useOpenIssueCount();
  const openReportCount = useOpenReportCount();
  const { newCount: newRequestCount } = useServiceRequests();

  const go = (route: string) => router.push(route as any);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false}
        contentContainerStyle={{ paddingBottom: tabBarClearance + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>More</Text>
        </View>

        <Pressable
          onPress={() => go('/(owner)/more/settings')}
          accessibilityRole="button"
          accessibilityLabel="Your account"
          style={({ pressed }) => [styles.profile, pressed && { backgroundColor: colors.surfacePressed }]}
        >
          <Avatar
            firstName={user?.firstName ?? 'O'}
            lastName={user?.lastName ?? 'W'}
            size={52}
            uri={user?.avatarUrl}
          />
          <View style={styles.profileInfo}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} numberOfLines={1}>
              {user?.firstName} {user?.lastName}
            </Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textTertiary} />
        </Pressable>
        <View style={[styles.hairline, { backgroundColor: colors.borderLight }]} />

        <MenuGroup title="BUSINESS">
          <MenuRow icon="user" label="Customers" subtitle={`Customer directory and their ${words.jobs.toLowerCase()}`} onPress={() => go('/(owner)/customers')} />
          {isFeatureOn('financials') && (
            <MenuRow icon="file-text" label="Quotes & Invoices" subtitle="Quotes, change orders and invoices" onPress={() => go('/(owner)/more/financials')} />
          )}
          {isFeatureOn('issues') && (
            <MenuRow icon="alert-triangle" label="Issues" subtitle={w("Problems your crew reported")} count={openIssueCount} onPress={() => go('/(owner)/issues')} />
          )}
          {isFeatureOn('requests') && (
            <MenuRow icon="inbox" label="Service requests" subtitle="People who asked for work from the app" count={newRequestCount} onPress={() => go('/(owner)/service-requests')} />
          )}
          {isFeatureOn('reports') && (
            <MenuRow icon="flag" label="Reported content" subtitle="Messages and photos people flagged" count={openReportCount} onPress={() => go('/(owner)/reports')} />
          )}
          {isFeatureOn('materials') && (
            <MenuRow icon="clipboard" label="Materials" subtitle={w("What to order or pick up for upcoming jobs")} onPress={() => go('/(owner)/more/materials')} />
          )}
          <MenuRow icon="key" label="Company Resources" subtitle="Codes and info, and who can see them" onPress={() => go('/(owner)/resources')} />
          {isFeatureOn('announcements') && (
            <MenuRow icon="volume-2" label="Announcements" subtitle="Company-wide messages" onPress={() => go('/(owner)/more/announcements')} />
          )}
        </MenuGroup>

        <MenuGroup title="TEAM">
          <MenuRow icon="user-plus" label="Add Worker" subtitle="Name and phone, then send a private link" onPress={() => go('/(owner)/worker-new')} />
          <MenuRow icon="shield" label="Team Access" subtitle={`${leaderPlural()} and deactivated workers`} onPress={() => go('/(owner)/more/team-access')} />
          {memberRole !== 'admin' && (
            <MenuRow icon="users" label="Accounts" subtitle="Everyone who has signed up" onPress={() => go('/(owner)/more/accounts')} />
          )}
        </MenuGroup>

        <MenuGroup title="OPERATIONS">
          <MenuRow icon="calendar" label="Schedule" subtitle="Daily and weekly planning" onPress={() => go('/(owner)/more/schedule')} />
          {isFeatureOn('trucks') && (
            <MenuRow icon="truck" label="Trucks" subtitle="Vehicles and equipment" onPress={() => go('/(owner)/more/trucks')} />
          )}
        </MenuGroup>

        {isFeatureOn('timeClock') && (
        <MenuGroup title="HOURS & LABOR">
          <MenuRow icon="clock" label="Hours & Labor" subtitle={`Who is clocked in, ${words.place.toLowerCase()} times and alerts`} onPress={() => go('/(owner)/more/labor')} />
          <MenuRow icon="check-square" label="Payroll Review" subtitle="Approve each employee's day" onPress={() => go('/(owner)/more/labor-review')} />
          <MenuRow icon="calendar" label="Weekly Summary" subtitle="Hours, overtime and cost by employee" onPress={() => go('/(owner)/more/labor-week')} />
          <MenuRow icon="map-pin" label={`${words.place} & ${words.job} History`} subtitle="Every visit, averages and labor cost" onPress={() => go('/(owner)/more/labor-properties')} />
          <MenuRow icon="user-check" label="Attendance" subtitle={w("Job check-ins and status")} onPress={() => go('/(owner)/more/attendance')} />
          <MenuRow icon="dollar-sign" label="Payroll Estimate" subtitle="Weekly pay estimates and pay settings" onPress={() => go('/(owner)/more/payroll')} />
          <MenuRow icon="sliders" label="Hours & Labor Settings" subtitle="Breaks, photos, alerts and pay rates" onPress={() => go('/(owner)/more/labor-settings')} />
        </MenuGroup>
        )}

        <MenuGroup title="ACCOUNT">
          <MenuRow icon="bell" label="Notifications" subtitle="What gets sent, and to whom" onPress={() => go('/(owner)/more/notifications')} />
          <MenuRow icon="settings" label="Settings" subtitle="Company, storage and app settings" onPress={() => go('/(owner)/more/settings')} />
        </MenuGroup>

        <View style={[styles.hairline, styles.signOutTop, { backgroundColor: colors.borderLight }]} />
        <Pressable
          onPress={guardedSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          style={({ pressed }) => [styles.signOut, pressed && { backgroundColor: colors.surfacePressed }]}
        >
          <Icon name="log-out" size={18} color={semantic.error} />
          <Text style={[typeScale.labelLarge, { color: semantic.error }]}>Sign Out</Text>
        </Pressable>
        <View style={[styles.hairline, { backgroundColor: colors.borderLight }]} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  profileInfo: { flex: 1 },
  hairline: { height: StyleSheet.hairlineWidth },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  signOutTop: { marginTop: spacing.xl },
});
