import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useCustomers } from '@/hooks/useCustomers';
import { SearchBar, EmptyState, Avatar, StatusBadge, ScreenHeader, RaisedAddButton } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

export default function CustomersListScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const { customers } = useCustomers({ search });

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Customers"
        subtitle="Everyone you do work for"
        right={
          <RaisedAddButton
            onPress={() => router.push('/(owner)/customers/new')}
            accessibilityLabel="Add customer"
          />
        }
      />
      <View style={styles.searchWrap}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search customers or projects..."
          style={styles.searchBar}
        />
      </View>

      {customers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="user"
            title={search ? 'No matching customers' : 'No customers yet'}
            description={search ? 'Try a different search.' : 'Tap + to add your first customer.'}
          />
        </View>
      ) : (
        <FlatList bounces={false}
          data={customers}
          keyExtractor={(item) => item.person.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing['3xl'] }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const firstProject = item.projects[0];
            const extraCount = item.projects.length - 1;
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.customerCard,
                  { backgroundColor: colors.surface },
                  shadow.sm,
                  pressed && { opacity: 0.92 },
                ]}
                onPress={() => router.push(`/(owner)/customers/${item.person.id}` as any)}
              >
                <Avatar firstName={item.person.firstName} lastName={item.person.lastName} size={48} uri={item.person.avatarUrl} />
                <View style={styles.customerInfo}>
                  <View style={styles.nameRow}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flexShrink: 1, marginRight: spacing.sm }]} numberOfLines={1}>
                      {item.person.firstName} {item.person.lastName}
                    </Text>
                    <StatusBadge
                      label={item.member.status === 'active' ? 'Active' : item.member.status === 'invited' ? 'Invited' : 'Inactive'}
                      status={item.member.status === 'active' ? 'success' : item.member.status === 'invited' ? 'info' : 'neutral'}
                    />
                  </View>

                  {!firstProject && item.maintenanceProperties.length > 0 ? (
                    <View style={styles.detailRow}>
                      <Icon name="home" size={12} color={colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, flexShrink: 1 }]} numberOfLines={1}>
                        {item.maintenanceProperties[0].name} · Maintenance
                      </Text>
                      {item.maintenanceProperties.length > 1 && (
                        <View style={[styles.moreChip, { backgroundColor: colors.backgroundTertiary }]}>
                          <Text style={[typeScale.caption, { color: colors.textSecondary, fontWeight: '600' }]}>+{item.maintenanceProperties.length - 1} more</Text>
                        </View>
                      )}
                    </View>
                  ) : firstProject ? (
                    <View style={styles.detailRow}>
                      <Icon name="home" size={12} color={colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, flexShrink: 1 }]} numberOfLines={1}>
                        {firstProject.name}
                      </Text>
                      {extraCount > 0 && (
                        <View style={[styles.moreChip, { backgroundColor: colors.backgroundTertiary }]}>
                          <Text style={[typeScale.caption, { color: colors.textSecondary, fontWeight: '600' }]}>+{extraCount} more</Text>
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={styles.detailRow}>
                      <Icon name="home" size={12} color={colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: colors.textTertiary, marginLeft: spacing.xs }]}>No projects yet</Text>
                    </View>
                  )}

                  {item.person.phone && (
                    <View style={styles.detailRow}>
                      <Icon name="phone" size={12} color={colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
                        {item.person.phone}
                      </Text>
                    </View>
                  )}
                </View>
                <Icon name="chevron-right" size={18} color={colors.textTertiary} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  searchBar: { marginBottom: spacing.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'], paddingTop: spacing.xs },
  emptyContainer: { flex: 1, justifyContent: 'center' },
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  moreChip: {
    marginLeft: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
  },
  customerInfo: { flex: 1 },
});
