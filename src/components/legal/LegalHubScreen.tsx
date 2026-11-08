/**
 * "Legal & Support": ONE page that lists Privacy Policy, Terms of Use and Help & Support. Every Settings screen has a single "Legal & Support"
 * row that opens this page, and each row here opens that document. `basePath` is the hub of the area the person is in, so everything stays
 * inside that area and Back always returns to the screen they came from (Settings), never to the home screen.
 */
import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ListSection, ListRow, ScreenHeader } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { LEGAL_ROWS, legalDocPath } from '@/lib/legalPaths';
import { spacing } from '@/theme/spacing';
import { useT } from '@/i18n';

export function LegalHubScreen({ basePath }: { basePath: string }) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title={t('Legal & Support')} />
      <ScrollView bounces={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }} showsVerticalScrollIndicator={false}>
        <ListSection>
          {LEGAL_ROWS.map((r) => (
            <ListRow key={r.slug} icon={r.icon} title={t(r.title)} subtitle={t(r.subtitle)} showChevron onPress={() => router.push(legalDocPath(basePath, r.slug) as any)} />
          ))}
        </ListSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
