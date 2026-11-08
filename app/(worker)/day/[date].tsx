import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Image } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { OptimizedImage } from '@/components/ui';
import { PhotoViewer } from '@/components/worker/PhotoViewer';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import {
  useWorkerDayDetail, findPhotoForActivity, formatWorkedDuration, type WorkSession,
} from '@/hooks/useWorkerActivitySummary';
import type { WorkerActivity, WorkerActivityType } from '@/types/worker';
import { useT } from '@/i18n';

const EVENT_CONFIG: Record<WorkerActivityType, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  checked_in: { icon: 'log-in', color: '#1976D2' },
  task_started: { icon: 'play', color: '#F9A825' },
  task_completed: { icon: 'check', color: '#43A047' },
  photo_taken: { icon: 'camera', color: '#8E24AA' },
  checked_out: { icon: 'log-out', color: '#D32F2F' },
  schedule_confirmed: { icon: 'check-circle', color: '#43A047' },
  schedule_acknowledged: { icon: 'eye', color: '#1976D2' },
  overtime_flagged: { icon: 'alert-circle', color: '#F9A825' },
};

function formatDateHeading(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function DayDetailScreen() {
  const t = useT();
  const { date } = useLocalSearchParams<{ date: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const day = useWorkerDayDetail(date ?? '');
  const [viewerPhotos, setViewerPhotos] = useState<ReturnType<typeof findPhotoForActivity>[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  function openPhoto(activity: WorkerActivity) {
    const photo = findPhotoForActivity(activity, user?.id);
    if (photo) {
      setViewerPhotos([photo]);
      setViewerIndex(0);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
          <Feather name="chevron-left" size={22} color={colors.textPrimary} />
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{t('Activity')}</Text>
        </Pressable>
      </View>

      {!day ? (
        <View style={styles.center}>
          <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{t('No activity recorded for this day.')}</Text>
        </View>
      ) : (
        <ScrollView bounces={false} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>
            {formatDateHeading(day.date)}
          </Text>
          <Text style={[typeScale.bodyLarge, { color: colors.primaryDark, fontWeight: '600', marginTop: 2 }]}>
            {t('{time} worked', { time: formatWorkedDuration(day.totalWorkedMs) })}
          </Text>

          {day.sessions.map(session => (
            <View key={session.assignmentId} style={styles.sessionBlock}>
              <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
                <View style={styles.sessionHeaderRow}>
                  {session.projectId && (
                    <SessionThumb projectId={session.projectId} />
                  )}
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>
                      {session.projectName}
                    </Text>
                    {session.address && (
                      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{session.address}</Text>
                    )}
                    {session.incomplete && (
                      <View style={[styles.incompleteTag, { backgroundColor: colors.warningLight }]}>
                        <Text style={[typeScale.caption, { color: colors.warning, fontWeight: '600' }]}>
                          {t('Incomplete session')}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.timeline}>
                  {session.events.map((event, i) => {
                    const config = EVENT_CONFIG[event.activityType];
                    const isLast = i === session.events.length - 1;
                    const photo = event.activityType === 'photo_taken' ? findPhotoForActivity(event, user?.id) : undefined;

                    return (
                      <Pressable
                        key={event.id}
                        style={styles.timelineRow}
                        disabled={!photo}
                        onPress={() => openPhoto(event)}
                      >
                        <View style={styles.timelineGutter}>
                          <View style={[styles.timelineDot, { backgroundColor: config.color }]}>
                            <Feather name={config.icon} size={10} color="#FFFFFF" />
                          </View>
                          {!isLast && <View style={[styles.timelineLine, { backgroundColor: colors.borderLight }]} />}
                        </View>
                        <View style={{ flex: 1, paddingBottom: spacing.lg }}>
                          <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                            {formatClock(event.timestamp)}
                          </Text>
                          <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, marginTop: 2 }]}>
                            {event.description}
                          </Text>
                        </View>
                        {photo && (
                          <OptimizedImage source={photo.fileUrl} style={styles.eventThumb} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {viewerPhotos && (
        <View style={StyleSheet.absoluteFill}>
          <PhotoViewer
            photos={viewerPhotos.filter((p): p is NonNullable<typeof p> => !!p)}
            index={viewerIndex}
            onIndexChange={setViewerIndex}
            onClose={() => setViewerPhotos(null)}
            insets={insets}
          />
        </View>
      )}
    </View>
  );
}

function SessionThumb({ projectId }: { projectId: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sessionThumbFallback, { backgroundColor: colors.primarySurface }]}>
      <Feather name="home" size={18} color={colors.primaryDark} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing['4xl'] },
  sessionBlock: { marginTop: spacing.lg },
  card: { borderRadius: radius.xl, padding: spacing.lg },
  sessionHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  sessionThumbFallback: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incompleteTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
    marginTop: spacing.xs,
  },
  timeline: { marginTop: spacing.lg },
  timelineRow: { flexDirection: 'row' },
  timelineGutter: { alignItems: 'center', marginRight: spacing.md },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineLine: { width: 2, flex: 1, marginTop: 2 },
  eventThumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    marginLeft: spacing.sm,
  },
});
