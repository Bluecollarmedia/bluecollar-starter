import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { answerWebDialog, subscribeDialogs, type DialogRequest } from '@/lib/webDialog';
import { useT } from '@/i18n';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

/** Draws the website's dialogs (confirm / message), one at a time. Renders nothing on a phone. Mounted once at the root. */
export function WebDialogHost() {
  const { colors } = useTheme();
  const t = useT();
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => (Platform.OS === 'web' ? subscribeDialogs(setQueue) : undefined), []);
  const current = queue[0];
  if (Platform.OS !== 'web' || !current) return null;

  const cancel = current.buttons.find((b) => b.style === 'cancel');
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => answerWebDialog(cancel ?? current.buttons[0])}>
      <View style={styles.backdrop}>
        <View style={[styles.box, { backgroundColor: colors.surface }]} accessibilityRole="alert">
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t(current.title)}</Text>
          {current.message ? <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.sm }]}>{t(current.message)}</Text> : null}
          <View style={[styles.buttons, current.buttons.length > 2 && { flexDirection: 'column' }]}>
            {current.buttons.map((b, i) => {
              const destructive = b.style === 'destructive';
              const primary = !b.style || b.style === 'default' || destructive;
              return (
                <Pressable
                  key={`${b.text}-${i}`}
                  onPress={() => answerWebDialog(b)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.button,
                    { backgroundColor: primary ? (destructive ? colors.error : colors.primaryDark) : colors.backgroundTertiary, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={[typeScale.labelLarge, { color: primary ? '#FFFFFF' : colors.textPrimary }]}>{t(b.text ?? 'OK')}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  box: { width: '100%', maxWidth: 420, borderRadius: radius.xl, padding: spacing.xl },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl, justifyContent: 'flex-end' },
  button: { minHeight: 46, borderRadius: radius.lg, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
});
