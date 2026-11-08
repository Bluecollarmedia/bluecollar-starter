import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ListSection, SearchBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useResources } from '@/hooks/useResources';
import { ResourceRow, groupByCategory, matchesResource } from '@/components/resources/ResourceParts';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { useT } from '@/i18n';

/**
 * Company Resources for a worker: only what the owner gave them access to.
 * `truckId` narrows the list to one truck (opened from a job's truck row).
 */
export default function WorkerResourcesScreen() {
  const t = useT();
  const { truckId } = useLocalSearchParams<{ truckId?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ready, loadError, resources, refreshResources } = useResources();
  const [search, setSearch] = useState('');

  // Re-check with the server every time the screen is shown, so removed
  // access disappears even if a live update was missed.
  useFocusEffect(useCallback(() => { refreshResources(); }, [refreshResources]));

  const scoped = useMemo(() => (truckId ? resources.filter((r) => r.truckId === truckId) : resources), [resources, truckId]);
  const groups = useMemo(() => groupByCategory(scoped.filter((r) => matchesResource(r, search))), [scoped, search]);
  const truckName = truckId ? scoped[0]?.truckName : undefined;

  let body: React.ReactNode;
  if (!ready) {
    body = <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={colors.primary} />;
  } else if (loadError && resources.length === 0) {
    body = (
      <EmptyState
        icon="wifi-off"
        title={t("Couldn't load resources")}
        description={t('Check your connection and try again.')}
        actionTitle={t('Try Again')}
        onAction={() => refreshResources()}
      />
    );
  } else if (scoped.length === 0) {
    body = (
      <EmptyState
        icon="key"
        title={t('No company resources yet')}
        description={truckId
          ? t("You don't have any codes or info for this truck. Ask your manager if you need access.")
          : t("No company resources are available to you right now. When your manager shares gate codes, truck codes or other info with you, they'll show up here.")}
      />
    );
  } else if (groups.length === 0) {
    body = <EmptyState icon="search" title={t('No matches')} description={t('Nothing matches “{query}”.', { query: search.trim() })} />;
  } else {
    body = groups.map((g) => (
      <ListSection key={g.category} title={t(g.info.label).toUpperCase()}>
        {g.items.map((r) => (
          <ResourceRow key={r.id} resource={r} onPress={() => router.push(`/(worker)/resource/${r.id}` as any)} />
        ))}
      </ListSection>
    ));
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel={t('Go back')}>
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} numberOfLines={1}>
            {truckName ?? t('Company Resources')}
          </Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
            {truckId ? t('Codes and info for this truck') : t('Codes and info shared with you')}
          </Text>
        </View>
      </View>

      {scoped.length > 0 && (
        <View style={styles.searchWrap}>
          <SearchBar value={search} onChangeText={setSearch} placeholder={t('Search')} />
        </View>
      )}

      <ScrollView bounces={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing['3xl'] }]} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  backButton: { padding: spacing.xs },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
});
