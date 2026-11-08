import React from 'react';
import { Pressable, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { usePublicWeatherSwitch } from '@/hooks/usePublicWeatherSwitch';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

/**
 * "Back to weather" for the welcome screen. A visitor who opened Sign In from the Weather screens can always get back to them without closing the
 * app. It appears only while the public Weather is on (otherwise nobody can have come from it), and it goes to the Weather home itself.
 */
export function BackToWeather() {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const on = usePublicWeatherSwitch(true);
  if (!on) return null;
  return (
    <Pressable
      onPress={() => router.replace('/weather' as any)}
      accessibilityRole="button"
      accessibilityLabel={t('Back to weather')}
      hitSlop={8}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="arrow-left" size={20} color={colors.textSecondary} />
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{t('Back to weather')}</Text>
    </Pressable>
  );
}
