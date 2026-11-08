/**
 * The owner writes a message to their customers (landscaping, maintenance and Snow). Each customer gets a push notification and
 * a banner on their home screen, like an announcement to workers but for customers. Below the form, the messages already sent.
 * Used by both the landscaping owner (More > Announcements) and the Snow Mode owner (More).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, Input, ScreenHeader, InlineNotice } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { fetchCustomerReach, sendCustomerMessage, useCustomerMessageHistory } from '@/data/customerBlast';
import { AUDIENCES, BODY_MAX, TITLE_MAX, audienceLabel, confirmText, messageProblem, sentText, type CustomerAudience } from '@/lib/customerMessage';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The form and the sent list for messages to customers, with no screen around it (the Announcements page embeds it). */
export function MessageCustomersPanel() {
  const { colors } = useTheme();
  const history = useCustomerMessageHistory();
  const [audience, setAudience] = useState<CustomerAudience>('customers_all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [reach, setReach] = useState<Partial<Record<CustomerAudience, number>> | null>(null);
  useEffect(() => { fetchCustomerReach().then(setReach); }, [history.length]);
  const [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const problem = messageProblem(title, body);
  const help = AUDIENCES.find((a) => a.key === audience)?.help;

  async function send() {
    setNote(null);
    setSending(true);
    const res = await sendCustomerMessage({ title, body, audience });
    setSending(false);
    if (res.ok) {
      setNote({ tone: 'success', text: sentText(res.recipients) });
      if (res.recipients > 0) { setTitle(''); setBody(''); }
    } else {
      setNote({ tone: 'error', text: res.error });
    }
  }

  function confirmSend() {
    if (problem) { setNote({ tone: 'error', text: problem }); return; }
    const { title: t, message } = confirmText(audience);
    Alert.alert(t, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: send }]);
  }

  return (
    <View style={styles.content}>
        <Text style={[typeScale.overline, { color: colors.textSecondary }]}>SEND TO</Text>
        <View style={styles.chips}>
          {AUDIENCES.map((a) => {
            const on = a.key === audience;
            return (
              <Pressable
                key={a.key}
                onPress={() => setAudience(a.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? colors.primary : colors.surface, borderColor: on ? colors.primary : colors.border }]}
              >
                <Text style={[typeScale.labelLarge, { color: on ? '#FFFFFF' : colors.textSecondary }]}>{a.label}</Text>
                {reach?.[a.key] != null ? (
                  <Text style={[typeScale.caption, { color: on ? '#FFFFFF' : colors.textTertiary, opacity: on ? 0.85 : 1 }]}>{reach[a.key]}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {help ? <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{help}</Text> : null}

        <Input label="Title" value={title} onChangeText={setTitle} placeholder="For example: Plowing starts at 4 AM" maxLength={TITLE_MAX} />
        <Input label="Message" value={body} onChangeText={setBody} placeholder="Write whatever you want your customers to know." multiline maxLength={BODY_MAX} containerStyle={{ minHeight: 140 }} />

        {note ? <InlineNotice icon={note.tone === 'success' ? 'check-circle' : 'alert-triangle'} tone={note.tone === 'success' ? 'success' : 'error'} text={note.text} /> : null}

        <Button title="Send to Customers" icon="send" onPress={confirmSend} loading={sending} disabled={sending} fullWidth size="lg" />
        <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
          Customers can turn off notifications on their phone. The banner still shows when they open the app.
        </Text>

        {history.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={[typeScale.overline, { color: colors.textSecondary, marginBottom: spacing.sm }]}>SENT MESSAGES</Text>
            <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
              {history.map((a, i) => (
                <View key={a.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Icon name="send" size={16} color={colors.textTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{a.title}</Text>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={2}>{a.body}</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                      {audienceLabel(a.audience)} · {a.recipientIds?.length ?? 0} {(a.recipientIds?.length ?? 0) === 1 ? 'person' : 'people'} · {when(a.createdAt)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
    </View>
  );
}

/** Message Customers as its own screen (Snow Mode's More opens this one). */
export function MessageCustomersScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title="Message Customers" subtitle="A push notification and a banner in their app" />
      <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: insets.bottom + spacing['5xl'] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <MessageCustomersPanel />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, height: 38, flexDirection: 'row', gap: 6, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  list: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, alignItems: 'flex-start' },
});
