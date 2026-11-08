import { LanguageRow } from '@/components/ui/LanguageSwitch';
import { useT } from '@/i18n';
import { LegalSection } from '@/components/legal/LegalSection';
import { useGuardedSignOut } from '@/hooks/useGuardedSignOut';
import { DeleteAccountRow } from '@/components/account/DeleteAccountRow';
import { ListSection } from '@/components/ui';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsList';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { db, useDb } from '@/data/store';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

/**
 * What a landscaping-only worker sees while the company is in Snow Mode.
 * Shows no snow information at all (they have no snow access); the app
 * returns to their landscaping screens as soon as the owner switches back.
 */
export default function SnowModeNoticeScreen() {
  const t = useT();
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const guardedSignOut = useGuardedSignOut();
  const insets = useSafeAreaInsets();
  useDb();

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground, paddingTop: insets.top, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: colors.primarySurface }]}>
          <Icon name="cloud-snow" size={34} color={colors.primary} />
        </View>
        <Text style={[typeScale.displaySmall, styles.center, { color: colors.textPrimary }]} accessibilityRole="header">
          {t('Snow Mode is on')}
        </Text>
        <Text style={[typeScale.bodyLarge, styles.center, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          {t('Your route shows up here when the owner puts you on one.')}
        </Text>
      </View>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <LegalSection />
        <SettingsGroup>
          <SettingsRow icon="log-out" title={t('Sign Out')} destructive onPress={guardedSignOut} />
        </SettingsGroup>
        <ListSection>
          <DeleteAccountRow />
        </ListSection>
        <LanguageRow />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  center: { textAlign: 'center' },
});
