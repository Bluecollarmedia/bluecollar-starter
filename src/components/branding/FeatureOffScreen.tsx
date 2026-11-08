/**
 * FeatureOffScreen — covers a screen whose feature is switched off in the settings file (src/config/brand.js, features).
 *
 * The buttons and menu rows for a switched-off feature are already hidden; this only shows when someone reaches the screen another way
 * (an old notification, a typed web address, a link). It says so plainly and offers a way out. Nothing is deleted.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useT } from '@/i18n';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { spacing } from '@/theme/spacing';
import type { FeatureName } from '@/config/brand';

export const FEATURE_OFF_TITLE = 'Not available';
export const FEATURE_OFF_TEXT = 'This part of the app is not turned on.';

export function FeatureOffScreen({ feature }: { feature: FeatureName }) {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, signOut } = useAuth();
  // With the customer area off, a customer has nowhere else to go: offer Sign Out instead of a way home that leads back here.
  const onlySignOut = feature === 'customerPortal' && isAuthenticated;
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityViewIsModal
    >
      <EmptyState
        icon="slash"
        title={t(FEATURE_OFF_TITLE)}
        description={t(FEATURE_OFF_TEXT)}
        actionTitle={onlySignOut ? t('Sign Out') : t('Go to home')}
        onAction={() => {
          if (onlySignOut) void signOut();
          else router.replace('/');
        }}
      />
      {!onlySignOut && router.canGoBack() ? (
        <Button title={t('Go back')} variant="secondary" onPress={() => router.back()} style={{ marginTop: spacing.sm }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, zIndex: 1000 },
});
