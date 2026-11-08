import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useSearch } from '@/hooks/useSearch';
import { SearchBar, EmptyState } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export default function SearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { results } = useSearch(query);

  function handlePress(item: typeof results[0]) {
    switch (item.type) {
      case 'project':
        router.push(`/(owner)/projects/${item.id}` as any);
        break;
      case 'worker':
        router.push(`/(owner)/workers/${item.id}` as any);
        break;
      case 'customer':
        router.push(`/(owner)/customers/${item.id}` as any);
        break;
    }
  }

  const typeLabels: Record<string, string> = {
    project: 'Project',
    worker: 'Worker',
    customer: 'Customer',
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder="Search projects, workers, customers..."
            autoFocus
            style={[styles.pillSearch, { backgroundColor: colors.backgroundSecondary }]}
          />
        </View>
      </View>

      {query.length < 2 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="search"
            title="Search everything"
            description="Type at least 2 characters to search across projects, workers, and customers."
          />
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="search"
            title="No results"
            description={`No matches for "${query}". Try a different search.`}
          />
        </View>
      ) : (
        <FlatList bounces={false}
          data={results}
          keyExtractor={(item) => `${item.type}_${item.id}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.resultRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => handlePress(item)}
            >
              <View style={[styles.iconCircle, { backgroundColor: colors.primarySurface }]}>
                <Icon name={item.icon as any} size={18} color={colors.primary} />
              </View>
              <View style={styles.resultInfo}>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '500' }]}>
                  {item.title}
                </Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                  {item.subtitle}
                </Text>
              </View>
              <View style={[styles.typeBadge, { backgroundColor: colors.backgroundTertiary }]}>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                  {typeLabels[item.type]}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
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
    gap: spacing.sm,
  },
  backButton: { padding: spacing.xs },
  pillSearch: {
    height: 46,
    borderRadius: radius.full,
    borderWidth: 0,
  },
  emptyContainer: { flex: 1, justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'] },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultInfo: { flex: 1 },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
  },
});
