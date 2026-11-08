/**
 * Owner: send one customer a private one-time link (supabase/updates/078_invite_links.sql). The customer taps it once, creates
 * their login, and their projects and properties are already on it. A customer who already has a login does not need a link.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Button } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { db, rowsOf, useDb } from '@/data/store';
import { sendInviteAgain, type IssuedInvite } from '@/hooks/useInvites';
import { inviteLinkUrl, inviteMessage, textInvite, copyText } from '@/lib/invite';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';

export function CustomerInviteCard({ personId, firstName, phone, autoMake }: { personId: string; firstName: string; phone?: string; /** Make the link as soon as this opens (right after the customer was added). */ autoMake?: boolean }) {
  const { colors } = useTheme();
  useDb();
  const [invite, setInvite] = useState<IssuedInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const hasLogin = !!rowsOf('people').find((p) => p.id === personId)?.userId;

  async function make() {
    setBusy(true);
    setError('');
    try { setInvite(await sendInviteAgain(personId)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not make a link.'); } finally { setBusy(false); }
  }

  const url = invite ? inviteLinkUrl(invite.token) : '';

  // Right after adding a customer the link is made for you, so the Text / Copy buttons are already there.
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoMake && !hasLogin && !autoDone.current) { autoDone.current = true; void make(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMake, hasLogin]);

  async function text() {
    await textInvite(inviteMessage(url, db.company?.name, firstName, 'customer'), phone);
    if (Platform.OS === 'web') alert('Message copied. Paste it into a text to your customer.');
  }

  async function copy() {
    await copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (hasLogin) {
    return (
      <View style={[styles.row, { backgroundColor: colors.primarySurface }]}>
        <Icon name="check-circle" size={16} color={colors.primary} />
        <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1, marginLeft: spacing.sm }]}>{firstName || 'This customer'} has a login.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
        {firstName || 'This customer'} hasn't set up a login yet. Send a private link: it works once and expires in 7 days.
      </Text>
      {invite ? (
        <>
          <View style={[styles.linkBox, { backgroundColor: colors.primarySurface }]}>
            <Text style={[typeScale.caption, { color: colors.primary }]} selectable numberOfLines={2}>{url}</Text>
          </View>
          <View style={styles.actions}>
            <Button title="Text Message" icon="message-circle" onPress={text} style={{ flex: 1 }} />
            <Button title={copied ? 'Copied!' : 'Copy Link'} icon={copied ? 'check' : 'copy'} variant="secondary" onPress={copy} style={{ flex: 1 }} />
          </View>
          <Button title="Make a New Link" variant="ghost" onPress={make} loading={busy} />
        </>
      ) : (
        <Button title="Send Private Link" icon="link" onPress={make} loading={busy} fullWidth />
      )}
      {error ? <Text style={[typeScale.caption, { color: semantic.error }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md },
  linkBox: { padding: spacing.md, borderRadius: radius.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
