import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { LANGUAGES, useLanguage, useT } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

/**
 * English | Español. Small on purpose: a pill for the sign-in / sign-up screens (so someone can read the page in Spanish before they sign up),
 * and the same switch as one quiet row in Settings. The choice stays on this phone.
 */
export function LanguageSwitch({ style, compact = false }: { style?: object; compact?: boolean }) {
  const { colors } = useTheme();
  const { language, setLanguage } = useLanguage();
  const t = useT();
  return (
    <View style={[styles.pill, { backgroundColor: colors.backgroundTertiary, borderColor: colors.borderLight }, style]} accessibilityRole="radiogroup" accessibilityLabel={t('Language')}>
      {LANGUAGES.map((l) => {
        const on = language === l.key;
        return (
          <Pressable
            key={l.key}
            onPress={() => { if (!on) { haptics.select(); setLanguage(l.key); } }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={l.label}
            hitSlop={6}
            style={[styles.segment, compact && styles.segmentSmall, on && { backgroundColor: colors.primary }]}
          >
            <Text style={[compact ? typeScale.caption : typeScale.labelSmall, { color: on ? '#FFFFFF' : colors.textSecondary, fontWeight: '700' }]}>{l.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small, quiet line at the very bottom of Settings: it is a one-time choice, so it takes almost no room. */
export function LanguageRow() {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View style={styles.row}>
      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{t('Language')}</Text>
      <LanguageSwitch compact />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, padding: 2, alignSelf: 'flex-start' },
  segment: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, minWidth: 64, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  segmentSmall: { paddingHorizontal: spacing.sm, paddingVertical: 3, minWidth: 54 },
});
