/**
 * Owner/admin: problems the crew reported (tree down, damage, safety…).
 * Open ones first; switch to Resolved to see the history.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, FilterChips, GlassIconButton } from '@/components/ui';
import { IssueRow } from '@/components/issues/IssueRow';
import { useTheme } from '@/providers/ThemeProvider';
import { useIssues } from '@/data/issues';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

export default function IssuesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const issues = useIssues();
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const openCount = issues.filter((i) => i.status === 'open').length;
  const shown = issues.filter((i) => i.status === tab);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false} contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['4xl'] }}>
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>Issues</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg }]}>
          Problems your crew reported
        </Text>
        <FilterChips
          options={[
            { key: 'open', label: 'Open', count: openCount },
            { key: 'resolved', label: 'Resolved' },
          ]}
          selected={tab}
          onSelect={setTab}
          style={{ marginBottom: spacing.md }}
        />
        {shown.length === 0 ? (
          <EmptyState
            icon="check-circle"
            title={tab === 'open' ? 'No open issues' : 'Nothing resolved yet'}
            description={tab === 'open' ? 'When a worker reports a problem it shows up here.' : undefined}
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {shown.map((i) => <IssueRow key={i.id} issue={i} />)}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
