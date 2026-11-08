import { showWebDialog } from '@/lib/webDialog';
import { tr } from '@/i18n';
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius, sizing } from '@/theme/spacing';

export interface SheetAction {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  destructive?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  title?: string;
  message?: string;
  actions: SheetAction[];
  onClose: () => void;
  children?: React.ReactNode;
}

/** Bottom sheet with a short list of actions (or custom content). */
export function ActionSheet({ visible, title, message, actions, onClose, children }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          {!!title && <Text style={[typeScale.headingSmall, { color: colors.textPrimary, paddingHorizontal: spacing.lg }]}>{title}</Text>}
          {!!message && (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, paddingHorizontal: spacing.lg, marginTop: spacing.xs }]}>
              {message}
            </Text>
          )}
          {children}
          <View style={{ marginTop: spacing.sm }}>
            {actions.map((a) => (
              <Pressable
                key={a.key}
                // Let the sheet finish closing first so a follow-up alert or sheet can show.
                onPress={() => { onClose(); setTimeout(a.onPress, 280); }}
                style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.backgroundSecondary }]}
                accessibilityRole="button"
              >
                <Icon name={a.icon} size={18} color={a.destructive ? colors.error : colors.textSecondary} />
                <Text style={[typeScale.bodyLarge, { color: a.destructive ? colors.error : colors.textPrimary }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </BottomSheetModal>
  );
}

/** Native confirm dialog (window.confirm on the web). */
export function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = false) {
  if (Platform.OS === 'web') {
    // The app's own dialog (the browser's confirm() can be blocked or suppressed, which made buttons seem dead).
    showWebDialog(title, message, [{ text: tr('Cancel'), style: 'cancel' }, { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm }]);
    return;
  }
  Alert.alert(title, message, [
    { text: tr('Cancel'), style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

/** Native alert (window.alert on the web). */
export function showMessage(title: string, message: string) {
  if (Platform.OS === 'web') {
    showWebDialog(title, message);
    return;
  }
  Alert.alert(title, message);
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.sm },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: spacing.md },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizing.touchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
