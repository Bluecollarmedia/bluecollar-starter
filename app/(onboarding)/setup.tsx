/**
 * Finish Setting Up
 *
 * Shown to someone who is signed in but isn't part of a company yet (for
 * example they created an account, or their invitation hasn't been sent).
 * Each option opens the same screen used before sign-in; those screens skip
 * the account step when the user is already signed in.
 */

import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Dimensions, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { DeleteAccountRow } from '@/components/account/DeleteAccountRow';
import { useCompanySlotOpen } from '@/hooks/useCompanySlot';
import { useAuth } from '@/providers/AuthProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { brand } from '@/theme/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LOGO_WIDTH = Math.min(SCREEN_WIDTH * 0.45, 200);

export default function SetupScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const canCreateCompany = useCompanySlotOpen();
  const insets = useSafeAreaInsets();
  const { user, signOut, refreshContext } = useAuth();
  const [checking, setChecking] = useState(false);

  async function handleCheckAgain() {
    setChecking(true);
    try {
      await refreshContext();
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.content, { paddingTop: insets.top + spacing['3xl'] }]}>
        <View style={styles.logoSection}>
          <Image
            source={require('../../assets/images/logo-full.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, textAlign: 'center' }]}>
          Finish setting up
        </Text>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing['2xl'] }]}>
          {user?.email ? `Signed in as ${user.email}. ` : ''}Your account isn't connected to a company yet.
        </Text>

        <View style={styles.actions}>
          {canCreateCompany && (
            <Pressable
              style={[styles.option, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
              onPress={() => router.push('/(auth)/create-company' as any)}
            >
              <Icon name="briefcase" size={20} color={brand.accent} />
              <View style={styles.optionText}>
                <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Create a Company</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>I run the business</Text>
              </View>
            </Pressable>
          )}

        </View>

        <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl }]}>
          Joining a team, or a customer? Open the private link your employer texted you. Ask them for a new one if it doesn't work.
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button title="Check Again" onPress={handleCheckAgain} loading={checking} variant="secondary" icon="refresh-cw" fullWidth />
        <Button title="Sign Out" onPress={signOut} variant="ghost" icon="log-out" fullWidth />
        <DeleteAccountRow />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: spacing['2xl'],
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_WIDTH * 0.45,
  },
  actions: {
    gap: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.xl,
    gap: spacing.md,
  },
  optionText: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
});
