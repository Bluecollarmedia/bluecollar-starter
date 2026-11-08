import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Button, Input, Card } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { inviteLinkUrl, inviteMessage, textInvite, copyText } from '@/lib/invite';
import { addWorker, sendInviteAgain, cancelInvite, usePendingInvites, type IssuedInvite } from '@/hooks/useInvites';
import { db, useDb } from '@/data/store';

interface Sent { who: string; phone: string; invite: IssuedInvite }

/**
 * Add a worker: a name and a phone number, nothing else. The worker gets a private link that works once (7 days). They set up
 * their own login from it: name, email, password, birthday, hoodie size, ID, photo. After that the owner decides what they work on.
 */
export default function AddWorkerScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { invites, reload } = usePendingInvites();
  useDb();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [copied, setCopied] = useState(false);

  const linkFor = (s: Sent) => inviteLinkUrl(s.invite.token);

  async function handleCreate() {
    setError('');
    setBusy(true);
    try {
      const invite = await addWorker({ firstName, lastName, phone });
      setSent({ who: `${firstName} ${lastName}`.trim(), phone, invite });
      setFirstName(''); setLastName(''); setPhone('');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the worker.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(s: Sent) {
    await copyText(linkFor(s));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleText(s: Sent) {
    await textInvite(inviteMessage(linkFor(s), db.company?.name, s.who, 'worker'), s.phone);
    if (Platform.OS === 'web') alert('Message copied. Paste it into a text to your worker.');
  }

  async function handleAgain(i: { personId: string; firstName: string; lastName: string; phone: string }) {
    setError('');
    try {
      const invite = await sendInviteAgain(i.personId);
      setSent({ who: `${i.firstName} ${i.lastName}`.trim(), phone: i.phone, invite });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make a new link.');
    }
  }

  async function handleCancel(id: string) {
    try { await cancelInvite(id); } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel the link.'); }
    reload();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>Add Worker</Text>
      </View>

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Card title="Who is joining?" style={styles.section}>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.md }]}>
            Just a name and a phone number. We make a private link that works once. They tap it, set up their login, and fill in the rest themselves.
          </Text>
          <View style={styles.form}>
            <View style={styles.row}>
              <Input label="First Name *" placeholder="Gabriel" value={firstName} onChangeText={setFirstName} containerStyle={{ flex: 1 }} />
              <Input label="Last Name" placeholder="Rivera" value={lastName} onChangeText={setLastName} containerStyle={{ flex: 1 }} />
            </View>
            <Input label="Phone *" placeholder="(555) 555-0100" value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="phone" />
            {error ? (
              <View style={[styles.note, { backgroundColor: semantic.errorLight, borderColor: semantic.error }]}>
                <Icon name="alert-circle" size={14} color={semantic.error} />
                <Text style={[typeScale.caption, { color: semantic.error, flex: 1, marginLeft: spacing.sm }]}>{error}</Text>
              </View>
            ) : null}
            <Button title="Create Private Link" onPress={handleCreate} loading={busy} icon="link" fullWidth disabled={!firstName.trim() || phone.replace(/\D/g, '').length < 7} />
          </View>
        </Card>

        {sent ? (
          <Card title={`Link for ${sent.who || 'your worker'}`} style={styles.section}>
            <View style={[styles.linkBox, { backgroundColor: colors.primarySurface }]}>
              <Text style={[typeScale.bodySmall, { color: colors.primary }]} selectable numberOfLines={2}>{linkFor(sent)}</Text>
            </View>
            <View style={styles.actions}>
              <Button title="Text Message" icon="message-circle" onPress={() => handleText(sent)} style={{ flex: 1 }} />
              <Button title={copied ? 'Copied!' : 'Copy Link'} icon={copied ? 'check' : 'copy'} variant="secondary" onPress={() => handleCopy(sent)} style={{ flex: 1 }} />
            </View>
            <View style={[styles.note, { backgroundColor: semantic.warningLight, borderColor: semantic.warning, marginTop: spacing.md }]}>
              <Icon name="info" size={14} color={semantic.warning} />
              <Text style={[typeScale.caption, { color: colors.textSecondary, flex: 1, marginLeft: spacing.sm }]}>
                The link works one time and expires in 7 days. We can't show it again later, but you can make a new one any time.
              </Text>
            </View>
          </Card>
        ) : null}

        {invites.length > 0 ? (
          <Card title="Waiting to join" style={styles.section}>
            {invites.map((i, idx) => (
              <View key={i.id} style={[styles.pendingRow, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{`${i.firstName} ${i.lastName}`.trim() || 'No name'}{i.kind === 'customer' ? ' (customer)' : ''}</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{i.phone || 'No phone'} · expires {new Date(i.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                </View>
                <Pressable onPress={() => handleAgain(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Send ${i.firstName} a new link`}>
                  <Text style={[typeScale.labelSmall, { color: colors.primary }]}>New link</Text>
                </Pressable>
                <Pressable onPress={() => handleCancel(i.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Cancel ${i.firstName}'s link`}>
                  <Text style={[typeScale.labelSmall, { color: semantic.error }]}>Cancel</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] },
  section: { marginBottom: spacing.lg },
  form: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  linkBox: { padding: spacing.md, borderRadius: radius.sm, marginBottom: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  note: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing.sm, borderRadius: radius.lg, borderLeftWidth: 3 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
});
