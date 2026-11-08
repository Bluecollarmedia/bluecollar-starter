/**
 * Add insurance for a truck: choose the file (a PDF from Files, or take / choose a photo), give it a title and, optionally, the date it
 * runs out. Used on the truck's page (uploads right away) and when adding a new truck (the pick is kept and uploaded once the truck
 * is saved). Other records (maintenance, repairs, registration ...) use TruckRecordSheet.
 */
import { useKeepDraft } from '@/hooks/useKeepDraft';
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Platform, Alert, ActivityIndicator, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { Icon } from '@/components/ui/Icon';
import { Button, Input, DateField } from '@/components/ui';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useTheme } from '@/providers/ThemeProvider';
import { pickImage } from '@/lib/pickImage';
import { formatSize, isAllowedDocument, suggestedTitle, typeFromName, type DocKind } from '@/lib/truckDocs';
import type { DocumentInput } from '@/data/truckFiles';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Return an error sentence to show, or null when it worked (the sheet then closes). */
  onSubmit: (input: DocumentInput) => Promise<string | null>;
}

interface Picked { uri: string; name: string; mimeType: string; size?: number }

export function TruckDocumentSheet({ visible, onClose, onSubmit }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const kind: DocKind = 'insurance';
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Swipe it away and open it again: what you typed is still there (until it is sent or you leave the page).
  const markSaved = useKeepDraft(visible, 'truck-doc', () => { setTitle(''); setTitleTouched(false); setExpiresOn(''); setFile(null); setBusy(false); setError(null); });

  function take(p: Picked) {
    setFile(p);
    setError(null);
    if (!titleTouched) setTitle(suggestedTitle(kind, p.name));
  }

  async function chooseFile() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const mimeType = a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : typeFromName(a.name) ?? 'application/pdf';
      if (!isAllowedDocument(mimeType, a.name)) { setError('Choose a PDF or a photo (JPEG, PNG, HEIC).'); return; }
      take({ uri: a.uri, name: a.name, mimeType, size: a.size });
    } catch (e) {
      setError(`Couldn't open your files. ${e instanceof Error ? e.message : ''}`.trim());
    }
  }

  async function fromPhoto(source: 'camera' | 'library') {
    const res = await pickImage(source, { afterSheetMs: 0 });
    if (res.status === 'error') { setError(res.message); return; }
    if (res.status !== 'picked') return;
    take({ uri: res.uri, name: res.fileName ?? 'photo.jpg', mimeType: res.mimeType ?? 'image/jpeg', size: res.size });
  }

  function choosePhoto() {
    if (Platform.OS === 'web') { fromPhoto('library'); return; }
    Alert.alert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: () => setTimeout(() => fromPhoto('camera'), 450) },
      { text: 'Choose from Library', onPress: () => setTimeout(() => fromPhoto('library'), 450) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function submit() {
    if (!file) { setError('Choose a file first.'); return; }
    setBusy(true);
    setError(null);
    const err = await onSubmit({ kind, title: title.trim() || suggestedTitle(kind, file.name), uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size, expiresOn: expiresOn || undefined });
    setBusy(false);
    if (err) setError(err); else { markSaved(); Keyboard.dismiss(); onClose(); }
  }

  return (
    <BottomSheetModal visible={visible} onRequestClose={busy ? () => {} : onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: colors.borderLight }]} />
          <View style={styles.head}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Add insurance</Text>
            <Pressable onPress={onClose} disabled={busy} hitSlop={10}><Text style={[typeScale.bodySmall, { color: colors.textSecondary, fontWeight: '600' }]}>Cancel</Text></Pressable>
          </View>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.sm }}>
            <View style={[styles.fileBox, { borderColor: file ? colors.primary : colors.border, backgroundColor: colors.backgroundSecondary }]}>
              {file ? (
                <View style={styles.fileRow}>
                  <Icon name={file.mimeType === 'application/pdf' ? 'file-text' : 'image'} size={22} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{file.name}</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{[file.mimeType === 'application/pdf' ? 'PDF' : 'Photo', formatSize(file.size)].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Pressable onPress={() => setFile(null)} hitSlop={10} accessibilityLabel="Remove the chosen file"><Icon name="x" size={18} color={colors.textTertiary} /></Pressable>
                </View>
              ) : (
                <View style={styles.pickRow}>
                  <Pressable onPress={chooseFile} accessibilityRole="button" style={[styles.pickBtn, { backgroundColor: colors.primarySurface }]}>
                    <Icon name="file-text" size={18} color={colors.primaryDark} />
                    <Text style={[typeScale.labelLarge, { color: colors.primaryDark }]}>Choose PDF or file</Text>
                  </Pressable>
                  <Pressable onPress={choosePhoto} accessibilityRole="button" style={[styles.pickBtn, { backgroundColor: colors.primarySurface }]}>
                    <Icon name="camera" size={18} color={colors.primaryDark} />
                    <Text style={[typeScale.labelLarge, { color: colors.primaryDark }]}>Add a photo</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Input label="Title" value={title} onChangeText={(t) => { setTitle(t); setTitleTouched(true); }} placeholder="For example: Insurance 2026" />
            <DateField label="Expires (optional)" value={expiresOn} onChange={setExpiresOn} onClear={() => setExpiresOn('')} placeholder="Select date" />

            {error ? <Text style={[typeScale.bodySmall, { color: colors.error }]}>{error}</Text> : null}
            <Button title={busy ? 'Uploading…' : 'Add Insurance'} icon="upload" onPress={submit} loading={busy} disabled={busy} fullWidth size="lg" />
            {busy ? <ActivityIndicator color={colors.primary} /> : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.full },
  fileBox: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.lg, padding: spacing.md },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pickRow: { flexDirection: 'row', gap: spacing.sm },
  pickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: radius.lg },
});
