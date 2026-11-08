/**
 * The optional profile photo on every "create your account" screen: a round picture with a camera badge. Tapping it offers
 * Take Photo / Choose from Library / Remove. The picture is only kept on the screen until the account exists; the screen then
 * saves it with saveSignupPhoto (src/data/signupPhoto.ts).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Alert } from 'react-native';
import { Avatar } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { PICKER_AFTER_SHEET_MS, type ProfilePhotoSource } from '@/lib/profilePhoto';
import { useProfilePhoto } from '@/hooks/useProfilePhoto';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { useT } from '@/i18n';

interface Props {
  uri: string | null;
  onChange: (uri: string | null) => void;
  onError: (message: string) => void;
  firstName?: string;
  lastName?: string;
}

export function SignupPhotoPicker({ uri, onChange, onError, firstName, lastName }: Props) {
  const t = useT();
  const { colors } = useTheme();

  const photo = useProfilePhoto(onChange, onError);
  // The action sheet has to be gone before iOS will show the picker.
  const pick = (source: ProfilePhotoSource) => photo.pick(source, { afterSheetMs: PICKER_AFTER_SHEET_MS });

  function choose() {
    if (Platform.OS === 'web') { pick('library'); return; }
    Alert.alert(t('Profile photo'), undefined, [
      { text: t('Take Photo'), onPress: () => pick('camera') },
      { text: t('Choose from Library'), onPress: () => pick('library') },
      ...(uri ? [{ text: t('Remove Photo'), style: 'destructive' as const, onPress: () => onChange(null) }] : []),
      { text: t('Cancel'), style: 'cancel' as const },
    ]);
  }

  return (
    <Pressable
      onPress={choose}
      accessibilityRole="button"
      accessibilityLabel={uri ? t('Change profile photo') : t('Add a profile photo (optional)')}
      style={styles.wrap}
    >
      <View>
        <Avatar firstName={firstName?.trim() || ' '} lastName={lastName ?? ''} size={88} uri={uri ?? undefined} />
        <View style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
          <Icon name="camera" size={14} color="#FFFFFF" />
        </View>
      </View>
      <Text style={[typeScale.labelLarge, { color: colors.primary, marginTop: spacing.sm }]}>
        {uri ? t('Change photo') : t('Add a photo (optional)')}
      </Text>
      {photo.cropper}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  badge: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
