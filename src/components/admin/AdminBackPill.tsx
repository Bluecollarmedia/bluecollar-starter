import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

/** An admin working a job or a Snow route from the worker view gets a small way back to the admin view. Nothing for a real worker. */
export function AdminBackPill({ to = '/(owner)', onBack }: { to?: string; onBack?: () => void } = {}) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  if (db.role !== 'admin') return null;
  return (
    <Pressable
      onPress={() => { haptics.select(); onBack?.(); router.replace(to as any); }}
      accessibilityRole="button"
      accessibilityLabel={t('Back to admin view')}
      style={[styles.pill, { backgroundColor: colors.primaryDark, top: insets.top + spacing.xs }, shadow.md]}
    >
      <Feather name="chevron-left" size={16} color="#FFFFFF" />
      <Text style={[typeScale.labelSmall, { color: '#FFFFFF' }]}>{t('Back to admin view')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', left: spacing.md, zIndex: 50, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
});
