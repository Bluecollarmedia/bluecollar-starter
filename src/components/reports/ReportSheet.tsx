import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, Linking, Alert, Platform } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { db } from '@/data/store';
import { submitReport } from '@/data/contentReports';
import { REPORT_REASONS, MAX_REPORT_DETAILS, type ReportContentType, type ReportReason } from '@/lib/contentReports';

export interface ReportTarget {
  projectId: string;
  type: ReportContentType;
  contentId: string;
  /** Project name, for the fallback email. */
  where?: string;
}

/** Pick a reason, add details, send. Used for messages and shared photos. */
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mailto, setMailto] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (target) { setReason(null); setDetails(''); setError(''); setMailto(null); setSent(false); setBusy(false); }
  }, [target]);

  async function send() {
    if (!target) return;
    setBusy(true);
    setError('');
    const res = await submitReport({ ...target, reason, details }, db.personId);
    setBusy(false);
    if (res.ok) { setSent(true); return; }
    setError(t(res.error));
    setMailto(res.mailto ?? null);
  }

  function emailInstead() {
    if (mailto) Linking.openURL(mailto).catch(() => {
      const msg = t('No email app is set up on this phone. You can email us from the Support page.');
      if (Platform.OS === 'web') alert(msg); else Alert.alert(t('Email not available'), msg);
    });
  }

  return (
    <BottomSheetModal visible={!!target} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: colors.borderLight }]} />
          {sent ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
              <Icon name="check-circle" size={32} color={colors.primary} />
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginTop: spacing.sm }]}>{t('Report sent')}</Text>
              <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs }]}>
                {t('Thank you. The company owner reviews reports within two business days.')}
              </Text>
              <Button title={t('Done')} onPress={onClose} fullWidth size="lg" style={{ marginTop: spacing.lg }} />
            </View>
          ) : (
            <>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center' }]}>
                {target ? (target.type === 'photo' ? t('Report this photo') : t('Report this message')) : t('Report this content')}
              </Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.md }]}>
                {t('What is wrong with it?')}
              </Text>
              {REPORT_REASONS.map((r) => (
                <Pressable
                  key={r.key}
                  onPress={() => setReason(r.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: reason === r.key }}
                  style={[styles.reason, { borderColor: reason === r.key ? colors.primary : colors.border, backgroundColor: reason === r.key ? colors.primarySurface : colors.surface }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{t(r.label)}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{t(r.hint)}</Text>
                  </View>
                  {reason === r.key ? <Icon name="check" size={18} color={colors.primary} /> : null}
                </Pressable>
              ))}
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder={t('Details (optional)')}
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={MAX_REPORT_DETAILS}
                style={[typeScale.bodyMedium, styles.details, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
              />
              {error ? <Text style={[typeScale.caption, { color: colors.error, marginTop: spacing.sm }]}>{error}</Text> : null}
              <Button title={t('Send report')} onPress={send} loading={busy} disabled={!reason} fullWidth size="lg" style={{ marginTop: spacing.md }} />
              {mailto ? (
                <Pressable onPress={emailInstead} style={{ alignSelf: 'center', marginTop: spacing.sm }} hitSlop={8}>
                  <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Email us instead')}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} style={{ alignSelf: 'center', marginTop: spacing.sm }} hitSlop={8}>
                <Text style={[typeScale.labelLarge, { color: colors.textSecondary }]}>{t('Cancel')}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  reason: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  details: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, minHeight: 72, marginTop: spacing.xs, textAlignVertical: 'top' },
});
