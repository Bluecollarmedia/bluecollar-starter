import { LanguageRow } from '@/components/ui/LanguageSwitch';
import { ClockRow } from '@/components/time/ClockRow';
import { LegalSection } from '@/components/legal/LegalSection';
import { useGuardedSignOut } from '@/hooks/useGuardedSignOut';
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/providers/ThemeProvider';
import { DeleteAccountRow } from '@/components/account/DeleteAccountRow';
import { useAuth } from '@/providers/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { Avatar, ListSection, ListRow } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { ScreenContainer } from '@/components/layout';
import type { NavAppPreference } from '@/types/worker';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useT } from '@/i18n';

const NAV_OPTIONS: { value: NavAppPreference; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { value: 'google_maps', label: 'Google Maps', icon: 'map' },
  { value: 'apple_maps', label: 'Apple Maps', icon: 'compass' },
  { value: 'waze', label: 'Waze', icon: 'navigation' },
  { value: 'default', label: 'System Default', icon: 'smartphone' },
];

export default function WorkerSettingsScreen() {
  const t = useT();
  const { colors } = useTheme();
  const { user, signOut, switchDevRole } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { settings, updateNavApp } = useWorkerContext();
  const [navSheetOpen, setNavSheetOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const guardedSignOut = useGuardedSignOut();

  const currentNavLabel = NAV_OPTIONS.find(o => o.value === settings.navApp)?.label ?? 'System Default';

  return (
    <ScreenContainer scrollable padded variant="grouped">
      <View style={{ paddingTop: insets.top + spacing.md, marginBottom: spacing.xl }}>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Settings')}</Text>
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: 2 }]}>
          {t('Manage your account and preferences')}
        </Text>
      </View>

      <Pressable
        style={[styles.profileCard, { backgroundColor: colors.surface }, shadow.sm]}
        onPress={() => router.push('/(worker)/edit-profile' as any)}
        accessibilityRole="button"
        accessibilityLabel={t('Edit your profile and photo')}
      >
        <View style={styles.profileRow}>
          <View style={styles.avatarWrap}>
            <Avatar firstName={user?.firstName ?? ''} lastName={user?.lastName ?? ''} size={56} uri={user?.avatarUrl} />
            <View style={[styles.cameraBadge, { backgroundColor: colors.primary, borderColor: colors.surface }]}>
              <Feather name="camera" size={11} color="#FFFFFF" />
            </View>
          </View>
          <View style={{ marginLeft: spacing.md, flex: 1 }}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
              {user?.firstName} {user?.lastName}
            </Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{user?.email}</Text>
            {user?.phone && (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{user.phone}</Text>
            )}
          </View>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </View>
      </Pressable>

      <ListSection title={t('Preferences')}>
        <ListRow
          icon="navigation"
          title={t('Maps App')}
          value={t(currentNavLabel)}
          showChevron
          onPress={() => setNavSheetOpen(true)}
        />
        <ListRow
          icon="bell"
          title={t('Notifications')}
          subtitle={t('Manage your notification preferences')}
          showChevron
          onPress={() => router.push('/(worker)/notifications' as any)}
        />
      </ListSection>

      <ClockRow />

      <ListSection title={t('Company')}>
        <ListRow
          icon="key"
          title={t('Company Resources')}
          subtitle={t('Codes and info shared with you')}
          showChevron
          onPress={() => router.push('/(worker)/my-resources' as any)}
        />
      </ListSection>

      <ListSection title={t('App')}>
        <ListRow title={t('Version')} value="1.0.0" />
      </ListSection>

      {!isSupabaseConfigured && (
        <ListSection title="Dev Tools" footer="Switch between roles for testing — hidden once the app is connected to a real backend">
          <ListRow
            icon="briefcase"
            title="Owner"
            selected={user?.role === 'owner'}
            onPress={() => switchDevRole('owner')}
          />
          <ListRow
            icon="tool"
            title="Worker"
            selected={user?.role === 'worker'}
            onPress={() => switchDevRole('worker')}
          />
          <ListRow
            icon="user"
            title="Customer"
            selected={user?.role === 'customer'}
            onPress={() => switchDevRole('customer')}
          />
        </ListSection>
      )}

      <LegalSection />

      <ListSection>
        <ListRow icon="log-out" iconColor={colors.error} title={t('Sign Out')} destructive onPress={() => setSignOutConfirmOpen(true)} />
        <DeleteAccountRow />
      </ListSection>
      <LanguageRow />

      {/* Navigation App selection sheet */}
      <BottomSheetModal visible={navSheetOpen} onRequestClose={() => setNavSheetOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setNavSheetOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.borderLight }]} />
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md }]}>
              {t('Maps App')}
            </Text>
            {NAV_OPTIONS.map(opt => (
              <Pressable
                key={opt.value}
                style={styles.sheetRow}
                onPress={() => { updateNavApp(opt.value); setNavSheetOpen(false); }}
              >
                <Feather name={opt.icon} size={18} color={colors.textSecondary} />
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1, marginLeft: spacing.md }]}>
                  {t(opt.label)}
                </Text>
                {settings.navApp === opt.value && <Feather name="check" size={18} color={colors.primary} />}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </BottomSheetModal>

      {/* Sign out confirmation */}
      <Modal visible={signOutConfirmOpen} transparent animationType="fade" onRequestClose={() => setSignOutConfirmOpen(false)}>
        <View style={styles.confirmBackdrop}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.confirmIcon, { backgroundColor: colors.errorLight }]}>
              <Feather name="log-out" size={22} color={colors.error} />
            </View>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: spacing.lg, textAlign: 'center' }]}>
              {t('Sign Out?')}
            </Text>
            <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}>
              {t('Are you sure you want to sign out of your account?')}
            </Text>
            <View style={{ marginTop: spacing.xl, gap: spacing.sm, width: '100%' }}>
              <Pressable onPress={() => { setSignOutConfirmOpen(false); guardedSignOut(); }}>
                <LinearGradient
                  colors={['#E1615D', '#C4453F']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.confirmButton}
                >
                  <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>{t('Sign Out')}</Text>
                </LinearGradient>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, { backgroundColor: colors.backgroundSecondary }]}
                onPress={() => setSignOutConfirmOpen(false)}
              >
                <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{t('Cancel')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  profileCard: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { position: 'relative' },
  cameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  confirmCard: { width: '100%', maxWidth: 340, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center' },
  confirmIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  confirmButton: {
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
