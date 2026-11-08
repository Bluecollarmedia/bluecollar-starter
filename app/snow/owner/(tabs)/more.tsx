/**
 * Snow Mode More (Owner): the ONE place for every Snow setting. The header is one bundled picture (snow-mode-more-header.png: the
 * green leaf, the blue "Snow Mode" wordmark, the "More" title and the snowy evergreens). Everything under it is real, working
 * controls in grouped white cards: the rules and alerts, customer messages, records, storm management, your profile and mode,
 * legal pages, Sign Out and Delete Account. Team and Properties have their own tabs, so they are not repeated here.
 */
import { LanguageRow } from '@/components/ui/LanguageSwitch';
import React from 'react';
import { useGuardedSignOut } from '@/hooks/useGuardedSignOut';
import { View, Text, ScrollView, Pressable, Image, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { Avatar, ListSection } from '@/components/ui';
import { DeleteAccountRow } from '@/components/account/DeleteAccountRow';
import { useModeSwitch } from '@/components/snow/ModeSwitchRow';
import { usePublicWeatherRow } from '@/hooks/usePublicWeatherRow';
import { OwnerCustomerMessages, OwnerStopAlertsToggle } from '@/components/snow/notifications/SnowNotifySettings';
import { StopRuleToggle } from '@/components/snow/settings/StopRuleToggle';
import { AutoShareToggle } from '@/components/snow/settings/AutoShareToggle';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { db, useDb } from '@/data/store';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

/** The bundled header picture (made by scripts/make-snow-more-header.py). 941 x 500 pixels. */
const HEADER_IMAGE = require('../../../../assets/images/snow-mode-more-header.png');
const HEADER_RATIO = 941 / 500;
/** How much of the picture's height sits behind the first card (the snowy slope fades out there). */
const HEADER_OVERLAP = 0.33;

type IconName = React.ComponentProps<typeof Icon>['name'];

export default function SnowOwnerMoreScreen() {
  useDb();
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const guardedSignOut = useGuardedSignOut();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const tabBarClearance = useTabBarClearance();
  const mode = useModeSwitch();
  const weatherRow = usePublicWeatherRow();

  const headerHeight = width / HEADER_RATIO;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView bounces={false}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarClearance + spacing.lg }}
      >
        {/* Decorative branding only: no controls live in the picture. It runs under the status bar. */}
        <Image
          source={HEADER_IMAGE}
          style={{ position: 'absolute', top: 0, left: 0, width, height: headerHeight }}
          resizeMode="cover"
          accessible
          accessibilityRole="image"
          accessibilityLabel="Snow Mode, More"
        />

        <View style={{ paddingTop: headerHeight * (1 - HEADER_OVERLAP), paddingHorizontal: spacing.lg }}>
          {db.companyId ? (
            <Group title="Rules">
              <StopRuleToggle companyId={db.companyId} />
              <AutoShareToggle companyId={db.companyId} />
            </Group>
          ) : null}

          {db.companyId ? (
            <Group title="Alerts">
              <OwnerStopAlertsToggle companyId={db.companyId} bare />
              <OwnerCustomerMessages />
            </Group>
          ) : null}

          <Group title="Crews">
            <Row icon="users" title="Crews" subtitle="Build a crew once, then add the whole crew to a route" onPress={() => router.push('/snow/owner/crews' as any)} />
          </Group>

          <Group title="Records">
            <Row icon="activity" title="Activity log" subtitle="Everything that happened, by storm, route and person" onPress={() => router.push('/snow/owner/activity')} />
            <Row icon="clock" title="Snow hours" subtitle="Who clocked in this week, and fix a missed clock-out" onPress={() => router.push('/snow/owner/hours')} />
            <Row icon="users" title="Crews" subtitle="Build a crew once, then add the whole crew to a route" onPress={() => router.push('/snow/owner/crews' as any)} />
            <Row icon="send" title="Message customers" subtitle="Send a push notification and banner to customers" onPress={() => router.push('/snow/owner/message-customers')} />
            <Row icon="image" title="Our Work" subtitle="Show off your projects: posts, reels, story, highlights" onPress={() => router.push('/snow/owner/our-work' as any)} />
            <Row icon="inbox" title="Service requests" subtitle="People who asked for work from the app" onPress={() => router.push('/snow/owner/service-requests' as any)} />
            <Row icon="camera" title="Photo review" subtitle="See what customers were sent, and withdraw a photo if needed" onPress={() => router.push('/snow/owner/review')} />
          </Group>

          <Group title="Storms">
            <Row icon="trash-2" title="Manage storms" subtitle="Name a storm: this is the title on your dashboard" onPress={() => router.push('/snow/owner/manage-storms' as any)} />
          </Group>

          <Group title="You">
            <ProfileCard onPress={() => router.push('/snow/owner/edit-profile' as any)} />
            {mode.canSwitch ? <Row icon={mode.icon} title={mode.title} subtitle={mode.subtitle} onPress={mode.confirm} /> : null}
            {weatherRow.canChange ? <Row icon="cloud" title={`${weatherRow.title}: ${weatherRow.value}`} subtitle={weatherRow.subtitle} onPress={weatherRow.confirm} /> : null}
            {weatherRow.canChange ? <Row icon="cloud-snow" title="Storm outlook" subtitle="Write a storm update for everyone to read" onPress={() => router.push('/snow/owner/storm-outlook' as any)} /> : null}
          </Group>

          <Group title="Account">
            <Row icon="shield" title="Legal & Support" subtitle="Privacy Policy, Terms of Use and Help" onPress={() => router.push('/snow/legal-support' as any)} />
            <Row icon="log-out" title="Sign Out" destructive onPress={guardedSignOut} />
          </Group>
          <ListSection>
            <DeleteAccountRow />
          </ListSection>
          <LanguageRow />
        </View>
      </ScrollView>
    </View>
  );
}

