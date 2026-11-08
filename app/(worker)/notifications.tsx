import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Switch } from '@/components/ui/Switch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { ListSection, ListRow } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { useT } from '@/i18n';

export default function NotificationsScreen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { settings, updateNotificationsEnabled } = useWorkerContext();

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
          <Feather name="chevron-left" size={22} color={colors.textPrimary} />
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{t('Settings')}</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginBottom: spacing.lg }]}>
          {t('Notifications')}
        </Text>

        <ListSection footer={t("On: alerts about your jobs come to this phone. Off: no phone alerts are sent to you, but every notice still shows in the app. Your phone's own Settings must also allow notifications for this app.")}>
          <ListRow
            icon="bell"
            title={t('Push Notifications')}
            subtitle={t('Job updates, schedule changes and reminders')}
            rightElement={
              <Switch
                value={settings.notificationsEnabled}
                onValueChange={updateNotificationsEnabled}
                accessibilityLabel={t('Push Notifications')}
              />
            }
          />
        </ListSection>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  content: { paddingHorizontal: spacing.lg },
});
