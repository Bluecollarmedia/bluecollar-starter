import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, InlineNotice, ListSection, SearchBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useResources } from '@/hooks/useResources';
import { CategoryIcon, PersonCheckRow, resourceContext } from '@/components/resources/ResourceParts';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { RESOURCE_CATEGORIES } from '@/types/resource';

/** Choose exactly which workers can open one resource (owner/admin). */
export default function ResourceAccessScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getResource, activeWorkers, accessFor, setResourceAccess } = useResources();
  const resource = getResource(id);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(accessFor(id)));
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeWorkers;
    return activeWorkers.filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q));
  }, [activeWorkers, search]);

  if (!resource) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground, paddingTop: insets.top + spacing.lg }]}>
        <EmptyState icon="alert-circle" title="Resource not found" description="It may have been deleted." actionTitle="Close" onAction={() => router.back()} />
      </View>
    );
  }

  function toggle(personId: string) {
    haptics.select();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of visible) {
        if (allVisibleSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  function save() {
    setResourceAccess(resource!.id, [...selected]);
    haptics.success();
    router.back();
  }

  const context = resourceContext(resource);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Manage Access</Text>
        <View style={styles.resourceRow}>
          <CategoryIcon category={resource.category} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{resource.name}</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
              {[RESOURCE_CATEGORIES[resource.category].label, context].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        {created === '1' && (
          <InlineNotice icon="lock" tone="info" text="Saved. Nobody can see it yet. Pick the workers who should have access." style={{ marginTop: spacing.md }} />
        )}
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search workers" style={{ marginTop: spacing.md }} />
      </View>

      <ScrollView bounces={false} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {activeWorkers.length === 0 ? (
          <EmptyState icon="users" title="No active workers" description="Workers appear here once they've joined your team." />
        ) : visible.length === 0 ? (
          <EmptyState icon="search" title="No matches" description={`No worker matches “${search.trim()}”.`} />
        ) : (
          <>
            <View style={styles.listHeader}>
              <Text style={[typeScale.overline, { color: colors.textTertiary }]}>
                {selected.size} OF {activeWorkers.length} SELECTED
              </Text>
              <Pressable onPress={toggleAllVisible} hitSlop={8}>
                <Text style={[typeScale.labelSmall, { color: colors.primary }]}>{allVisibleSelected ? 'Clear' : 'Select all'}</Text>
              </Pressable>
            </View>
            <ListSection>
              {visible.map((p) => (
                <PersonCheckRow key={p.id} person={p} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
              ))}
            </ListSection>
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.groupedBackground, borderTopColor: colors.separator }]}>
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button title="Save Changes" onPress={save} style={{ flex: 1.6 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  resourceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
    marginHorizontal: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
