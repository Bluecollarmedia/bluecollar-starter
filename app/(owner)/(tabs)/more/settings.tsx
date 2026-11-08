import { LanguageRow } from '@/components/ui/LanguageSwitch';
import { LegalSection } from '@/components/legal/LegalSection';
import { useGuardedSignOut } from '@/hooks/useGuardedSignOut';
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Avatar, GlassIconButton } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { DeleteAccountRow } from '@/components/account/DeleteAccountRow';
import { DeleteCompanyRow } from '@/components/account/DeleteCompanyRow';
import { usePublicWeatherRow } from '@/hooks/usePublicWeatherRow';
import { CustomerMessagePushRow } from '@/components/settings/CustomerMessagePushRow';
import { SettingsGroup, SettingsRow, PressScale, UsageBar, tileColors } from '@/components/settings/SettingsList';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useAuth } from '@/providers/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { AppState } from '@/providers/AuthProvider';
import { ListSection } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { db, useDb, updateRow } from '@/data/store';
import { documentDefaults } from '@/data/financials';
import { useCompanyYard } from '@/hooks/useCompanyYard';
import { useStorageInfo, useStorageLimit } from '@/hooks/useStorage';
import { formatAddress } from '@/lib/address';
import { formatBytes, storageLimitLabel } from '@/types/storage';
import type { UserRole } from '@/types';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance();
  const { user, signOut, switchDevRole, switchDevState, appState } = useAuth();
  const guardedSignOut = useGuardedSignOut();
  const weatherRow = usePublicWeatherRow();
  useDb();
  const company = db.company;
  const { yard } = useCompanyYard();
  const { info } = useStorageInfo();
  const { limitGb, limitBytes } = useStorageLimit();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const usedBytes = info?.usage.totalBytes ?? 0;
  const usedPercent = limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 100) : 0;
  const usageColor = usedPercent > 90 ? tileColors.red : usedPercent > 75 ? tileColors.orange : colors.primary;
  const companyAddress = [company?.address, company?.city, [company?.state, company?.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

  const docDefaults = documentDefaults();
  const docDefaultsSummary = [
    docDefaults.taxRate ? `${docDefaults.taxRate}% tax` : 'No tax',
    'terms, exclusions and payment instructions',
  ].join(' · ');

  const devStates: { label: string; state: AppState; role?: UserRole }[] = [
    { label: 'Owner', state: 'active', role: 'owner' },
    { label: 'Worker', state: 'active', role: 'worker' },
    { label: 'Customer', state: 'active', role: 'customer' },
    { label: 'Welcome', state: 'unauthenticated' },
  ];

  function handleDevSwitch(item: typeof devStates[0]) {
    if (item.role) {
      switchDevRole(item.role);
    } else {
      switchDevState(item.state);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Go back" />
      </View>

      <ScrollView bounces={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance + spacing.lg }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[typeScale.displaySmall, styles.title, { color: colors.textPrimary }]}>Settings</Text>

        <Pressable
          onPress={() => router.push('/(owner)/edit-profile' as any)}
          accessibilityRole="button"
          accessibilityLabel="Edit your profile and photo"
          style={[styles.hero, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
        >
          {user?.avatarUrl ? (
            <Avatar firstName={user?.firstName ?? 'O'} lastName={user?.lastName ?? ''} size={66} uri={user.avatarUrl} />
          ) : (
            <View style={[styles.heroInitials, { backgroundColor: colors.primary }]}>
              <Text style={[typeScale.headingLarge, { color: '#FFFFFF', fontWeight: '800' }]}>
                {`${(user?.firstName ?? 'O')[0] ?? ''}${(user?.lastName ?? '')[0] ?? ''}`.toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontWeight: '800' }]} numberOfLines={1}>
              {user?.firstName} {user?.lastName}
            </Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
              {user?.email ?? '—'}
            </Text>
            <View style={styles.heroChips}>
              <View style={[styles.heroChip, { backgroundColor: colors.border }]}>
                <Icon name="shield" size={13} color={colors.textPrimary} />
                <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>Owner</Text>
              </View>
              {!!company?.name && (
                <View style={[styles.heroChip, { backgroundColor: colors.border, flexShrink: 1 }]}>
                  <Icon name="briefcase" size={13} color={colors.textPrimary} />
                  <Text style={[typeScale.labelSmall, { color: colors.textPrimary, flexShrink: 1 }]} numberOfLines={1}>
                    {company.name}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <Icon name="chevron-right" size={20} color={colors.textSecondary} />
        </Pressable>

        <SettingsGroup title="Company">
          {!db.demo && (
            <SettingsRow
              icon="briefcase"
              tint={tileColors.green}
              title="Company Info & Header Photos"
              subtitle={[company?.phone, company?.email].filter(Boolean).join(' · ') || 'Name, phone, email, photos'}
              onPress={() => router.push({ pathname: '/(owner)/setup', params: { step: 'company' } } as any)}
            />
          )}
          {db.demo && (
            <SettingsRow icon="briefcase" tint={tileColors.green} title={company?.name ?? 'Company'} subtitle={companyAddress || undefined} />
          )}
          {!db.demo && !!companyAddress && (
            <SettingsRow icon="map-pin" tint={tileColors.pink} title="Office Address" subtitle={companyAddress} />
          )}
          <SettingsRow
            icon="navigation"
            tint={tileColors.blue}
            title="Yard Location"
            subtitle={yard ? formatAddress(yard) : 'Not set yet'}
            onPress={() => router.push('/(owner)/more/yard-location' as any)}
          />
          <SettingsRow
            icon="bell"
            tint={tileColors.orange}
            title="Yard & clock-in alerts"
            subtitle="Get an email when someone clocks in away from the yard"
            onPress={() => router.push('/(owner)/more/yard-alerts' as any)}
          />
          {!db.demo && (
            <SettingsRow
              icon="check-square"
              tint={tileColors.indigo}
              title="Recommended Setup"
              subtitle="Trucks, workers, pay rates and more"
              onPress={() => router.push('/(owner)/setup' as any)}
            />
          )}
        </SettingsGroup>

        {weatherRow.canChange ? (
          <SettingsGroup title="Brighton Weather" footer="When on, anyone who opens the app without signing in sees local weather first, with a Sign In button. Off keeps the usual welcome screen.">
            <SettingsRow icon="cloud" tint={tileColors.blue} title={weatherRow.title} subtitle={weatherRow.subtitle} value={weatherRow.value} onPress={weatherRow.confirm} />
          </SettingsGroup>
        ) : null}

        <SettingsGroup title="Crews" footer="Build a crew once, then add the whole crew to a job or route with one tap. A worker can be in more than one crew.">
          <SettingsRow icon="users" tint={tileColors.green} title="Crews" subtitle="Make and edit your crews" onPress={() => router.push('/(owner)/crews' as any)} />
        </SettingsGroup>

        <SettingsGroup title="Project Tasks" footer="By default anyone assigned to a project can check off its tasks. Choose Task Lead only to limit it to the lead you pick on each project.">
          <SettingsRow
            icon="check-square"
            tint={tileColors.green}
            title="Check off tasks"
            subtitle="Tap to change"
            value={db.company?.taskLeadOnly ? 'Task Lead' : 'Anyone'}
            onPress={() => { if (db.company) updateRow('companies', db.company.id, { taskLeadOnly: !db.company.taskLeadOnly }); }}
          />
        </SettingsGroup>

        <SettingsGroup title="Quotes & Invoices">
          <SettingsRow
            icon="file-text"
            tint={tileColors.orange}
            title="Document Defaults"
            subtitle={docDefaultsSummary}
            onPress={() => router.push('/(owner)/more/document-defaults' as any)}
          />
        </SettingsGroup>

        <SettingsGroup title="Storage">
          <SettingsRow
            icon="hard-drive"
            tint={tileColors.teal}
            title="Storage"
            onPress={() => router.push('/(owner)/more/storage' as any)}
          >
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 1, marginBottom: spacing.xs + 2 }]}>
              {limitBytes > 0
                ? `${formatBytes(usedBytes)} of ${storageLimitLabel(limitGb)} used`
                : `${formatBytes(usedBytes)} used`}
            </Text>
            <UsageBar percent={limitBytes > 0 ? usedPercent : 0} color={usageColor} />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Notifications" footer="Turning this off only stops the phone alert. Customer messages still appear in your notification center and on the bell.">
          <CustomerMessagePushRow />
        </SettingsGroup>

        <SettingsGroup title="App">
          <SettingsRow icon="info" tint={tileColors.gray} title="Version" value="1.0.0" />
          <SettingsRow
            icon="database"
            tint={tileColors.gray}
            title="Backend"
            subtitle={isSupabaseConfigured ? 'Supabase (live data)' : 'Mock data (Supabase not configured)'}
          />
        </SettingsGroup>

        {!isSupabaseConfigured && (
          <SettingsGroup title="Dev Tools" footer="Switch between roles and states for testing — hidden once the app is connected to a real backend">
            {devStates.map((item) => {
              const isActive =
                (item.role && appState === 'active' && user?.role === item.role) ||
                (!item.role && appState === item.state);
              return (
                <SettingsRow
                  key={item.label}
                  title={item.label}
                  selected={!!isActive}
                  onPress={() => handleDevSwitch(item)}
                />
              );
            })}
          </SettingsGroup>
        )}

        <LegalSection />

        <SettingsGroup>
          <SettingsRow icon="log-out" title="Sign Out" destructive onPress={guardedSignOut} />
        </SettingsGroup>
        <ListSection>
          <DeleteCompanyRow />
          <DeleteAccountRow />
        </ListSection>
        <LanguageRow />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { marginBottom: spacing.lg, marginLeft: spacing.xs },
  scrollContent: { paddingHorizontal: spacing.lg },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.xl,
  },
  heroInitials: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center' },
  heroChips: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
});
