import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { ScreenContainer } from '@/components/layout';
import { EmptyState, Icon, IconTile } from '@/components/ui';
import { AnnouncementBanner } from '@/components/customer/AnnouncementBanner';
import { WeatherButton } from '@/components/weather/WeatherButton';
import { PropertyHome } from '@/components/customerHome/PropertyHome';
import { useCustomerHome } from '@/hooks/useCustomerHome';
import { emptyPortalText } from '@/lib/customerPortal';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

/**
 * The customer's home, one property at a time (see src/components/customerHome/PropertyHome.tsx): a chip per property, and the projects at
 * that property. Finished projects are tucked into "Past work". A "Request a service" card opens the request form, so a customer can ask for
 * new work from inside the app (whether or not the public visitor area is switched on).
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

      <RequestServiceCard />
    </ScreenContainer>
  );
}

/** Opens the "Request a service" form (app/(customer)/request.tsx). */
function RequestServiceCard() {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/(customer)/request' as never)}
      accessibilityRole="button"
      accessibilityLabel={t('Request a service')}
      style={({ pressed }) => [styles.requestCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }, shadow.sm, pressed && { opacity: 0.85 }]}
    >
      <IconTile name="clipboard" size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '800' }]}>{t('Request a service')}</Text>
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{t("Tell us what you need and we'll reach out.")}</Text>
      </View>
      <Icon name="chevron-right" size={18} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  requestCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing['2xl'],
    borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg,
  },
});
