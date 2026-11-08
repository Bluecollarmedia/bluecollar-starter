/**
 * Public page: .../reset-password. The reset email links here. The link signs the person in just long enough to
 * choose a new password (Supabase puts the short-lived token in the address). No app sign-in needed to open it.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, Input } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { supabase } from '@/lib/supabase';
import { setNewPassword } from '@/data/passwordReset';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { BUSINESS } from '@/legal/legalContent';

type Phase = 'checking' | 'ready' | 'expired' | 'done';

export default function ResetPasswordScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (live && session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) setPhase('ready');
    });
    // The link is read from the address a moment after the page opens; give it a short time before calling it expired.
    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (live) setPhase((p) => (p === 'checking' ? (data.session ? 'ready' : 'expired') : p));
    }, 1800);
    return () => { live = false; clearTimeout(timer); sub.subscription.unsubscribe(); };
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    const res = await setNewPassword(password, confirm);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    await supabase.auth.signOut();
    setPhase('done');
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing['3xl'], paddingBottom: insets.bottom + spacing['3xl'] }]} keyboardShouldPersistTaps="handled">
        <Text style={[typeScale.overline, { color: colors.textTertiary }]}>{BUSINESS.appName.toUpperCase()}</Text>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.xs }]}>Choose a new password</Text>

        {phase === 'checking' ? (
          <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.lg }]}>Checking your link...</Text>
        ) : null}

        {phase === 'expired' ? (
          <View style={[styles.notice, { backgroundColor: semantic.errorLight, marginTop: spacing.lg }]}>
            <Icon name="alert-circle" size={18} color={semantic.error} />
            <Text style={[typeScale.bodyMedium, { color: semantic.error, flex: 1, marginLeft: spacing.sm }]}>
              This link has expired or was already used. In the app, tap Forgot password on the Sign In screen to get a new one.
              {Platform.OS === 'web' ? '' : ' '}Need help? {BUSINESS.email} or {BUSINESS.phone}.
            </Text>
          </View>
        ) : null}

        {phase === 'ready' ? (
          <View style={{ gap: spacing.lg, marginTop: spacing.lg }}>
            {error ? (
              <View style={[styles.notice, { backgroundColor: semantic.errorLight }]}>
                <Icon name="alert-circle" size={16} color={semantic.error} />
                <Text style={[typeScale.bodySmall, { color: semantic.error, flex: 1, marginLeft: spacing.sm }]}>{error}</Text>
              </View>
            ) : null}
            <Input label="New password" placeholder="At least 8 characters" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" autoComplete="new-password" autoCapitalize="none" autoCorrect={false} icon="lock" />
            <Input label="Type it again" placeholder="Repeat the new password" value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" autoComplete="new-password" autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={save} icon="lock" />
            <Button title="Save new password" onPress={save} loading={busy} fullWidth size="lg" />
          </View>
        ) : null}

        {phase === 'done' ? (
          <View style={[styles.notice, { backgroundColor: colors.primarySurface, marginTop: spacing.lg }]}>
            <Icon name="check-circle" size={18} color={colors.primary} />
            <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1, marginLeft: spacing.sm }]}>
              {Platform.OS === 'web' ? `Your password was changed. Open the ${BUSINESS.appName} app and sign in with your new password.` : 'Your password was changed. Sign in with your new password.'}
            </Text>
          </View>
        ) : null}
        {phase === 'done' && Platform.OS !== 'web' ? (
          <Button title="Go to Sign In" onPress={() => router.replace('/')} fullWidth size="lg" style={{ marginTop: spacing.lg }} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md },
});
