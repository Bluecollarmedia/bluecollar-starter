import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { useT } from '@/i18n';

/**
 * A worker's other kind of work: the Maintenance route on the main home, or the project jobs on the Maintenance home.
 * Being put on a job or a route is what gives access, so a worker is never left without a way to reach it.
 */
export function OtherWorkCard({ icon, title, subtitle, onPress }: { icon: keyof typeof Feather.glyphMap; title: string; subtitle: string; onPress: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t(title)}. ${t(subtitle)}`}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.primarySurface, opacity: pressed ? 0.9 : 1 }]}
    >
      <Feather name={icon} size={22} color={colors.primaryDark} />
      <View style={styles.text}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t(title)}</Text>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{t(subtitle)}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.primaryDark} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.md },
  text: { flex: 1, marginLeft: spacing.md },
});