/** Your name, email and photo. Tapping it is the one way to the profile screen. */
function ProfileCard({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Edit your profile and photo"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <Avatar firstName={user?.firstName ?? ''} lastName={user?.lastName ?? ''} size={48} uri={user?.avatarUrl} />
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{user?.firstName} {user?.lastName}</Text>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>{user?.email}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

/** A small heading and one white card holding related rows, with thin dividers between them. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      <Text style={[typeScale.overline, styles.groupTitle, { color: colors.textSecondary }]} accessibilityRole="header">{title.toUpperCase()}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {rows.map((r, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
            {r}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

function Row({ icon, title, subtitle, onPress, destructive, compact, single }: {
  icon: IconName; title: string; subtitle?: string; onPress: () => void; destructive?: boolean; compact?: boolean; single?: boolean;
}) {
  const { colors } = useTheme();
  const tint = destructive ? colors.error : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => [styles.row, compact && styles.rowCompact, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      {compact ? (
        <View style={[styles.iconCircle, { backgroundColor: colors.primarySurface }]}>
          <Icon name={icon} size={18} color={tint} />
        </View>
      ) : (
        <View style={styles.iconSlot}>
          <Icon name={icon} size={24} color={tint} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: destructive ? colors.error : colors.textPrimary, fontWeight: '700' }]}>{title}</Text>
        {subtitle ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 1 }]}>{subtitle}</Text> : null}
      </View>
      <Icon name="chevron-right" size={20} color={destructive ? colors.error : colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  group: { marginBottom: spacing.md },
  groupTitle: { marginLeft: spacing.xs, marginBottom: spacing.xs, letterSpacing: 0.6 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', shadowColor: '#0F2A44', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.lg + 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 52 },
  rowCompact: { paddingVertical: spacing.sm, minHeight: 48 },
  iconSlot: { width: 28, alignItems: 'center' },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
