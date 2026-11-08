/**
 * Bottom sheet with Cancel / title / Save, for the small materials forms
 * (an item, a vendor, pickup details, the reminder).
 */

import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export function FormSheet({ visible, title, saveLabel = 'Save', onSave, onClose, children }: {
  visible: boolean;
  title: string;
  saveLabel?: string;
  onSave?: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.groupedBackground, paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={10} style={styles.side} accessibilityRole="button">
              <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{onSave ? 'Cancel' : 'Close'}</Text>
            </Pressable>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]} numberOfLines={1}>{title}</Text>
            <View style={[styles.side, { alignItems: 'flex-end' }]}>
              {onSave && (
                <Pressable onPress={onSave} hitSlop={10} accessibilityRole="button">
                  <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{saveLabel}</Text>
                </Pressable>
              )}
            </View>
          </View>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </BottomSheetModal>
  );
}

/** Row of selectable chips (statuses, units, vendors). */
export function ChipRow<T extends string>({ options, value, onChange, wrap = true }: {
  options: { key: T; label: string }[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  wrap?: boolean;
}) {
  const { colors } = useTheme();
  const chips = options.map((o) => {
    const on = value === o.key;
    return (
      <Pressable
        key={o.key}
        onPress={() => onChange(on ? undefined : o.key)}
        style={[styles.chip, { backgroundColor: on ? colors.primary : colors.backgroundTertiary }]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
      >
        <Text style={[typeScale.labelSmall, { color: on ? colors.textOnPrimary : colors.textSecondary }]} numberOfLines={1}>{o.label}</Text>
      </Pressable>
    );
  });
  return wrap
    ? <View style={styles.chips}>{chips}</View>
    : <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xs }}>{chips}</ScrollView>;
}

export function SheetLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs, marginLeft: spacing.xs, letterSpacing: 0.5 }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '92%' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  side: { minWidth: 64 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, maxWidth: 240 },
});
