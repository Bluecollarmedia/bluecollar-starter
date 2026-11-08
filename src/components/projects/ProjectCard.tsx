import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing, shadow } from '@/theme/spacing';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getProjectImageUri } from '@/lib/projectImages';
import { BrandCover } from '@/components/branding/BrandCover';
import type { Project, ProjectStatus } from '@/types/project';

interface ProjectCardProps {
  project: Project;
  onPress: () => void;
}

const statusConfig: Record<ProjectStatus, { label: string; type: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
  prospect: { label: 'Prospect', type: 'neutral' },
  active: { label: 'Active', type: 'success' },
  on_hold: { label: 'On Hold', type: 'warning' },
  completed: { label: 'Completed', type: 'info' },
  archived: { label: 'Archived', type: 'neutral' },
};

export function ProjectCard({ project, onPress }: ProjectCardProps) {
  const { colors } = useTheme();
  const config = statusConfig[project.status];
  const customerName = project.customer
    ? `${project.customer.firstName} ${project.customer.lastName}`
    : undefined;
  const completedTasks = (project.taskCount ?? 0) - (project.openTaskCount ?? 0);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surface, ...shadow.sm },
        pressed && { opacity: 0.92 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${project.name}, ${config.label}, ${project.progress}% complete`}
    >
      <BrandCover uri={getProjectImageUri(project)} style={styles.image} variant="tile" />

      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>
            {project.name}
          </Text>
          <StatusBadge label={config.label} status={config.type} style={styles.statusBadge} />
        </View>

        {customerName && (
          <View style={styles.metaRow}>
            <Icon name="user" size={12} color={colors.textTertiary} />
            <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
              {customerName}
            </Text>
          </View>
        )}

        {project.address && (
          <View style={styles.metaRow}>
            <Icon name="map-pin" size={12} color={colors.textTertiary} />
            <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
              {project.address}{project.city ? `, ${project.city}` : ''}
            </Text>
          </View>
        )}

        <View style={styles.progressRow}>
          <View style={[styles.progressTrack, { backgroundColor: colors.backgroundTertiary }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(0, Math.min(100, project.progress))}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
          <Text style={[typeScale.caption, { color: colors.textSecondary, fontWeight: '600' }]}>
            {project.progress}%
          </Text>
        </View>

        <View style={styles.footerRow}>
          {project.teamCount !== undefined && (
            <View style={styles.metaItem}>
              <Icon name="users" size={12} color={colors.textTertiary} />
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                {project.teamCount} crew
              </Text>
            </View>
          )}
          {project.taskCount !== undefined && (
            <View style={styles.metaItem}>
              <Icon name="check-square" size={12} color={colors.textTertiary} />
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                {completedTasks}/{project.taskCount} tasks
              </Text>
            </View>
          )}
        </View>
      </View>

      <Icon name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  image: {
    width: 76,
    height: 92,
    borderRadius: radius.sm,
  },
  content: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: 2,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
});
