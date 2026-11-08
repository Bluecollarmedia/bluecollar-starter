/**
 * "Report a problem" form for a worker standing at a property: pick what kind
 * of problem, add photos, optionally type a note, send. Reached from a
 * maintenance stop and from a regular job.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, Image, StyleSheet, Platform, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { keepPicked } from '@/lib/keepPickedFile';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassIconButton, Icon, InlineNotice, PressableScale } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { ISSUE_TYPES, placeNameFor, reportIssue, type IssueType, type IssueWhere } from '@/data/issues';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';

export function ReportIssueScreen() {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ maintenancePropertyId?: string; projectId?: string }>();
  const where: IssueWhere | null = params.maintenancePropertyId
    ? { maintenancePropertyId: params.maintenancePropertyId }
    : params.projectId ? { projectId: params.projectId } : null;

  const [type, setType] = useState<IssueType | null>(null);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function addPhoto() {
    if (Platform.OS === 'web') return pick('library');
    Alert.alert(t('Add Photo'), undefined, [
      { text: t('Take Photo'), onPress: () => pick('camera') },
      { text: t('Choose from Library'), onPress: () => pick('library') },
      { text: t('Cancel'), style: 'cancel' },
    ]);
  }

  async function pick(source: 'camera' | 'library') {
    if (Platform.OS !== 'web') {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('Permission needed'), t('Turn it on for Brighton Lawn in the Settings app to add photos.'));
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsMultipleSelection: source === 'library', selectionLimit: 6 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled) {
      const kept = await Promise.all(result.assets.map((a) => keepPicked(a.uri)));
      setPhotos((cur) => [...cur, ...kept].slice(0, 8));
    }
  }

  async function send() {
    if (!where || !type) return;
    setBusy(true);
    setError('');
    const res = await reportIssue({ where, type, notes, photoUris: photos });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    haptics.success();
    if (Platform.OS === 'web') router.back();
    else Alert.alert(t('Sent'), t('The office has been told.'), [{ text: t('OK'), onPress: () => router.back() }]);
  }

  if (!where) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg }]}>
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel={t('Back')} />
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.xl }]}>{t('Open this from a property or job.')}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: 140 }}
      >
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel={t('Back')} />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>{t('Report a Problem')}</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: 2 }]}>{placeNameFor(where)}</Text>

        <Text style={[typeScale.overline, { color: colors.textSecondary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>{t('WHAT HAPPENED?')}</Text>
        <View style={styles.chips}>
          {ISSUE_TYPES.map((it) => {
            const on = type === it.key;
            return (
              <PressableScale
                key={it.key}
                onPress={() => setType(it.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? colors.primary : colors.backgroundTertiary }]}
              >
                <Icon name={it.icon as any} size={16} color={on ? '#FFFFFF' : colors.textPrimary} />
                <Text style={[typeScale.labelLarge, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '600' }]}>{t(it.label)}</Text>
              </PressableScale>
            );
          })}
        </View>

        <Text style={[typeScale.overline, { color: colors.textSecondary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>{t('PHOTOS')}</Text>
        <View style={styles.photos}>
          {photos.map((uri) => (
            <View key={uri} style={styles.photoWrap}>
              <Image source={{ uri }} style={styles.photo} />
              <PressableScale
                onPress={() => setPhotos((cur) => cur.filter((u) => u !== uri))}
                accessibilityRole="button"
                accessibilityLabel={t('Remove photo')}
                style={styles.remove}
              >
                <Icon name="x" size={14} color="#FFFFFF" />
              </PressableScale>
            </View>
          ))}
          {photos.length < 8 && (
            <PressableScale
              onPress={addPhoto}
              accessibilityRole="button"
              accessibilityLabel={t('Add photo')}
              style={[styles.photo, styles.add, { borderColor: colors.border }]}
            >
              <Icon name="camera" size={22} color={colors.textSecondary} />
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{t('Add photo')}</Text>
            </PressableScale>
          )}
        </View>

        <Text style={[typeScale.overline, { color: colors.textSecondary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>{t('NOTES (OPTIONAL)')}</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder={t('Anything the office should know')}
          placeholderTextColor={colors.textTertiary}
          multiline
          style={[styles.input, typeScale.bodyLarge, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
        />
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, spacing.md), backgroundColor: colors.background, borderTopColor: colors.borderLight }]}>
        {!!error && <InlineNotice icon="alert-triangle" tone="error" text={error} style={{ marginBottom: spacing.sm }} />}
        <PressableScale
          onPress={send}
          disabled={!type || busy}
          haptic={false}
          accessibilityRole="button"
          accessibilityLabel={t('Send report')}
          style={[styles.send, { backgroundColor: colors.primary, opacity: !type || busy ? 0.5 : 1 }]}
        >
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Icon name="send" size={18} color="#FFFFFF" />}
          <Text style={[typeScale.labelLarge, { color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.6 }]}>{busy ? t('SENDING…') : t('SEND REPORT')}</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 40, borderRadius: radius.full },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoWrap: { position: 'relative' },
  photo: { width: 92, height: 92, borderRadius: radius.md },
  add: { alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1.5, borderStyle: 'dashed' },
  remove: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 110, borderRadius: radius.md, borderWidth: 1, padding: spacing.md, textAlignVertical: 'top' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  send: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 56, borderRadius: radius.full },
});
