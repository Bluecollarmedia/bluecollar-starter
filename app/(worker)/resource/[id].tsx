import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useResources } from '@/hooks/useResources';
import { CategoryIcon, ProtectedCode } from '@/components/resources/ResourceParts';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { RESOURCE_CATEGORIES } from '@/types/resource';
import { useT } from '@/i18n';

/**
 * One resource for a worker. If access was removed (or the id was never
 * theirs), this shows a neutral "not available" message without the name.
 */
export default function WorkerResourceDetailScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ready, getResource, revealSecret, refreshResources } = useResources();
  const [checking, setChecking] = useState(true);

  // Always confirm with the server before showing anything, so a stale route
  // or cached screen can't show a resource whose access was just removed.
  useFocusEffect(useCallback(() => {
    let alive = true;
    setChecking(true);
    refreshResources().finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [refreshResources]));

  const r = getResource(id);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel={t('Go back')}>
        <Icon name="arrow-left" size={24} color={colors.textPrimary} />
      </Pressable>
    </View>
  );

  if (!r || checking) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
        {header}
        {!ready || checking ? (
          <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={colors.primary} />
        ) : (
          <EmptyState icon="lock" title={t('Not available')} description={t("This resource isn't available to you. Ask your manager if you need access.")} />
        )}
      </View>
    );
  }

  const info = RESOURCE_CATEGORIES[r.category];
  const linked = r.category === 'vehicle' ? r.truckName : r.category === 'equipment' ? r.itemName : undefined;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      {header}
      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing['3xl'] }]}>
        <View style={styles.titleRow}>
          <CategoryIcon category={r.category} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{r.name}</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{t(info.label)}</Text>
          </View>
        </View>

        {(linked || r.category === 'company_card') && (
          <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
            {linked && (
              <View style={styles.metaRow}>
                <Icon name={info.icon} size={16} color={colors.textTertiary} />
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.sm }]}>{linked}</Text>
              </View>
            )}
            {r.category === 'company_card' && (
              <>
                <View style={styles.metaRow}>
                  <Icon name="credit-card" size={16} color={colors.textTertiary} />
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.sm }]}>
                    {r.cardLastFour ? t('Card ending in {digits}', { digits: r.cardLastFour }) : t('Company card')}
                  </Text>
                </View>
                {r.cardHolderName && (
                  <View style={[styles.metaRow, { marginTop: spacing.sm }]}>
                    <Icon name="user" size={16} color={colors.textTertiary} />
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.sm }]}>{t('Carried by {name}', { name: r.cardHolderName })}</Text>
                  </View>
                )}
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>
                  {t("Card PINs aren't kept in the app. Ask your manager.")}
                </Text>
              </>
            )}
          </View>
        )}

        {r.description && (
          <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
            <Text style={[typeScale.overline, { color: colors.textTertiary, marginBottom: spacing.xs }]}>{t('INSTRUCTIONS')}</Text>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{r.description}</Text>
          </View>
        )}

        {r.hasSecret && info.secretLabel && (
          <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
            <ProtectedCode label={info.secretLabel} reveal={() => revealSecret(r.id)} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  backButton: { padding: spacing.xs, alignSelf: 'flex-start' },
  content: { paddingHorizontal: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  card: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
});
