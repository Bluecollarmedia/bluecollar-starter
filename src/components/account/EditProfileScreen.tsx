import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar, Button, Input, DateField } from '@/components/ui';
import { localDateKey } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { uploadImage } from '@/lib/media';
import { PICKER_AFTER_SHEET_MS, type ProfilePhotoSource } from '@/lib/profilePhoto';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import { loadMyBirthday, saveMyBirthday } from '@/data/birthday';
import { parseBirthday, birthdayProblem, birthdayInputText } from '@/lib/birthday';
import { WorkerExtrasFields } from '@/components/account/WorkerExtras';
import { loadMyDetails, saveMyHoodie, saveMyId, removeMyId } from '@/data/workerDetails';
import type { HoodieSize } from '@/lib/workerDetails';
import { useT } from '@/i18n';

interface EditProfileScreenProps {
  /** Workers must fill in every field (photo and phone included); owners only need a name. */
  requireAll?: boolean;
  backLabel?: string;
}

/** Edit your own name, phone and profile photo. Used by the worker and owner apps. */
export function EditProfileScreen({ requireAll = true, backLabel = 'Settings' }: EditProfileScreenProps) {
  const t = useT();
  const { colors } = useTheme();
  const { user, updateProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [triedSave, setTriedSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [birthday, setBirthday] = useState('');
  const [savedBirthday, setSavedBirthday] = useState('');
  useEffect(() => {
    if (!user) return;
    let live = true;
    loadMyBirthday(user.id).then((iso) => {
      if (!live) return;
      const text = birthdayInputText(iso);
      setSavedBirthday(text);
      setBirthday((cur) => cur || text);
    });
    return () => { live = false; };
  }, [user?.id]);

  // Hoodie size and ID photo (workers only). The ID is private: only this worker and the owner can see it.
  const [hoodie, setHoodie] = useState<HoodieSize | null>(null);
  const [savedHoodie, setSavedHoodie] = useState<HoodieSize | null>(null);
  const [savedIdKey, setSavedIdKey] = useState<string | null>(null);
  const [newIdUri, setNewIdUri] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState(false);
  useEffect(() => {
    if (!user || !requireAll) return;
    let live = true;
    loadMyDetails(user.id).then((d) => {
      if (!live) return;
      setSavedHoodie(d.hoodieSize);
      setHoodie((cur) => cur ?? d.hoodieSize);
      setSavedIdKey(d.idKey);
    });
    return () => { live = false; };
  }, [user?.id, requireAll]);

  const hasChanges = (requireAll && (hoodie !== savedHoodie || !!newIdUri || removeId)) || birthday.trim() !== savedBirthday || firstName !== user?.firstName || lastName !== user?.lastName || phone !== (user?.phone ?? '') || avatarUrl !== user?.avatarUrl;

  const todayKey = () => localDateKey(new Date());
  const phoneDigits = phone.replace(/\D/g, '').length;
  const errors = {
    photo: !requireAll || avatarUrl ? '' : t('Add a profile photo'),
    firstName: firstName.trim() ? '' : t('Enter your first name'),
    lastName: lastName.trim() ? '' : t('Enter your last name'),
    phone: phoneDigits >= 10 || (!requireAll && phoneDigits === 0) ? '' : t('Enter a 10-digit phone number'),
    birthday: t(birthdayProblem(birthday)),
  };
  const isValid = !Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (triedSave ? errors[key] || undefined : undefined);

  async function handleSave() {
    if (!user) return;
    setTriedSave(true);
    if (!isValid) return;
    setSaving(true);
    setSaveError(null);
    try {
      // A newly picked photo is a file on this phone; upload it so everyone sees it.
      let savedAvatarUrl = avatarUrl;
      if (avatarUrl && avatarUrl !== user.avatarUrl) {
        savedAvatarUrl = (await uploadImage(avatarUrl, `avatars/${user.id}`)).url;
      }
      let birthdayNote: string | null = null;
      if (birthday.trim() !== savedBirthday) {
        const res = await saveMyBirthday(user.id, parseBirthday(birthday));
        if (!res.ok) birthdayNote = res.error;
      }
      const extraNotes: string[] = [];
      if (requireAll) {
        if (hoodie !== savedHoodie) {
          const r = await saveMyHoodie(user.id, hoodie);
          if (r.ok) setSavedHoodie(hoodie); else extraNotes.push(r.error);
        }
        if (newIdUri) {
          const r = await saveMyId(user.id, newIdUri, savedIdKey);
          if (r.ok) { setNewIdUri(null); setRemoveId(false); } else extraNotes.push(r.error);
        } else if (removeId && savedIdKey) {
          const r = await removeMyId(user.id, savedIdKey);
          if (r.ok) { setSavedIdKey(null); setRemoveId(false); } else extraNotes.push(r.error);
        }
      }
      updateProfile({
        ...user,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        avatarUrl: savedAvatarUrl,
        updatedAt: new Date().toISOString(),
      });
      if (birthdayNote || extraNotes.length) {
        setSaveError([birthdayNote, ...extraNotes].filter(Boolean).join(' '));
        return;
      }
      router.back();
    } catch (err: any) {
      setSaveError(err?.message ?? t('Could not save your photo. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  const photo = useProfilePhoto(setAvatarUrl, setPermissionError);
  async function pickPhoto(source: ProfilePhotoSource) {
    setPhotoSheetOpen(false);
    // Wait for the sheet to be fully gone first: iOS won't show the picker while it is still closing.
    await photo.pick(source, { afterSheetMs: PICKER_AFTER_SHEET_MS });
  }
  const handleTakePhoto = () => pickPhoto('camera');
  const handleChooseFromGallery = () => pickPhoto('library');

  function handleRemovePhoto() {
    setPhotoSheetOpen(false);
    setAvatarUrl(undefined);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
          <Feather name="chevron-left" size={22} color={colors.textPrimary} />
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{t(backLabel)}</Text>
        </Pressable>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('Edit Profile')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.photoSection}>
          <Pressable style={styles.avatarWrap} onPress={() => setPhotoSheetOpen(true)}>
            <Avatar firstName={firstName} lastName={lastName} size={96} uri={avatarUrl} />
            <View style={[styles.cameraBadgeLarge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              <Feather name="camera" size={16} color="#FFFFFF" />
            </View>
          </Pressable>
          <Pressable onPress={() => setPhotoSheetOpen(true)}>
            <Text style={[typeScale.bodyMedium, { color: colors.primary, fontWeight: '600', marginTop: spacing.sm }]}>
              {avatarUrl ? t('Change Photo') : t('Add Photo')}
            </Text>
          </Pressable>
          {show('photo') ? (
            <Text style={[typeScale.caption, { color: colors.error, marginTop: spacing.xs }]}>{show('photo')}</Text>
          ) : null}
        </View>

        <View style={styles.fields}>
          <View style={styles.nameRow}>
            <Input
              label={t('First Name *')}
              value={firstName}
              onChangeText={setFirstName}
              placeholder={t('First name')}
              textContentType="givenName"
              autoComplete="given-name"
              error={show('firstName')}
              containerStyle={{ flex: 1, width: undefined }}
            />
            <Input
              label={t('Last Name *')}
              value={lastName}
              onChangeText={setLastName}
              placeholder={t('Last name')}
              textContentType="familyName"
              autoComplete="family-name"
              error={show('lastName')}
              containerStyle={{ flex: 1, width: undefined }}
            />
          </View>
          <Input
            label={requireAll ? t('Phone Number *') : t('Phone Number')}
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 555-0100"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            icon="phone"
            error={show('phone')}
          />
          <DateField
            label={t('Birthday (optional)')}
            icon="gift"
            value={parseBirthday(birthday) ?? ''}
            onChange={(k) => setBirthday(birthdayInputText(k))}
            onClear={() => setBirthday('')}
            maximumDate={todayKey()}
            initialPickerDate="1990-01-01"
            placeholder={t('Select your birthday')}
            error={show('birthday')}
            hint={t('Only you and your managers can see this.')}
          />
          <Input
            label={t('Email')}
            value={user?.email ?? ''}
            editable={false}
            icon="mail"
            hint={t("Your email is your login and can't be changed here.")}
          />
          {requireAll ? (
            <WorkerExtrasFields
              hoodie={hoodie}
              onHoodie={setHoodie}
              newIdUri={newIdUri}
              onNewIdUri={(u) => { setNewIdUri(u); if (u) setRemoveId(false); }}
              savedIdKey={removeId ? null : savedIdKey}
              onRemoveSaved={() => setRemoveId(true)}
              onError={setSaveError}
            />
          ) : null}
        </View>

        <Button
          title={t('Save Changes')}
          onPress={handleSave}
          disabled={!hasChanges || saving}
          loading={saving}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.xl }}
        />
        {saveError ? (
          <Text style={[typeScale.caption, { color: colors.error, marginTop: spacing.sm, textAlign: 'center' }]}>{saveError}</Text>
        ) : null}
      </KeyboardAwareScrollView>

      {photo.cropper}

      {/* Change Profile Photo sheet */}
      <BottomSheetModal visible={photoSheetOpen} onRequestClose={() => setPhotoSheetOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setPhotoSheetOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.borderLight }]} />
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md }]}>
              {t('Change Profile Photo')}
            </Text>
            <Pressable style={styles.sheetOption} onPress={handleTakePhoto}>
              <Feather name="camera" size={18} color={colors.textPrimary} />
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.md }]}>{t('Take Photo')}</Text>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
            <Pressable style={styles.sheetOption} onPress={handleChooseFromGallery}>
              <Feather name="image" size={18} color={colors.textPrimary} />
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.md }]}>{t('Choose from Gallery')}</Text>
            </Pressable>
            {avatarUrl && (
              <>
                <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
                <Pressable style={styles.sheetOption} onPress={handleRemovePhoto}>
                  <Feather name="trash-2" size={18} color={colors.error} />
                  <Text style={[typeScale.bodyLarge, { color: colors.error, marginLeft: spacing.md }]}>{t('Remove Current Photo')}</Text>
                </Pressable>
              </>
            )}
            <Pressable
              style={[styles.cancelButton, { backgroundColor: colors.backgroundSecondary }]}
              onPress={() => setPhotoSheetOpen(false)}
            >
              <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{t('Cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </BottomSheetModal>

      {/* Permission error */}
      <Modal visible={!!permissionError} transparent animationType="fade" onRequestClose={() => setPermissionError(null)}>
        <View style={styles.confirmBackdrop}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface }]}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center' }]}>{t("Couldn't add the photo")}</Text>
            <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}>
              {permissionError}
            </Text>
            <Pressable
              style={[styles.confirmButton, { backgroundColor: colors.primary, marginTop: spacing.lg, width: '100%' }]}
              onPress={() => setPermissionError(null)}
            >
              <Text style={[typeScale.labelLarge, { color: '#FFFFFF' }]}>{t('OK')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', width: 90 },
  content: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'] },
  photoSection: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl },
  avatarWrap: { position: 'relative' },
  cameraBadgeLarge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fields: { gap: spacing.md },
  nameRow: { flexDirection: 'row', gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  sheetOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  cancelButton: {
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  confirmBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  confirmCard: { width: '100%', maxWidth: 340, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center' },
  confirmButton: { height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
