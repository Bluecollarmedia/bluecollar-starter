import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, EmptyState, InlineNotice, ListSection, SearchBar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useResources } from '@/hooks/useResources';
import { CategoryIcon, Checkbox, groupByCategory, matchesResource, resourceContext } from '@/components/resources/ResourceParts';
import { db } from '@/data/store';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

/**
 * Manage Resource Access from a worker's profile: every resource, grouped by
 * category, with this worker's access ticked. Writes the same resource_access
 * rows as the per-resource Manage Access screen.
 */
export default function WorkerResourceAccessScreen() {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { resources, resourcesFor, setWorkerAccess } = useResources();

  const member = db.members.find((m) => m.personId === personId && m.role === 'worker');
  const person = member?.person;
  const isActive = member?.status === 'active';

  const [selected, setSelected] = useState<Set<string>>(() => new Set(resourcesFor(personId)));
  const [search, setSearch] = useState('');

  const groups = useMemo(() => groupByCategory(resources.filter((r) => matchesResource(r, search))), [resources, search]);

  if (!person) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground, paddingTop: insets.top + spacing.lg }]}>
        <EmptyState icon="alert-circle" title="Worker not found" actionTitle="Close" onAction={() => router.back()} />
      </View>
    );
  }

  function toggle(resourceId: string) {
    if (!isActive) return;
    haptics.select();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(resourceId)) next.delete(resourceId);
      else next.add(resourceId);
      return next;
    });
  }

  function save() {
    setWorkerAccess(personId, [...selected]);
    haptics.success();
    router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.personRow}>
          <Avatar firstName={person.firstName} lastName={person.lastName} size={44} uri={person.avatarUrl} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} numberOfLines={1}>Resource Access</Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
              {person.firstName} {person.lastName} · {selected.size} of {resources.length}
            </Text>
          </View>
        </View>
        {!isActive && (
          <InlineNotice icon="user-x" tone="error" text="This worker is deactivated and can't open any resources." style={{ marginTop: spacing.md }} />
        )}
        {resources.length > 0 && (
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search" style={{ marginTop: spacing.md }} />
        )}
      </View>

      <ScrollView bounces={false} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {resources.length === 0 ? (
          <EmptyState
            icon="key"
            title="No resources yet"
            description="Add resources first, then choose who can see them."
            actionTitle="Add Resource"
            onAction={() => router.replace('/(owner)/resource-edit' as any)}
          />
        ) : groups.length === 0 ? (
          <EmptyState icon="search" title="No matches" description={`Nothing matches “${search.trim()}”.`} />
        ) : (
          groups.map((g) => (
            <ListSection key={g.category} title={g.info.label.toUpperCase()}>
              {g.items.map((r) => {
                const checked = selected.has(r.id);
                const context = resourceContext(r);
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => toggle(r.id)}
                    disabled={!isActive}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.backgroundSecondary }, !isActive && { opacity: 0.5 }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: !isActive }}
                    accessibilityLabel={r.name}
                  >
                    <CategoryIcon category={r.category} />
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{r.name}</Text>
                      {context && <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>{context}</Text>}
                    </View>
                    <Checkbox checked={checked} />
                  </Pressable>
                );
              })}
            </ListSection>
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md, borderTopColor: colors.separator }]}>
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
        <Button title="Save Changes" onPress={save} disabled={!isActive || resources.length === 0} style={{ flex: 1.6 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    minHeight: 56,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
