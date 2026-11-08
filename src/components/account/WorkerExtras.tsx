import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { pickImage } from '@/lib/pickImage';
import { HOODIE_SIZES, ID_PRIVACY_TEXT, type HoodieSize } from '@/lib/workerDetails';
import { getIdViewUrl, loadHoodieSizes, loadIdKeys } from '@/data/workerDetails';
import { useT } from '@/i18n';
import { isFeatureOn, words } from '@/config/brand';
import { fixed, blackAlpha } from '@/theme/colors';

/** The optional clothing-size question (settings file: features.uniformSize; its name is wording.uniformSizeLabel). */
export const UNIFORM_SIZE_ON = isFeatureOn('uniformSize');
/** The optional private ID photo (settings file: features.workerIdPhoto). */
export const ID_PHOTO_ON = isFeatureOn('workerIdPhoto');
/** Either one is in this app, so the "extras" section is worth showing at all. */
export const WORKER_EXTRAS_ON = UNIFORM_SIZE_ON || ID_PHOTO_ON;

interface FieldsProps {
  hoodie: HoodieSize | null;
  onHoodie: (v: HoodieSize | null) => void;
  /** A photo just picked on this phone, not saved yet. */
  newIdUri: string | null;
  onNewIdUri: (uri: string | null) => void;
  /** The ID already on file (from Edit Profile), if any. */
  savedIdKey?: string | null;
  /** Called when the worker taps Remove on the saved ID. */
  onRemoveSaved?: () => void;
  onError: (message: string) => void;
}

/** Clothing size (saved in the hoodie_size column) and ID photo: used when joining a team and again in Edit Profile, so they can be added or changed later.
 *  Each part shows only while its switch is on in the settings file. */
