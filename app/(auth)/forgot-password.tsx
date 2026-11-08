/**
 * Forgot password: type your email, we send a link. The link opens a web page where you choose a new password.
 * Works only once Supabase email sending is set up; until then a polite message points to support.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { ScreenContainer } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { requestPasswordReset } from '@/data/passwordReset';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { useT } from '@/i18n';

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSend() {
    Keyboard.dismiss();
    setError('');
    setLoading(true);
    const res = await requestPasswordReset(email);
    setLoading(false);
    if (res.ok) setSent(true);
    else setError(res.error);
  }

  return (
    <ScreenContainer scrollable padded keyboardAvoiding contentStyle={{ ...styles.content, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => router.back()} style={styles.backRow} accessibilityRole="button" accessibilityLabel={t('Back to sign in')}>
          <Icon name="arrow-left" size={20} color={colors.textSecondary} />
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{t('Back to sign in')}</Text>
        </Pressable>
        <LanguageSwitch />
      </View>

      <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Forgot password?')}</Text>
      <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing['2xl'] }]}>
        {t('Enter the email you signed up with and we will send you a link to choose a new password.')}
      </Text>

      {sent ? (
        <View style={[styles.notice, { backgroundColor: colors.primarySurface }]}>
          <Icon name="check-circle" size={18} color={colors.primary} />
          <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1, marginLeft: spacing.sm }]}>
            {t('If there is an account for that email, a reset link is on its way. Open it on this phone, choose a new password, then come back and sign in.')}
          </Text>
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          {error ? (
            <View style={[styles.notice, { backgroundColor: semantic.errorLight }]}>
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
            returnKeyType="send"
            onSubmitEditing={handleSend}
            icon="mail"
          />
          <Button title={t('Send reset link')} onPress={handleSend} loading={loading} fullWidth size="lg" />
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', paddingTop: spacing['3xl'] },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl },
  notice: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md },
});
