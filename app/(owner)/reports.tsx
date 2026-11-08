/**
 * Owner/admin: messages and photos that customers (or staff) reported as inappropriate.
 * Open ones first. Delete the message / stop sharing the photo, or mark the report handled.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Platform, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, GlassIconButton, InlineNotice, LoadingSpinner, OptimizedImage } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import { handleReport, useReports, type ReportItem } from '@/data/contentReports';
import { reasonLabel, contentLabel } from '@/lib/contentReports';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export default function ReportsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, loading, error, refresh } = useReports();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useDb();

  const open = items.filter((r) => r.status === 'open');
  const done = items.filter((r) => r.status === 'handled');

  const who = (id: string) => {
    const p = db.people[id];
    return p ? `${p.firstName} ${p.lastName}`.trim() || 'Someone' : 'Someone';
  };
  const projectName = (id: string) => db.projects.find((p) => p.id === id)?.name ?? 'a project';

  async function act(r: ReportItem, removeContent: boolean) {
    setBusyId(r.id);
    setProblem(null);
    const res = await handleReport(r, { removeContent });
    setBusyId(null);
    if (!res.ok) { setProblem(res.error); return; }
    refresh();
  }

  function confirmRemove(r: ReportItem) {
    const what = r.content_type === 'photo' ? 'Stop sharing this photo with the customer' : 'Delete this message for everyone';
    Alert.alert(`${what}?`, 'The report will be marked handled.', [
      { text: 'Cancel', style: 'cancel' },
      { text: r.content_type === 'photo' ? 'Stop sharing' : 'Delete', style: 'destructive', onPress: () => act(r, true) },
    ]);
  }

  function ReportCard({ r }: { r: ReportItem }) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
          {reasonLabel(r.reason)} · {contentLabel(r.content_type)}
        </Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>
          Reported by {who(r.reported_by)} in {projectName(r.project_id)} · {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </Text>
        {r.details ? <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginTop: spacing.sm }]}>{`“${r.details}”`}</Text> : null}
        <View style={[styles.preview, { backgroundColor: colors.backgroundTertiary }]}>
          {r.gone ? (
            <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>This {contentLabel(r.content_type)} was already removed.</Text>
          ) : r.content_type === 'message' ? (
            <Text style={[typeScale.bodyMedium, { color: colors.textPrimary }]}>{r.body}</Text>
          ) : r.photoUrl ? (
            <OptimizedImage source={r.photoUrl} style={{ width: '100%', height: 160, borderRadius: radius.md }} />
          ) : null}
        </View>
        {r.status === 'open' ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            {!r.gone ? (
              <Button title={r.content_type === 'photo' ? 'Stop sharing' : 'Delete'} variant="danger" size="sm" loading={busyId === r.id} onPress={() => confirmRemove(r)} style={{ flex: 1 }} />
            ) : null}
            <Button title="Mark handled" variant="secondary" size="sm" loading={busyId === r.id} onPress={() => act(r, false)} style={{ flex: 1 }} />
          </View>
        ) : (
          <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>{`Handled${r.handled_note ? ` · ${r.handled_note}` : ''}`}</Text>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={refresh} />}
      >
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>Reported content</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg }]}>
          Messages and photos people flagged. Please review within two business days.
        </Text>
        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} /> : null}
        {problem ? <InlineNotice icon="alert-circle" tone="error" text={problem} /> : null}
        {loading && items.length === 0 ? (
          <LoadingSpinner />
        ) : items.length === 0 ? (
          <EmptyState icon="check-circle" title="No reports" description="Nothing has been reported. If someone reports a message or photo it shows up here." />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {open.map((r) => <ReportCard key={r.id} r={r} />)}
            {done.length > 0 ? <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.md }]}>HANDLED</Text> : null}
            {done.map((r) => <ReportCard key={r.id} r={r} />)}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: spacing.md },
  preview: { borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
});
