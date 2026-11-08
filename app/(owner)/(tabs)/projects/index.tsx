import React, { useState } from 'react';
import { View, Text, SectionList, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { SearchBar, FilterChips, EmptyState } from '@/components/ui';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { useProjects } from '@/hooks/useProjects';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import type { ProjectStatus } from '@/types/project';
import { w } from '@/config/brand';

type FilterKey = ProjectStatus | 'all';

const STATUS_ORDER: ProjectStatus[] = ['active', 'on_hold', 'prospect', 'completed', 'archived'];
const STATUS_LABELS: Record<ProjectStatus, string> = {
  prospect: 'Prospects',
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
};

export default function ProjectsListScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterKey>('active');

  const { grouped, counts } = useProjects({ search, statusFilter });

  const filterOptions: { key: FilterKey; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: counts.active },
    { key: 'on_hold', label: 'On Hold', count: counts.on_hold },
    ...(counts.prospect > 0 ? [{ key: 'prospect' as const, label: 'Prospects', count: counts.prospect }] : []),
    { key: 'completed', label: 'Completed', count: counts.completed },
    { key: 'archived', label: 'Archived', count: counts.archived },
    { key: 'all', label: 'All', count: counts.all },
  ];

  const sections = STATUS_ORDER
    .filter((s) => grouped[s].length > 0)
    .map((s) => ({
      title: STATUS_LABELS[s],
      data: grouped[s],
    }));

  const totalResults = sections.reduce((sum, s) => sum + s.data.length, 0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.titleRow}>
          <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{w('Jobs')}</Text>
          <Pressable
            onPress={() => router.push('/(owner)/project-new')}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
            accessibilityLabel={w('Create new job')}
          >
            <Icon name="plus" size={22} color={colors.textOnPrimary} />
          </Pressable>
        </View>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder={w('Search jobs...')}
          style={styles.searchBar}
        />
        <FilterChips
          options={filterOptions}
          selected={statusFilter}
          onSelect={setStatusFilter}
        />
      </View>

      {totalResults === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="folder"
            title={w(search ? 'No matching jobs' : counts.all > 0 ? 'Nothing here right now' : 'No jobs yet')}
            description={
              search
                ? 'Try adjusting your search or filter.'
                : counts.all > 0
                  ? w('Pick another filter, or tap All to see every job.')
                  : w('Tap the + button to create your first job.')
            }
          />
        </View>
      ) : (
        <SectionList bounces={false}
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ProjectCard
              project={item}
              onPress={() => router.push(`/(owner)/projects/${item.id}` as any)}
            />
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={[typeScale.overline, { color: colors.textTertiary }]}>
                {section.title}
              </Text>
            </View>
          )}
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBarClearance }]}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    paddingVertical: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
  },
});
