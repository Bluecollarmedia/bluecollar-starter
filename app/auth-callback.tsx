/**
 * Where the email links (confirm your email, reset your password) land inside the app: brighton-lawn://auth-callback.
 * Reads the short-lived sign-in token from the link, signs the person in, then moves on: a reset goes to "Choose a new
 * password", a confirmation goes into the app. A bad or used link says so and offers Sign In. Public page, no redirects.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Button, LoadingSpinner } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { supabase } from '@/lib/supabase';
import { parseAuthLink } from '@/lib/authLink';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

export default function AuthCallbackScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const url = Linking.useURL();
  const handled = useRef<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!url || handled.current === url) return;
    handled.current = url;
    const link = parseAuthLink(url);
    if (link.kind === 'none') return;
    if (link.kind === 'error') { setMessage(link.message); return; }
    supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken }).then(({ error }) => {
      if (error) { setMessage('This link has expired or was already used. Go back to Sign In and ask for a new one.'); return; }
      // A reset needs the person to choose a new password first; anything else signs them in and the app routes them.
      router.replace(link.purpose === 'recovery' ? '/reset-password' : '/');
    });
  }, [url, router]);

  // The address can take a moment to arrive; if it never carries a token, say so instead of spinning forever.
  useEffect(() => {
    const t = setTimeout(() => { if (!handled.current || parseAuthLink(handled.current).kind === 'none') setMessage('This link did not work. Go back to Sign In and try again.'); }, 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {message ? (
        <>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, textAlign: 'center' }]}>{message}</Text>
          <Button title="Go to Sign In" onPress={() => router.replace('/')} style={{ marginTop: spacing.lg }} />
        </>
      ) : (
        <>
          <LoadingSpinner />
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.md }]}>Opening the app...</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
