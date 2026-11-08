import { ReportProblemButton } from '@/components/issues/ReportProblemButton';
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { useResources } from '@/hooks/useResources';
import { StatusBadge } from '@/components/ui';
import { PhotoViewer } from '@/components/worker/PhotoViewer';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { db } from '@/data/store';
import { todayKey, localDateKey } from '@/lib/ids';
import type { ProjectPhoto } from '@/types/project';
import { getProjectImageUriById } from '@/lib/projectImages';
import { BrandCover } from '@/components/branding/BrandCover';
import { useT, tr } from '@/i18n';

const HAS_LIQUID_GLASS = isLiquidGlassAvailable();

const HERO_HEIGHT = 220;

function formatTime(time?: string) {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const display = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${display}:${m} ${ampm}`;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const iso = (x: Date) => localDateKey(x);
  if (dateStr === iso(today)) return tr('Today');
  if (dateStr === iso(tomorrow)) return tr('Tomorrow');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function JobDetailScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    todayAssignments, upcomingAssignments, completedAssignments,
    checkIns, checkOuts, projectTasks, openMapsNavigation,
  } = useWorkerContext();
  const [viewer, setViewer] = useState<ProjectPhoto[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const { resources } = useResources();

  const assignment = [...todayAssignments, ...upcomingAssignments, ...completedAssignments]
    .find(a => a.id === id);

  if (!assignment) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <Header onBack={() => router.back()} colors={colors} insets={insets} />
        <View style={styles.center}>
          <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{t('Job not found')}</Text>
        </View>
      </View>
    );
  }

  const isPast = assignment.status === 'completed' || assignment.scheduledDate < todayKey();

  // Only this worker's own photos, scoped to this exact task — never another
  // worker's upload, another task, or another project's photo library.
  function getTaskPhotos(taskId: string): ProjectPhoto[] {
    const projectPhotos = db.photos[assignment!.projectId] ?? [];
    return projectPhotos.filter(p => p.taskId === taskId && p.uploadedBy === user?.id);
  }

  function openViewer(photos: ProjectPhoto[]) {
    setViewer(photos);
    setViewerIndex(0);
  }
  const lastCheckIn = [...checkIns].reverse().find(c => c.assignmentId === assignment.id);
  const lastCheckOut = [...checkOuts].reverse().find(c => c.assignmentId === assignment.id);
  const tasks = projectTasks(assignment.projectId);

  function handleOpenMaps() {
    if (assignment!.project?.address) openMapsNavigation(assignment!.project);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing['4xl'] }}>
        <View style={styles.hero}>
          <BrandCover uri={getProjectImageUriById(assignment.projectId)} style={styles.heroImage} />
          <View style={[styles.headerOverlay, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              {HAS_LIQUID_GLASS ? (
                <GlassView glassEffectStyle="regular" isInteractive style={styles.backChip}>
                  <Feather name="chevron-left" size={20} color="#FFFFFF" />
                  <Text style={[typeScale.bodyLarge, { color: '#FFFFFF', marginLeft: 2 }]}>{t('My Jobs')}</Text>
                </GlassView>
              ) : (
                <View style={[styles.backChip, styles.backChipFallback]}>
                  <Feather name="chevron-left" size={20} color="#FFFFFF" />
                  <Text style={[typeScale.bodyLarge, { color: '#FFFFFF', marginLeft: 2 }]}>{t('My Jobs')}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.content}>
          <View style={[styles.card, { backgroundColor: colors.surface, marginTop: -28 }, shadow.md]}>
            <View style={styles.titleRow}>
              <Text style={[typeScale.displaySmall, { color: colors.textPrimary, flex: 1 }]}>
                {assignment.project?.name ?? t('Unknown Project')}
              </Text>
              <StatusBadge label={isPast ? t('Past') : t('Upcoming')} status={isPast ? 'neutral' : 'success'} />
            </View>

            <View style={[styles.metaRow, { marginTop: spacing.md }]}>
              <Feather name="calendar" size={14} color={colors.textTertiary} />
              <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
                {formatDateLabel(assignment.scheduledDate)}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Feather name="clock" size={14} color={colors.textTertiary} />
              <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
                {assignment.isFullDay ? t('Full day') : `${formatTime(assignment.startTime)} – ${formatTime(assignment.endTime)}`}
              </Text>
            </View>
            {assignment.project?.address && (
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={14} color={colors.textTertiary} />
                <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginLeft: spacing.sm, flex: 1 }]}>
                  {assignment.project.address}
                </Text>
                <Pressable
                  onPress={handleOpenMaps}
                  style={[styles.navDot, { backgroundColor: colors.primarySurface }]}
                  hitSlop={8}
                >
                  <Feather name="navigation" size={14} color={colors.primary} />
                </Pressable>
              </View>
            )}
            {assignment.truck && (
              <View style={styles.metaRow}>
                <Feather name="truck" size={14} color={colors.textTertiary} />
                <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginLeft: spacing.sm, flex: 1 }]}>
                  {assignment.truck.name}
                </Text>
                {/* Only shows when the owner gave this worker codes for this truck. */}
                {resources.some((r) => r.truckId === assignment.truck!.id) && (
                  <Pressable
                    onPress={() => router.push(`/(worker)/my-resources?truckId=${assignment.truck!.id}` as any)}
                    style={[styles.truckCodes, { backgroundColor: colors.primarySurface }]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('Truck codes')}
                  >
                    <Feather name="key" size={12} color={colors.primaryDark} />
                    <Text style={[typeScale.labelSmall, { color: colors.primaryDark, marginLeft: 4 }]}>{t('Codes')}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {assignment.project?.address && (
            <Pressable
              style={[styles.card, styles.mapsRow, { backgroundColor: colors.primarySurface }]}
              onPress={handleOpenMaps}
            >
              <Feather name="map" size={18} color={colors.primaryDark} />
              <Text style={[typeScale.bodyLarge, { color: colors.primaryDark, flex: 1, marginLeft: spacing.sm, fontWeight: '600' }]}>
                {t('Open in Maps')}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.primaryDark} />
            </Pressable>
          )}

          {isPast && (lastCheckIn || lastCheckOut) && (
            <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
              <Text style={[typeScale.caption, { color: colors.textSecondary, fontWeight: '600' }]}>{t('SUMMARY')}</Text>
              {lastCheckIn && (
                <View style={[styles.summaryRow, { marginTop: spacing.sm }]}>
                  <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{t('Checked In')}</Text>
                  <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]}>
                    {formatClock(lastCheckIn.timestamp)}
                  </Text>
                </View>
              )}
              {lastCheckOut && (
                <View style={styles.summaryRow}>
                  <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{t('Checked Out')}</Text>
                  <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]}>
                    {formatClock(lastCheckOut.timestamp)}
                  </Text>
                </View>
              )}
            </View>
          )}

          {assignment.notes && (
            <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
              <View style={styles.labelRow}>
                <Feather name="file-text" size={14} color={colors.primary} />
                <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, fontWeight: '600' }]}>
                  {t('JOB NOTES')}
                </Text>
              </View>
              <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, marginTop: spacing.xs }]}>
                {assignment.notes}
              </Text>
            </View>
          )}

          {tasks.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
              <View style={styles.tasksHeader}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('Assigned Tasks')}</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                  {t('{done} of {total} completed', { done: tasks.filter(x => x.status === 'completed').length, total: tasks.length })}
                </Text>
              </View>
              {tasks.map((task, i) => {
                const taskPhotos = isPast && task.status === 'completed' ? getTaskPhotos(task.id) : [];
                return (
                  <View
                    key={task.id}
                    style={[styles.taskRow, i > 0 && { borderTopColor: colors.borderLight, borderTopWidth: StyleSheet.hairlineWidth }]}
                  >
                    {task.status === 'completed' ? (
                      <Feather name="check-circle" size={18} color={colors.success} />
                    ) : (
                      <Feather name="circle" size={18} color={colors.border} />
                    )}
                    <Text
                      style={[
                        typeScale.bodyMedium,
                        { color: task.status === 'completed' ? colors.textSecondary : colors.textPrimary, marginLeft: spacing.sm, flex: 1 },
                      ]}
                    >
                      {task.title}
                    </Text>
                    {taskPhotos.length > 0 && (
                      <Pressable onPress={() => openViewer(taskPhotos)} hitSlop={8} style={styles.viewPhotoRow}>
                        <Text style={[typeScale.bodySmall, { color: colors.primary, fontWeight: '600' }]}>
                          {taskPhotos.length === 1 ? t('View Photo') : t('View Photos ({n})', { n: taskPhotos.length })}
                        </Text>
                        <Feather name="chevron-right" size={14} color={colors.primary} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {assignment.project?.address && (
            <Pressable onPress={handleOpenMaps}>
              <LinearGradient
                colors={[colors.primary, colors.primary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.pillButton}
              >
                <Feather name="navigation" size={18} color="#FFFFFF" />
                <Text style={[typeScale.labelLarge, { color: '#FFFFFF', marginLeft: spacing.sm }]}>
                  {t('Get Directions')}
                </Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>
        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
          <ReportProblemButton where={{ projectId: assignment.projectId }} />
        </View>
      </ScrollView>

      <Modal
        visible={!!viewer}
        transparent
        animationType="fade"
        onRequestClose={() => setViewer(null)}
      >
        <PhotoViewer
          photos={viewer ?? []}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewer(null)}
          insets={insets}
        />
      </Modal>
    </View>
  );
}

function Header({ onBack, colors, insets }: { onBack: () => void; colors: any; insets: any }) {
  const t = useT();
  return (
    <View style={[styles.plainHeader, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.backRow}>
        <Feather name="chevron-left" size={22} color={colors.textPrimary} />
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{t('My Jobs')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  plainHeader: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  hero: { height: HERO_HEIGHT, width: '100%' },
  heroImage: { width: '100%', height: '100%' },
  headerOverlay: { position: 'absolute', left: 0, right: 0, paddingHorizontal: spacing.lg },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  backChipFallback: {
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  card: { borderRadius: radius.xl, padding: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  truckCodes: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full },
  navDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapsRow: { flexDirection: 'row', alignItems: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  tasksHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: radius.full,
  },
  viewPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
});
