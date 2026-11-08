import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyState, ListSection, SearchBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useResources } from '@/hooks/useResources';
import { ResourceRow, groupByCategory, matchesResource } from '@/components/resources/ResourceParts';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

/**
 * Company Resources (owner/admin). Lives above the tab navigator so it opens
 * the same way from More and from the Workers tab without switching tabs.
 */
export default function CompanyResourcesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ready, loadError, resources, refreshResources } = useResources();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { refreshResources(); }, [refreshResources]));

  const groups = useMemo(() => groupByCategory(resources.filter((r) => matchesResource(r, search))), [resources, search]);

  async function retry() {
    setRefreshing(true);
    await refreshResources();
    setRefreshing(false);
  }

  const addResource = () => router.push('/(owner)/resource-edit' as any);

  let body: React.ReactNode;
  if (!ready) {
    body = <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={colors.primary} />;
  } else if (loadError && resources.length === 0) {
    const missingTable = /company_resources/.test(loadError) && /exist|schema cache/i.test(loadError);
    body = (
      <EmptyState
        icon="alert-circle"
        title="Couldn't load resources"
        description={missingTable
          ? 'The database is missing the Company Resources update. Run supabase/updates/006_company_resources.sql in the Supabase SQL Editor.'
          : 'Check your connection and try again.'}
        actionTitle={refreshing ? 'Trying…' : 'Try Again'}
        onAction={retry}
      />
    );
  } else if (resources.length === 0) {
    body = (
      <EmptyState
        icon="key"
        title="No resources yet"
        description="Add gate codes, truck and trailer lock codes, equipment instructions or company info, then choose which workers can see each one."
        actionTitle="Add Resource"
        onAction={addResource}
      />
    );
  } else if (groups.length === 0) {
    body = <EmptyState icon="search" title="No matches" description={`Nothing matches “${search.trim()}”.`} />;
  } else {
    body = groups.map((g) => (
      <ListSection key={g.category} title={g.info.label.toUpperCase()}>
        {g.items.map((r) => (
          <ResourceRow
            key={r.id}
            resource={r}
            onPress={() => router.push(`/(owner)/resource-edit?id=${r.id}` as any)}
            onManageAccess={() => router.push(`/(owner)/resource-access?id=${r.id}` as any)}
          />
        ))}
      </ListSection>
    ));
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Company Resources</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
            Codes and info you share with selected workers
          </Text>
        </View>
      </View>

      <View style={styles.toolbar}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search" style={{ flex: 1 }} />
        <Button title="Add Resource" icon="plus" size="sm" onPress={addResource} />
      </View>

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
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
});
