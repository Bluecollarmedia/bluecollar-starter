import React, { useState } from 'react';
import { View, Text, TextInput, Modal, Pressable, StyleSheet, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ListRow, Button } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { db } from '@/data/store';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useT } from '@/i18n';

const CONFIRM_WORD = 'DELETE';

/** "Delete Account" list row plus its confirmation sheet (type DELETE to confirm). */
export function DeleteAccountRow() {
  const t = useT();
  const { colors } = useTheme();
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const me = db.members.find((m) => m.personId === db.personId);
  // An owner can't erase their login while owning the company (the database
  // refuses too): they delete the company first, so nothing is left unmanaged.
  const isOwner = me?.role === 'owner';
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD && !isOwner;

  function close() {
    if (busy) return;
    setOpen(false);
    setTyped('');
    setError('');
  }

  async function handleDelete() {
    if (!ready) return;
    if (!isSupabaseConfigured) {
      const msg = t('Accounts can’t be deleted in demo mode.');
      if (Platform.OS === 'web') alert(msg); else Alert.alert(t('Demo mode'), msg);
      return;
    }
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('delete_my_account');
    if (rpcError) {
      setBusy(false);
      setError(rpcError.message);
      return;
    }
    setBusy(false);
    setOpen(false);
    await signOut();
  }

  return (
    <>
      <ListRow icon="trash-2" iconColor={colors.error} title={t('Delete Account')} destructive onPress={() => setOpen(true)} />

      <BottomSheetModal visible={open} onRequestClose={close}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.iconWrap, { backgroundColor: semantic.errorLight }]}>
              <Icon name="alert-triangle" size={24} color={semantic.error} />
            </View>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing.md }]}>
              {t('Delete your account?')}
            </Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm }]}>
              {t("Your login and contact details are erased and you're removed from the team. Your name stays on past records like hours and project history. This can't be undone.")}
            </Text>
            {isOwner && (
              <View style={[styles.warnBox, { backgroundColor: semantic.warningLight }]}>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                  {t('You own {name}. Delete the company first (More → Settings → Delete Company), then you can delete your account.', { name: db.company?.name ?? t('this company') })}
                </Text>
              </View>
            )}
            <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.xs }]}>
              {t('Type {word} to confirm', { word: CONFIRM_WORD })}
            </Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[typeScale.bodyLarge, styles.input, { color: colors.textPrimary, borderColor: ready ? semantic.error : colors.border }]}
            />
            {error ? (
              <Text style={[typeScale.caption, { color: semantic.error, marginTop: spacing.xs }]}>{error}</Text>
            ) : null}
            <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
              <Button title={t('Delete My Account')} onPress={handleDelete} variant="danger" fullWidth disabled={!ready} loading={busy} />
              <Button title={t('Cancel')} onPress={close} variant="ghost" fullWidth />
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </BottomSheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  // The dimmed backdrop comes from BottomSheetModal.
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  warnBox: { padding: spacing.md, borderRadius: radius.md, marginTop: spacing.md },
  input: { borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, letterSpacing: 2 },
});
