import { LanguageRow } from '@/components/ui/LanguageSwitch';
import { LegalSection } from '@/components/legal/LegalSection';
import React from 'react';
import { View, Text, Linking, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { DeleteAccountRow } from '@/components/account/DeleteAccountRow';
import { useAuth } from '@/providers/AuthProvider';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ScreenContainer } from '@/components/layout';
import { Avatar, ListSection, ListRow } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { SnowNotifyChoices } from '@/components/snow/customer/SnowNotifyChoices';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { db, useDb } from '@/data/store';
import { formatAddress } from '@/lib/address';
import { useHasSnow } from '@/hooks/useHasSnow';
import { usePortfolioEnabled } from '@/hooks/usePortfolio';

export default function CustomerAccountScreen() {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const { user, signOut, switchDevRole } = useAuth();
  useDb();
  const hasSnow = useHasSnow();
  const workOn = usePortfolioEnabled();
  const insets = useSafeAreaInsets();

  return (
    <ScreenContainer scrollable padded variant="grouped">
      <View style={{ paddingTop: insets.top + spacing.md, marginBottom: spacing.xl }}>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Account')}</Text>
      </View>

      <ListSection>
        <Pressable
          onPress={() => router.push('/(customer)/edit-profile' as any)}
          accessibilityRole="button"
          accessibilityLabel={t('Edit your profile and photo')}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md }}
        >
          <Avatar firstName={user?.firstName ?? ''} lastName={user?.lastName ?? ''} size={52} uri={user?.avatarUrl} />
          <View style={{ marginLeft: spacing.md, flex: 1 }}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
              {user?.firstName} {user?.lastName}
            </Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
              {user?.email}
            </Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textTertiary} />
        </Pressable>
      </ListSection>

      {/* Snow and Maintenance updates open from their cards on Home (one way in each), so Account has no rows for them. Here are the customer's own Snow notification switches. */}
      {hasSnow ? <SnowNotifyChoices /> : null}

      {workOn ? (
        <ListSection title={t('Our Work')}>
          <ListRow
            icon="image"
            iconColor={colors.primary}
            title={t('Our Work')}
            subtitle={t('See the projects and reels we have done')}
            showChevron
            onPress={() => router.push('/(customer)/work' as any)}
          />
        </ListSection>
      ) : null}

      <ListSection title={t('Your Project Team')}>
        <ListRow
          icon="briefcase"
          title={db.company?.name ?? '—'}
          subtitle={db.company ? formatAddress({ address: db.company.address, city: db.company.city, state: db.company.state, zip: db.company.zip }) || undefined : undefined}
        />
        {db.company?.phone ? (
          <ListRow
            icon="phone"
            iconColor={colors.primary}
            title={t('Call')}
            value={db.company.phone}
            showChevron
            onPress={() => Linking.openURL(`tel:${db.company!.phone!.replace(/[^\d+]/g, '')}`)}
          />
        ) : null}
        {db.company?.email ? (
          <ListRow
            icon="mail"
            iconColor={colors.primary}
            title={t('Email')}
            value={db.company.email}
            showChevron
            onPress={() => Linking.openURL(`mailto:${db.company!.email}`)}
          />
        ) : null}
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
        <ListRow icon="log-out" iconColor={colors.error} title={t('Sign Out')} destructive onPress={signOut} />
        <DeleteAccountRow />
      </ListSection>
      <LanguageRow />
    </ScreenContainer>
  );
}
