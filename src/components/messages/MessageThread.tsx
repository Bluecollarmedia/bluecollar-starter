import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, Platform } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { db } from '@/data/store';
import { useProjectMessages } from '@/hooks/useProjectMessages';
import { ReportSheet, type ReportTarget } from '@/components/reports/ReportSheet';
import { isoToLocalDateKey, todayKey } from '@/lib/ids';
import type { ProjectMessage } from '@/types/project';

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (isoToLocalDateKey(iso) === todayKey()) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

interface MessageThreadProps {
  projectId: string;
  emptyTitle?: string;
  emptyText?: string;
}

/** Chat bubbles plus a composer. The parent provides the scrolling container. */
export function MessageThread({ projectId, emptyTitle, emptyText }: MessageThreadProps) {
  return (
    <View>
      <MessageList projectId={projectId} emptyTitle={emptyTitle} emptyText={emptyText} />
      <MessageComposer projectId={projectId} />
    </View>
  );
}

/** The chat bubbles only (or the empty note). */
export function MessageList({ projectId, emptyTitle, emptyText }: MessageThreadProps) {
  const t = useT();
  const { colors } = useTheme();
  const { messages, remove } = useProjectMessages(projectId);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);

  function handleLongPress(m: ProjectMessage) {
    if (m.senderId !== db.personId) return;
    const doDelete = () => remove(m.id);
    Alert.alert(t('Delete this message?'), t('It will be removed for everyone.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: doDelete },
    ]);
  }

  if (messages.length === 0) {
    return (
      <View style={styles.empty}>
        <Icon name="message-circle" size={28} color={colors.textTertiary} />
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginTop: spacing.sm }]}>{emptyTitle ?? t('No messages yet')}</Text>
        {emptyText ? (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs }]}>{emptyText}</Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {messages.map((m) => {
        const mine = m.senderId === db.personId;
        const name = m.sender ? `${m.sender.firstName} ${m.sender.lastName}`.trim() : '';
        return (
          <Pressable
            key={m.id}
            onLongPress={() => handleLongPress(m)}
            style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
          >
            {!mine && name ? (
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginBottom: 2, marginLeft: spacing.sm }]}>{name}</Text>
            ) : null}
            <View
              style={[
                styles.bubble,
                mine
                  ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
                  : { backgroundColor: colors.backgroundTertiary, borderBottomLeftRadius: 4 },
              ]}
            >
              <Text style={[typeScale.bodyLarge, { color: mine ? '#FFFFFF' : colors.textPrimary }]}>{m.body}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginHorizontal: spacing.sm }]}>
                {timeLabel(m.createdAt)}
              </Text>
              {!mine ? (
                <Pressable
                  onPress={() => setReporting({ projectId, type: 'message', contentId: m.id })}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('Report this message')}
                >
                  <Text style={[typeScale.caption, { color: colors.textSecondary, textDecorationLine: 'underline' }]}>{t('Report')}</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </View>
  );
}

/** The "Write a message…" box with its send button. */
export function MessageComposer({ projectId }: { projectId: string }) {
  const t = useT();
  const { colors } = useTheme();
  const { send } = useProjectMessages(projectId);
  const [draft, setDraft] = useState('');

  function handleSend() {
    if (!draft.trim()) return;
    send(draft);
    setDraft('');
  }

  return (
    <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      <TextInput
        style={[typeScale.bodyLarge, styles.input, { color: colors.textPrimary }]}
        value={draft}
        onChangeText={setDraft}
        placeholder={t('Write a message…')}
        placeholderTextColor={colors.textTertiary}
        multiline
      />
      <Pressable
        onPress={handleSend}
        disabled={!draft.trim()}
        style={[styles.sendButton, { backgroundColor: draft.trim() ? colors.primary : colors.backgroundTertiary }]}
        accessibilityRole="button"
        accessibilityLabel={t('Send message')}
      >
        <Icon name="send" size={18} color={draft.trim() ? '#FFFFFF' : colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: spacing['2xl'], paddingHorizontal: spacing.lg },
  list: { gap: spacing.sm, paddingBottom: spacing.md },
  row: { maxWidth: '85%' },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  bubble: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.xs,
    paddingLeft: spacing.md,
  },
  input: { flex: 1, maxHeight: 120, paddingVertical: spacing.sm },
  sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
