import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Avatar, Button, EmptyState } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useCrews } from '@/hooks/useCrews';
import { db } from '@/data/store';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

/**
 * Crews (owner/admin): groups of workers like "Maintenance Crew". Lives above
 * the tab navigator, like Company Resources, so it opens from Workers and
 * from a worker's profile without switching tabs.
 */
export default function CrewsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { crews } = useCrews();
  const addCrew = () => router.push('/(owner)/crew-edit' as any);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Crews</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
            Group workers and schedule a whole crew at once
          </Text>
        </View>
        <Button title="New Crew" icon="plus" size="sm" onPress={addCrew} />
      </View>

      <ScrollView bounces={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing['3xl'] }]}>
        {crews.length === 0 ? (
          <EmptyState
            icon="users"
            title="No crews yet"
            description="Make a crew like Maintenance Crew, add its workers, and each worker gets a crew label."
            actionTitle="New Crew"
            onAction={addCrew}
          />
        ) : crews.map(c => {
          const people = c.memberIds.map(id => db.people[id]).filter(Boolean);
          return (
            <Pressable
              key={c.id}
              onPress={() => router.push(`/(owner)/crew-edit?id=${c.id}` as any)}
              style={({ pressed }) => [styles.crewCard, { backgroundColor: colors.surface }, shadow.sm, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${people.length} worker${people.length === 1 ? '' : 's'}`}
            >
              <View style={[styles.colorBar, { backgroundColor: c.color }]} />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <View style={styles.nameRow}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{c.name}</Text>
                  {c.isMaintenance && (
                    <View style={[styles.maintTag, { backgroundColor: colors.primarySurface }]}>
                      <Icon name="repeat" size={11} color={colors.primary} />
                      <Text style={[typeScale.caption, { color: colors.primary, fontWeight: '700' }]}>Maintenance</Text>
                    </View>
                  )}
                </View>
                {people.length > 0 ? (
                  <View style={styles.avatarRow}>
                    {people.slice(0, 5).map((p, i) => (
                      <View key={p.id} style={[styles.avatarWrap, { marginLeft: i === 0 ? 0 : -8, borderColor: colors.surface }]}>
                        <Avatar firstName={p.firstName} lastName={p.lastName} size={26} uri={p.avatarUrl} />
                      </View>
                    ))}
                    <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.sm }]} numberOfLines={1}>
                      {people.map(p => p.firstName).join(', ')}
                    </Text>
                  </View>
                ) : (
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>No workers yet</Text>
                )}
              </View>
              <Icon name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  maintTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  backButton: { padding: spacing.xs },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  crewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  colorBar: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { borderWidth: 2, borderRadius: 15 },
});
