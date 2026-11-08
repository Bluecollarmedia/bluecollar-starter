/**
 * Private invite page: …/invite/<token>
 *
 * The owner texts this one-time link to a worker or a customer. Opening it shows the sign-up for that one person, with the
 * name and phone the owner typed filled in (the person can correct their own name). Signing up uses the link up, in the same
 * database step that creates the login (supabase/updates/078_invite_links.sql, handle_new_user). Someone who already has an
 * account signs in first and the link is attached to that account (invite_accept).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Alert, Keyboard, Image as RNImage } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { useT, tr } from '@/i18n';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, Input, LoadingSpinner } from '@/components/ui';
import { DateField } from '@/components/ui/DateField';
import { TermsAgreement, TERMS_REQUIRED_MESSAGE } from '@/components/legal/TermsAgreement';
import { WorkerExtrasFields } from '@/components/account/WorkerExtras';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/media';
import { saveBirthdayForCurrentUser } from '@/data/birthday';
import { saveDetailsForCurrentUser } from '@/data/workerDetails';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import { stashPendingSignup } from '@/data/pendingSignup';
import { PICKER_AFTER_SHEET_MS, type ProfilePhotoSource } from '@/lib/profilePhoto';
import { parseBirthday, birthdayProblem, birthdayInputText } from '@/lib/birthday';
import { localDateKey } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import type { HoodieSize } from '@/lib/workerDetails';

interface Lookup {
  valid: boolean;
  reason?: 'invalid' | 'used' | 'expired';
  kind?: 'worker' | 'customer';
  companyName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

const REASON_TEXT: Record<string, string> = {
  invalid: 'This link isn’t valid. Ask your employer to send you a new one.',
  used: 'This link was already used. If you already set up your login, just sign in. Otherwise ask for a new link.',
  expired: 'This link expired. Ask your employer to send you a new one.',
};

async function lookupInvite(token: string): Promise<Lookup> {
  if (!isSupabaseConfigured) {
    // Demo mode (no database): any "demo…" link shows a sample worker invite so the page can be tried.
    return token.startsWith('demo')
      ? { valid: true, kind: 'worker', companyName: 'Brighton Lawn + Landscape', firstName: 'Gabriel', lastName: 'Rivera', phone: '(555) 555-0142' }
      : { valid: false, reason: 'invalid' };
  }
  const { data, error } = await supabase.rpc('invite_lookup', { p_token: token });
  if (error || !data) return { valid: false, reason: 'invalid' };
  const r = data as { valid: boolean; reason?: Lookup['reason']; kind?: Lookup['kind']; company_name?: string; first_name?: string; last_name?: string; phone?: string };
  return { valid: !!r.valid, reason: r.reason, kind: r.kind, companyName: r.company_name, firstName: r.first_name, lastName: r.last_name, phone: r.phone };
}

const say = (title: string, msg: string) => (Platform.OS === 'web' ? alert(`${title}\n\n${msg}`) : Alert.alert(title, msg));

export default function InviteScreen() {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { signUp, isAuthenticated, user, refreshContext } = useAuth();
  const signedIn = isSupabaseConfigured && isAuthenticated && !!user;

  const [info, setInfo] = useState<Lookup | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [birthday, setBirthday] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [hoodie, setHoodie] = useState<HoodieSize | null>(null);
  const [idUri, setIdUri] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const photo = useProfilePhoto(setPhotoUri, setError);
  // Same choices as every other sign-up photo: take one, choose one, or remove it. The sheet must be gone before iOS opens the picker.
  function choosePhoto() {
    const pick = (source: ProfilePhotoSource) => photo.pick(source, { afterSheetMs: PICKER_AFTER_SHEET_MS });
    if (Platform.OS === 'web') { pick('library'); return; }
    Alert.alert(t('Profile photo'), undefined, [
      { text: t('Take Photo'), onPress: () => pick('camera') },
      { text: t('Choose from Library'), onPress: () => pick('library') },
      ...(photoUri ? [{ text: t('Remove Photo'), style: 'destructive' as const, onPress: () => setPhotoUri(null) }] : []),
      { text: t('Cancel'), style: 'cancel' as const },
    ]);
  }

  useEffect(() => {
    let alive = true;
    lookupInvite(String(token ?? '')).then((r) => {
      if (!alive) return;
      setInfo(r);
      setFirstName(r.firstName ?? '');
      setLastName(r.lastName ?? '');
      setPhone(r.phone ?? '');
    });
    return () => { alive = false; };
  }, [token]);

  const isWorker = info?.kind !== 'customer';
  // A customer's name is whatever the owner typed: shown here, kept as it is. (A part the owner left empty can still be filled in.)
  const firstLocked = info?.kind === 'customer' && !!info?.firstName?.trim();
  const lastLocked = info?.kind === 'customer' && !!info?.lastName?.trim();

  async function goHome() {
    await refreshContext();
    router.replace('/' as any);
  }

  /** Someone who already has a login: attach this invite to that account. */
  async function handleAccept() {
    setError('');
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('invite_accept', { p_token: String(token) });
      if (e) throw e;
      const r = data as { success?: boolean; error?: string } | null;
      if (!r?.success) throw new Error(tr(REASON_TEXT[r?.error ?? 'invalid'] ?? 'This link can’t be used. Ask for a new one.'));
      await goHome();
    } catch (err: any) {
      setError(err?.message ?? tr('Something went wrong. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!agreed) { setError(TERMS_REQUIRED_MESSAGE); return; }
    if (!firstName.trim()) { setError(tr('Please enter your first name.')); return; }
    if (!email.trim() || !email.includes('@')) { setError(tr('Please enter a valid email address.')); return; }
    if (password.length < 6) { setError(tr('Password must be at least 6 characters.')); return; }
    if (password !== confirmPassword) { setError(tr('Passwords do not match.')); return; }
    if (isWorker) {
      if (!phone.trim()) { setError(tr('Please enter your phone number.')); return; }
      const bErr = birthdayProblem(birthday);
      if (bErr) { setError(`Birthday: ${bErr}`); return; }
    }
    setError('');
    Keyboard.dismiss();
    setLoading(true);

    if (!isSupabaseConfigured) {
      await new Promise((r) => setTimeout(r, 600));
      setLoading(false);
      say('Demo mode', 'This is a preview. With the live database this creates your login and opens the app.');
      return;
    }

    try {
      const result = await signUp(email.trim(), password, { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() }, { inviteToken: String(token) });
      if (result.needsEmailConfirmation) {
        // Not signed in yet, so none of the extras can be saved now: keep them on the phone and save them at first sign-in.
        await stashPendingSignup({ email: email.trim(), photoUri, birthdayIso: parseBirthday(birthday), hoodieSize: isWorker ? hoodie : null, idUri: isWorker ? idUri : null });
        const kept = photoUri || parseBirthday(birthday) || (isWorker && (hoodie || idUri));
        say('Check your email', `We sent a confirmation link to ${email.trim()}. Open it, then sign in. ${info?.companyName ?? 'Your employer'} is already expecting you.${kept ? ' Your photo and details are saved and will be added when you sign in.' : ''}`);
        router.replace('/(auth)/login');
        return;
      }
      const birthdayIso = parseBirthday(birthday);
      if (birthdayIso) await saveBirthdayForCurrentUser(birthdayIso);
      if (isWorker) {
        const note = await saveDetailsForCurrentUser({ hoodieSize: hoodie, idUri });
        if (note) say('Not saved', `You're in, but ${note} You can add your hoodie size and ID later by tapping your name in Settings.`);
      }
      if (photoUri) {
        try {
          const { data: ctx } = await supabase.rpc('get_my_context');
          const personId = (ctx as { person?: { id: string } } | null)?.person?.id;
          if (personId) {
            const { url } = await uploadImage(photoUri, `avatars/${personId}`);
            await supabase.from('people').update({ avatar_url: url }).eq('id', personId);
          }
        } catch (photoErr) {
          const why = photoErr instanceof Error ? photoErr.message : 'Unknown error';
          say(tr('Photo not saved'), tr("You're in, but your profile photo wasn't saved. {why} You can add it later by tapping your name in Settings.", { why }));
        }
      }
      await goHome();
    } catch (err: any) {
      setError(err?.message ?? tr('Something went wrong. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  if (!info) {
    return <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}><LoadingSpinner /></View>;
  }

  if (!info.valid) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Icon name="link-2" size={36} color={colors.textTertiary} />
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, marginTop: spacing.md, textAlign: 'center' }]}>{t("This link can't be used")}</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}>{t(REASON_TEXT[info.reason ?? 'invalid'])}</Text>
        <Button title={t('Sign In')} onPress={() => router.replace('/(auth)/login')} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* English | Español: someone can read this page in Spanish before they sign up. English is the default. */}
        <View style={{ alignItems: 'flex-end', marginBottom: spacing.md }}><LanguageSwitch /></View>
        <RNImage source={require('../../assets/images/logo-full.png')} style={styles.logo} resizeMode="contain" />
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, textAlign: 'center' }]}>
          {isWorker ? t('Join {company}', { company: info.companyName ?? '' }) : t('{company} invited you', { company: info.companyName ?? '' })}
        </Text>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.xl }]}>
          {isWorker ? t('Set up your login. Everything here is yours to fill in.') : t('Create your login to see your project.')}
        </Text>

        {error ? (
          <View style={[styles.banner, { backgroundColor: semantic.errorLight }]}>
            <Icon name="alert-circle" size={16} color={semantic.error} />
            <Text style={[typeScale.bodySmall, { color: semantic.error, flex: 1, marginLeft: spacing.sm }]}>{error}</Text>
          </View>
        ) : null}

        {signedIn ? (
          <View style={styles.form}>
            <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>
              {t("You're signed in as {email}. Add {company} to this account?", { email: user?.email ?? '', company: info.companyName ?? '' })}
            </Text>
            <Button title={t('Accept Invite')} onPress={handleAccept} loading={loading} fullWidth size="lg" icon="check" />
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.photoSection}>
                <Pressable
                  style={[styles.photoUpload, { borderColor: photoUri ? colors.primary : colors.border, backgroundColor: photoUri ? colors.primarySurface : colors.surface }]}
                  onPress={choosePhoto}
                  accessibilityRole="button"
                  accessibilityLabel={t('Add a profile photo')}
                >
                  {photoUri ? <Image source={{ uri: photoUri }} style={styles.photoImage} contentFit="cover" /> : <Icon name="camera" size={30} color={colors.textTertiary} />}
                </Pressable>
                <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>{t('Profile photo (optional)')}</Text>
              </View>

            <View style={styles.row}>
              <Input label={t('First Name *')} placeholder={t('First name')} value={firstName} onChangeText={setFirstName} editable={!firstLocked} containerStyle={{ flex: 1 }} />
              <Input label={t('Last Name')} placeholder={t('Last name')} value={lastName} onChangeText={setLastName} editable={!lastLocked} containerStyle={{ flex: 1 }} />
            </View>
            <Input label={isWorker ? t('Phone *') : t('Phone')} placeholder="(555) 555-0100" value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="phone" />
            <Input label={t('Email *')} placeholder="you@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" icon="mail" />
            <Input label={t('Password *')} placeholder={t('At least 6 characters')} value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" autoComplete="new-password" autoCapitalize="none" autoCorrect={false} icon="lock" />
            <Input label={t('Confirm Password *')} placeholder={t('Re-enter password')} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry textContentType="newPassword" autoComplete="new-password" autoCapitalize="none" autoCorrect={false} icon="lock" />

            {isWorker ? (
              <>
                <DateField label={t('Birthday (optional)')} icon="gift" placeholder={t('Select your birthday')} value={parseBirthday(birthday) ?? ''} onChange={(k) => setBirthday(birthdayInputText(k))} onClear={() => setBirthday('')} maximumDate={localDateKey(new Date())} initialPickerDate="1990-01-01" />
                <WorkerExtrasFields hoodie={hoodie} onHoodie={setHoodie} newIdUri={idUri} onNewIdUri={setIdUri} onError={setError} />
              </>
            ) : null}

            <TermsAgreement value={agreed} onChange={(v) => { setAgreed(v); if (v) setError(''); }} />
            <Button title={isWorker ? t('Create My Login') : t('Create Account')} onPress={handleSubmit} loading={loading} fullWidth size="lg" icon="arrow-right" />
            <Pressable onPress={() => router.push('/(auth)/login')} hitSlop={8}>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center' }]}>
                {t('Already have an account?')} <Text style={{ color: colors.primary, fontWeight: '600' }}>{t('Sign in first')}</Text>{t(', then open this link again.')}
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAwareScrollView>
      {photo.cropper}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'], maxWidth: 560, width: '100%', alignSelf: 'center' },
  logo: { width: 160, height: 72, alignSelf: 'center', marginBottom: spacing.lg },
  banner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.lg },
  form: { gap: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.sm },
  photoSection: { alignItems: 'center' },
  photoUpload: { width: 104, height: 104, borderRadius: 52, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoImage: { width: 100, height: 100, borderRadius: 50 },
});
