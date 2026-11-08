import { useLanguage, tr } from '@/i18n';
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Icon, PressableScale } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { ISSUE_TYPES, issueTypeLabel, type PropertyIssue } from '@/data/issues';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export function issueWhen(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return tr('Just now');
  if (mins < 60) return tr('{n} min ago', { n: mins });
  if (mins < 60 * 24) return tr('{n} hr ago', { n: Math.round(mins / 60) });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One reported problem: type, place, who and when, first photo, status. */
export function IssueRow({ issue, showPlace = true }: { issue: PropertyIssue; showPlace?: boolean }) {
  const { colors } = useTheme();
  const { language } = useLanguage();
  const router = useRouter();
  const icon = ISSUE_TYPES.find((t) => t.key === issue.issueType)?.icon ?? 'flag';
  const open = issue.status === 'open';
  const thumb = issue.photos[0]?.url;
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/(owner)/issue-detail', params: { id: issue.id } } as any)}
      accessibilityRole="button"
      accessibilityLabel={`${issueTypeLabel(issue.issueType)}${showPlace ? ` at ${issue.placeName}` : ''}`}
      style={[styles.row, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderLight }]}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.thumb, styles.noThumb, { backgroundColor: colors.backgroundTertiary }]}>
          <Icon name={icon as any} size={22} color={colors.textSecondary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>
          {issueTypeLabel(issue.issueType)}{showPlace && issue.placeName ? ` · ${issue.placeName}` : ''}
        </Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
          {issue.reporterName} · {issueWhen(issue.createdAt)}
        </Text>
        {!!issue.notes && (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={2}>{issue.notes}</Text>
        )}
      </View>
      <View style={[styles.badge, { backgroundColor: open ? colors.warningLight : colors.primarySurface }]}>
        <Text style={[typeScale.caption, { color: open ? colors.warning : colors.primaryDark, fontWeight: '700' }]}>
          {open ? (language === 'es' ? 'Abierto' : 'Open') : (language === 'es' ? 'Resuelto' : 'Resolved')}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  thumb: { width: 56, height: 56, borderRadius: radius.md },
  noThumb: { alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
});
