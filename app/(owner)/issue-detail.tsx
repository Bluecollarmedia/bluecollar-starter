/**
 * Owner/admin: one reported problem with its photos and notes. Mark it
 * Resolved (with an optional note), reopen it, open the place, or delete it.
 */

import { PhotoPager } from '@/components/media/PhotoPager';
import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Platform, Alert, Modal } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, GlassIconButton, Icon, PressableScale } from '@/components/ui';
import { issueWhen } from '@/components/issues/IssueRow';
import { useTheme } from '@/providers/ThemeProvider';
import { deleteIssue, issueTypeLabel, removeIssuePhoto, reopenIssue, resolveIssue, useIssues } from '@/data/issues';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export default function IssueDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const issue = useIssues().find((i) => i.id === id);
  const [note, setNote] = useState('');
  const [viewer, setViewer] = useState<string | null>(null);

  if (!issue) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg }]}>
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <EmptyState icon="alert-circle" title="Issue not found" description="It may have been deleted." />
      </View>
    );
  }

  const open = issue.status === 'open';

  function confirmDelete() {
    const run = () => { deleteIssue(issue!.id); router.back(); };
    Alert.alert('Delete this report?', 'This removes it for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  }

  function openPlace() {
    if (issue!.maintenancePropertyId) router.push(`/(owner)/maintenance/properties/${issue!.maintenancePropertyId}` as any);
    else if (issue!.projectId) router.push(`/(owner)/projects/${issue!.projectId}` as any);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['4xl'] }}
      >
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>{issueTypeLabel(issue.issueType)}</Text>
        <PressableScale onPress={openPlace} accessibilityRole="button" accessibilityLabel={`Open ${issue.placeName}`}>
          <Text style={[typeScale.bodyLarge, { color: colors.primary, marginTop: 2, fontWeight: '600' }]}>{issue.placeName || 'Open place'}</Text>
        </PressableScale>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          Reported by {issue.reporterName} · {issueWhen(issue.createdAt)}
        </Text>

        {!!issue.notes && (
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: spacing.lg }]}>{issue.notes}</Text>
        )}

        {issue.photos.length > 0 && (
          <View style={styles.photos}>
            {issue.photos.map((p) => (
              <PressableScale key={p.key || p.url} onPress={() => setViewer(p.key || p.url)} accessibilityRole="imagebutton" accessibilityLabel="View photo">
                <Image source={{ uri: p.url }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" />
              </PressableScale>
            ))}
          </View>
        )}

        {open ? (
          <>
            <Text style={[typeScale.overline, { color: colors.textSecondary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>RESOLVE</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Note (optional): what was done"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={[styles.input, typeScale.bodyLarge, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
            />
            <PressableScale
              onPress={() => { resolveIssue(issue.id, note); setNote(''); }}
              accessibilityRole="button"
              accessibilityLabel="Mark resolved"
              style={[styles.primary, { backgroundColor: colors.primary }]}
            >
              <Icon name="check" size={18} color="#FFFFFF" />
              <Text style={[typeScale.labelLarge, { color: '#FFFFFF', fontWeight: '800' }]}>Mark Resolved</Text>
            </PressableScale>
          </>
        ) : (
          <View style={[styles.resolved, { backgroundColor: colors.primarySurface }]}>
            <Text style={[typeScale.labelLarge, { color: colors.primaryDark, fontWeight: '700' }]}>
              Resolved{issue.resolvedByName ? ` by ${issue.resolvedByName}` : ''}{issue.resolvedAt ? ` · ${issueWhen(issue.resolvedAt)}` : ''}
            </Text>
            {!!issue.resolutionNote && <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: 4 }]}>{issue.resolutionNote}</Text>}
            <PressableScale onPress={() => reopenIssue(issue.id)} accessibilityRole="button" accessibilityLabel="Reopen" style={{ marginTop: spacing.sm }}>
              <Text style={[typeScale.labelLarge, { color: colors.primary, fontWeight: '700' }]}>Reopen</Text>
            </PressableScale>
          </View>
        )}

        <PressableScale onPress={confirmDelete} accessibilityRole="button" accessibilityLabel="Delete report" style={{ marginTop: spacing.xl, alignSelf: 'center' }}>
          <Text style={[typeScale.labelLarge, { color: colors.error, fontWeight: '600' }]}>Delete report</Text>
        </PressableScale>
      </ScrollView>

      <PhotoPager
        photos={issue.photos.map((p) => ({ id: p.key || p.url, url: p.url }))}
        startId={viewer}
        onClose={() => setViewer(null)}
        actionsFor={(ph) => [{
          key: 'delete', label: 'Delete', icon: 'trash-2', destructive: true,
          onPress: () => Alert.alert('Delete this photo?', 'It is removed from the report for good.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => removeIssuePhoto(issue.id, ph.id) }]),
        }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  photo: { width: 110, height: 110, borderRadius: radius.md },
  input: { minHeight: 80, borderRadius: radius.md, borderWidth: 1, padding: spacing.md, textAlignVertical: 'top' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 52, borderRadius: radius.full, marginTop: spacing.md },
  resolved: { marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.lg },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
});