export function WorkerExtrasFields({ hoodie, onHoodie, newIdUri, onNewIdUri, savedIdKey, onRemoveSaved, onError }: FieldsProps) {
  const t = useT();
  const { colors } = useTheme();
  const [viewing, setViewing] = useState(false);

  async function pick(source: 'camera' | 'library') {
    const r = await pickImage(source);
    if (r.status === 'picked') onNewIdUri(r.uri);
    else if (r.status === 'error') onError(r.message);
  }
  const hasId = !!newIdUri || !!savedIdKey;

  return (
    <View style={{ gap: spacing.lg }}>
      {UNIFORM_SIZE_ON ? (
      <View>
        <Text style={[typeScale.labelSmall, { color: colors.textPrimary, marginBottom: spacing.sm }]}>{t('{label} (optional)', { label: t(words.uniformSizeLabel) })}</Text>
        <View style={styles.chips}>
          {HOODIE_SIZES.map((s) => {
            const on = hoodie === s;
            return (
              <Pressable
                key={s}
                onPress={() => onHoodie(on ? null : s)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}
              >
                <Text style={[typeScale.labelSmall, { color: on ? colors.textOnPrimary : colors.textPrimary }]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      ) : null}

      {ID_PHOTO_ON ? (
      <View>
        <Text style={[typeScale.labelSmall, { color: colors.textPrimary, marginBottom: spacing.xs }]}>{t('ID (optional)')}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
          {t('A clear photo of your driver license or other ID.')} {t(ID_PRIVACY_TEXT)}
        </Text>
        {newIdUri ? (
          <Image source={{ uri: newIdUri }} style={[styles.preview, { borderColor: colors.border }]} contentFit="cover" />
        ) : savedIdKey ? (
          <View style={[styles.onFile, { backgroundColor: colors.primarySurface }]}>
            <Feather name="check-circle" size={16} color={colors.primaryOnWhite} />
            <Text style={[typeScale.bodySmall, { color: colors.primaryOnWhite, marginLeft: spacing.sm, flex: 1 }]}>{t('ID on file')}</Text>
            <Pressable onPress={() => setViewing(true)} hitSlop={8}>
              <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite }]}>{t('View')}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.btnRow}>
          <Pressable onPress={() => pick('camera')} style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Feather name="camera" size={16} color={colors.textPrimary} />
            <Text style={[typeScale.labelSmall, { color: colors.textPrimary, marginLeft: spacing.xs }]}>{hasId ? t('Retake') : t('Take Photo')}</Text>
          </Pressable>
          <Pressable onPress={() => pick('library')} style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Feather name="image" size={16} color={colors.textPrimary} />
            <Text style={[typeScale.labelSmall, { color: colors.textPrimary, marginLeft: spacing.xs }]}>{hasId ? t('Choose Another') : t('Choose Photo')}</Text>
          </Pressable>
        </View>
        {newIdUri ? (
          <Pressable onPress={() => onNewIdUri(null)} style={{ marginTop: spacing.sm }}>
            <Text style={[typeScale.caption, { color: colors.error }]}>{t('Do not use this photo')}</Text>
          </Pressable>
        ) : savedIdKey && onRemoveSaved ? (
          <Pressable onPress={onRemoveSaved} style={{ marginTop: spacing.sm }}>
            <Text style={[typeScale.caption, { color: colors.error }]}>{t('Remove my ID')}</Text>
          </Pressable>
        ) : null}
      </View>
      ) : null}
      {ID_PHOTO_ON && savedIdKey ? <IdViewerModal visible={viewing} idKey={savedIdKey} onClose={() => setViewing(false)} /> : null}
    </View>
  );
}

/** Shows an ID photo from a short-lived private link. Used by the worker on their own ID and by the owner. */
export function IdViewerModal({ visible, idKey, onClose }: { visible: boolean; idKey: string; onClose: () => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) { setUrl(null); setError(null); return; }
    let live = true;
    getIdViewUrl(idKey).then((r) => {
      if (!live) return;
      if (r.ok) setUrl(r.url); else setError(r.error);
    });
    return () => { live = false; };
  }, [visible, idKey]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable onPress={onClose} style={[styles.close, { top: insets.top + spacing.md }]} hitSlop={12} accessibilityLabel={t('Close')}>
          <Feather name="x" size={26} color={fixed.white} />
        </Pressable>
        {url ? (
          <Image source={{ uri: url }} style={styles.full} contentFit="contain" />
        ) : error ? (
          <Text style={[typeScale.bodyMedium, { color: fixed.white, textAlign: 'center', padding: spacing.xl }]}>{error}</Text>
        ) : (
          <ActivityIndicator color={fixed.white} />
        )}
        <Text style={[typeScale.caption, { color: fixed.viewerMuted, position: 'absolute', bottom: insets.bottom + spacing.lg }]}>
          {t('Private. Only the worker and the owner can see this.')}
        </Text>
      </View>
    </Modal>
  );
}

/** A "View ID" row for the owner's worker page and join-request cards. Renders nothing when there is no ID on file. */
export function ViewIdButton({ idKey }: { idKey: string | undefined }) {
  const t = useT();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (!idKey || !ID_PHOTO_ON) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.viewRow} accessibilityRole="button">
        <Feather name="credit-card" size={14} color={colors.primaryOnWhite} />
        <Text style={[typeScale.bodySmall, { color: colors.primaryOnWhite, marginLeft: spacing.xs, fontWeight: '600' }]}>{t('View ID (private)')}</Text>
      </Pressable>
      <IdViewerModal visible={open} idKey={idKey} onClose={() => setOpen(false)} />
    </>
  );
}

/** For the owner: a worker's clothing size and (owner only) a private View ID link. Shows nothing until one of them exists. */
export function OwnerWorkerExtras({ personId }: { personId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const [size, setSize] = useState<string | null>(null);
  const [idKey, setIdKey] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!WORKER_EXTRAS_ON) return;
    Promise.all([
      UNIFORM_SIZE_ON ? loadHoodieSizes([personId]) : Promise.resolve({} as Record<string, string>),
      ID_PHOTO_ON ? loadIdKeys([personId]) : Promise.resolve({} as Record<string, string>),
    ]).then(([h, k]) => {
      if (!live) return;
      setSize((h as Record<string, string | undefined>)[personId] ?? null);
      setIdKey((k as Record<string, string | undefined>)[personId]);
    });
    return () => { live = false; };
  }, [personId]);
  if (!size && !idKey) return null;
  return (
    <View>
      {size ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>{t('{label}: {size}', { label: t(words.uniformSizeLabel), size })}</Text> : null}
      <ViewIdButton idKey={idKey} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minWidth: 48, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: 180, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  onFile: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: blackAlpha(0.92), alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: spacing.lg, zIndex: 2 },
  full: { width: '100%', height: '80%' },
  viewRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
});
