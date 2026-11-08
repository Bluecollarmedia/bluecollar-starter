/**
 * Login Screen
 *
 * Clean, professional login with the full company logo.
 */

import React, { useState, useRef } from 'react';
import { View, Text, Image, TextInput, StyleSheet, Pressable, Dimensions, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useCompanySlotOpen } from '@/hooks/useCompanySlot';
import { isEmailNotConfirmed } from '@/data/emailCode';
import { ScreenContainer } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { startWelcome, cancelWelcome } from '@/lib/welcomeAnimation';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { useT } from '@/i18n';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LOGO_WIDTH = Math.min(SCREEN_WIDTH * 0.55, 240);

export default function LoginScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const router = useRouter();
  const canCreateCompany = useCompanySlotOpen();
  const t = useT();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordRef = useRef<TextInput>(null);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError(t('Please enter your email and password.'));
      return;
    }

    setError('');
    setLoading(true);
    // Close the keyboard now so it doesn't hang around (or pop back up) during the welcome animation.
    Keyboard.dismiss();
    passwordRef.current?.blur();

    startWelcome();
    try {
      await signIn(email.trim(), password);
    } catch (err: any) {
      cancelWelcome();
      if (isEmailNotConfirmed(err)) {
        router.push({ pathname: '/(auth)/verify-email', params: { email: email.trim(), from: 'login' } } as any);
        return;
      }
      setError(err?.message ?? t('Something went wrong. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer
      scrollable
      padded
      keyboardAvoiding
      contentStyle={{ ...styles.content, paddingTop: insets.top + spacing.lg }}
    >
      {/* Back to welcome, and the language switch (English by default) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* The app can open straight on this screen with nothing behind it; then Back goes to the welcome screen. */}
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))} style={styles.backRow}>
          <Icon name="arrow-left" size={20} color={colors.textSecondary} />
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{t('Back')}</Text>
        </Pressable>
        <LanguageSwitch />
      </View>

      {/* Logo */}
      <View style={styles.logoSection}>
        <Image
          source={require('../../assets/images/logo-full.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      {/* Welcome text */}
      <View style={styles.header}>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>
          {t('Welcome Back')}
        </Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {t('Sign in to your account')}
        </Text>
      </View>

      {/* Form */}
      <View style={styles.form}>
        {error ? (
          <View style={[styles.errorBanner, { backgroundColor: semantic.errorLight }]}>
            <Icon name="alert-circle" size={16} color={semantic.error} />
            <Text style={[typeScale.bodySmall, { color: semantic.error, flex: 1, marginLeft: spacing.sm }]}>{error}</Text>
          </View>
        ) : null}

        <Input
          label={t('Email')}
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          icon="mail"
        />

        <Input
          ref={passwordRef}
          label={t('Password')}
          placeholder={t('Enter your password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
          icon="lock"
        />

        <Pressable onPress={() => router.push('/(auth)/forgot-password' as any)} hitSlop={8} style={{ alignSelf: 'flex-end' }} accessibilityRole="button" accessibilityLabel={t('Forgot password?')}>
          <Text style={[typeScale.bodySmall, { color: colors.primaryOnWhite, fontWeight: '600' }]}>{t('Forgot password?')}</Text>
        </Pressable>

        <Button
          title={t('Sign In')}
          onPress={handleLogin}
          loading={loading}
          fullWidth
          size="lg"
        />

        {/* The app opens on this screen, so the owner needs the button here too. Gone once a company exists. */}
        {canCreateCompany && (
          <Button
            title={t('Create a Company')}
            onPress={() => router.push('/(auth)/create-company')}
            variant="secondary"
            icon="briefcase"
            fullWidth
            size="lg"
          />
        )}
      </View>

    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'center',
    paddingTop: spacing['3xl'],
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: spacing['3xl'],
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_WIDTH * 0.45,
  },
  header: {
    marginBottom: spacing['2xl'],
  },
  form: {
    gap: spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
  },
});
