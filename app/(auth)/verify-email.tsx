/**
 * Confirm your email: type the code from the "Confirm your signup" email. Reached right after Create a Company (when Supabase
 * asks for confirmation) and from Sign In when the email isn't confirmed yet. A correct code signs the person in.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { ScreenContainer } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { verifyEmailCode, resendEmailCode } from '@/data/emailCode';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { useT } from '@/i18n';

const RESEND_WAIT_SECONDS = 60;

export default function VerifyEmailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const params = useLocalSearchParams<{ email?: string; from?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Right after sign-up an email has just gone out, so wait before offering another.
  const [wait, setWait] = useState(params.from === 'signup' ? RESEND_WAIT_SECONDS : 0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function handleVerify() {
    Keyboard.dismiss();
    if (!email.trim()) { setError(t('Enter your email.')); return; }
    setError('');
    setNotice('');
    setLoading(true);
    const res = await verifyEmailCode(email, code);
    setLoading(false);
    // Signed in now; the app moves on to the owner screens by itself.
    if (!res.ok) setError(t(res.error));
  }

  async function handleResend() {
    if (!email.trim()) { setError(t('Enter your email.')); return; }
    setError('');
    setNotice('');
    setSending(true);
    const res = await resendEmailCode(email);
    setSending(false);
    if (res.ok) {
      setNotice(t('A new code is on its way. Use the newest email.'));
      setWait(RESEND_WAIT_SECONDS);
    } else {
      setError(t(res.error));
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'));

  return (
    <ScreenContainer scrollable padded keyboardAvoiding contentStyle={{ ...styles.content, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={back} style={styles.backRow} accessibilityRole="button" accessibilityLabel={t('Back to sign in')}>
          <Icon name="arrow-left" size={20} color={colors.textSecondary} />
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{t('Back to sign in')}</Text>
        </Pressable>
        <LanguageSwitch />
      </View>

      <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Confirm your email')}</Text>
      <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing['2xl'] }]}>
        {params.from === 'login'
          ? t('Your email is not confirmed yet. Enter the code from the email we sent you, or send a new one.')
          : t('We sent a code to your email. Enter it here to finish setting up.')}
      </Text>

      <View style={{ gap: spacing.lg }}>
        {error ? (
          <View style={[styles.notice, { backgroundColor: semantic.errorLight }]}>
            <Icon name="alert-circle" size={16} color={semantic.error} />
            <Text style={[typeScale.bodySmall, { color: semantic.error, flex: 1, marginLeft: spacing.sm }]}>{error}</Text>
          </View>
        ) : null}
        {notice ? (
          <View style={[styles.notice, { backgroundColor: colors.primarySurface }]}>
            <Icon name="check-circle" size={16} color={colors.primaryOnWhite} />
            <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1, marginLeft: spacing.sm }]}>{notice}</Text>
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
          icon="mail"
        />
        <Input
          label={t('Code')}
          placeholder="123456"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={12}
          returnKeyType="done"
          onSubmitEditing={handleVerify}
          icon="hash"
        />
        <Button title={t('Confirm')} onPress={handleVerify} loading={loading} fullWidth size="lg" />
        <Button
          title={wait > 0 ? t('Send a new code in {n}s', { n: wait }) : t('Send a new code')}
          onPress={handleResend}
          loading={sending}
          disabled={wait > 0}
          variant="ghost"
          fullWidth
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', paddingTop: spacing['3xl'] },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl },
  notice: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md },
});
