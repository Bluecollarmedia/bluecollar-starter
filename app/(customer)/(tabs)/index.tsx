import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { ScreenContainer } from '@/components/layout';
import { EmptyState } from '@/components/ui';
import { AnnouncementBanner } from '@/components/customer/AnnouncementBanner';
import { WeatherButton } from '@/components/weather/WeatherButton';
import { PropertyHome } from '@/components/customerHome/PropertyHome';
import { useCustomerHome } from '@/hooks/useCustomerHome';
import { emptyPortalText } from '@/lib/customerPortal';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

/**
 * The customer's home, one property at a time (see src/components/customerHome/PropertyHome.tsx): a chip per property, and inside a property
 * one tab each for Snow, Lawn and Project when it has more than one. Finished projects are tucked into "Past work".
 */
export default function CustomerHomeScreen() {
  const t = useT();
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const data = useCustomerHome();
  const empty = data.groups.length === 0 && data.past.length === 0;

  return (
    <ScreenContainer scrollable padded>
      <View style={{ paddingTop: insets.top + spacing.sm, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <WeatherButton to="/(customer)/weather" />
        <View style={{ flexShrink: 1 }}>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{t('Welcome Back')}</Text>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontWeight: '800' }]}>{user?.firstName ?? 'there'}</Text>
        </View>
      </View>

      <AnnouncementBanner />

      {empty ? (
        <EmptyState icon="layers" title={t(emptyPortalText().title)} description={t(emptyPortalText().description)} />
      ) : (
        <PropertyHome data={data} />
      )}
    </ScreenContainer>
  );
}
