import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { ServiceIcon } from '@/components/maintenance/ServiceIcon';
import { StopChecklist } from '@/components/maintenance/StopChecklist';
import { StopPhotos } from '@/components/maintenance/StopPhotos';
import { servicesLabel, stopAddress, formatClock } from '@/components/maintenance/format';
import { db } from '@/data/store';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { useT } from '@/i18n';
import type { MaintenanceStopDetail } from '@/types/maintenance';

export type StopCardState = 'done' | 'next' | 'later';

interface Props {
  stop: MaintenanceStopDetail;
  state: StopCardState;
  onOpen: () => void;
  onDirections: () => void;
}

const isSaved = (p: { fileUrl: string }) => db.demo || /^https?:\/\//i.test(p.fileUrl);

/** A section that folds away. Tap its title to fold or unfold it. */
function Fold({ title, summary, open, onToggle, children }: { title: string; summary?: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title} hitSlop={6} style={styles.foldHead}>
        <Text style={[typeScale.overline, { color: colors.textSecondary, flex: 1 }]}>{title}</Text>
        {summary ? <Text style={[typeScale.labelSmall, { color: colors.textSecondary }]}>{summary}</Text> : null}
        <Feather name={open ? 'chevron-down' : 'chevron-right'} size={16} color={colors.textTertiary} />
      </Pressable>
      {open ? <View style={{ marginTop: spacing.sm }}>{children}</View> : null}
    </View>
  );
}

/**
 * One stop on the worker's Today.
 *  - FINISHED: a calm row with a check. Tap it to unfold what was done (tasks, photos, who finished); "Details" opens the stop screen.
 *  - LATER: a quiet row.
 *  - NEXT: the big card, which follows where the worker is:
 *      driving there: name, address (opens Maps), the work, how many tasks, the way in (access notes);
 *      on site: this visit's instructions, the checklist and the photos. Each folds away by itself once its requirement is met, and
 *      unfolds again when tapped.
 * The primary button (I'M HERE / FINISH STOP) is NOT in the card: it is pinned at the bottom of the screen (ActionBar), so it is always in
 * the same easy place however long the card gets. The checklist, photo and finish components and rules are the stop screen's own.
 */
export function StopCard({ stop, state, onOpen, onDirections }: Props) {
  const t = useT();
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const name = stop.property?.name ?? t('Property');
  const address = stopAddress(stop);
  const service = servicesLabel(stop);
  const skipped = stop.status === 'skipped';

  const required = stop.tasks.filter((task) => task.isRequired);
  const requiredDone = required.filter((x) => x.completedAt).length;
  const tasksSatisfied = required.length > 0 && requiredDone === required.length;
  const savedPhotos = stop.photos.filter(isSaved).length;
  const photosSatisfied = stop.requiresPhotos && savedPhotos >= stop.minPhotos;
  const [tasksOpen, setTasksOpen] = useState(!tasksSatisfied);
  const [photosOpen, setPhotosOpen] = useState(!photosSatisfied);
  // Folds away on its own the moment its requirement is met (and stays unfoldable).
  useEffect(() => { if (tasksSatisfied) setTasksOpen(false); }, [tasksSatisfied]);
  useEffect(() => { if (photosSatisfied) setPhotosOpen(false); }, [photosSatisfied]);

  if (state === 'done') {
    const finishedBy = stop.completedBy ? db.people[stop.completedBy]?.firstName : undefined;
    const doneTasks = stop.tasks.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    return (
      <View style={[styles.row, styles.doneRow, { backgroundColor: colors.backgroundSecondary }]}>
        <Pressable onPress={() => setUnfolded((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: unfolded }} accessibilityLabel={name} style={styles.doneTop}>
          <View style={[styles.check, { backgroundColor: skipped ? colors.backgroundTertiary : colors.success }]}>
            <Feather name={skipped ? 'minus' : 'check'} size={14} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]} numberOfLines={1}>{name}</Text>
            <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>{skipped ? t('Skipped') : address}</Text>
          </View>
          <Feather name={unfolded ? 'chevron-down' : 'chevron-right'} size={16} color={colors.textTertiary} />
        </Pressable>
        {unfolded ? (
          <View style={styles.doneBody}>
            {!skipped && stop.completedAt ? (
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                {finishedBy ? t('Finished {time} by {name}', { time: formatClock(stop.completedAt), name: finishedBy }) : t('Finished {time}', { time: formatClock(stop.completedAt) })}
              </Text>
            ) : null}
            {doneTasks.map((task) => (
              <View key={task.id} style={styles.doneTask}>
                <Feather name={task.completedAt ? 'check-square' : 'square'} size={14} color={task.completedAt ? colors.success : colors.textTertiary} />
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flex: 1 }]}>{task.title}</Text>
              </View>
            ))}
            {stop.photos.length > 0 ? (
              <View style={styles.doneTask}>
                <Feather name="camera" size={14} color={colors.textTertiary} />
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{stop.photos.length === 1 ? t('1 photo') : t('{n} photos', { n: stop.photos.length })}</Text>
              </View>
            ) : null}
            <Pressable onPress={onOpen} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}>
              <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Details')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  const number = stop.number;
  if (state === 'later') {
    return (
      <Pressable onPress={onOpen} accessibilityRole="button" style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
        <View style={[styles.num, { backgroundColor: colors.backgroundTertiary }]}><Text style={[typeScale.labelLarge, { color: colors.textSecondary }]}>{number}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{name}</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{address}</Text>
          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>{service}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.textTertiary} />
      </Pressable>
    );
  }

  // The next stop.
  const onSite = stop.status === 'arrived';
  const arrivedBy = stop.arrivedBy ? db.people[stop.arrivedBy]?.firstName : undefined;
  const taskCount = stop.tasks.length;
  const tasksLine = [
    taskCount === 0 ? null : taskCount === 1 ? t('1 task') : t('{n} tasks', { n: taskCount }),
    stop.requiresPhotos ? (stop.minPhotos === 1 ? t('1 photo needed') : t('{n} photos needed', { n: stop.minPhotos })) : null,
  ].filter(Boolean).join(' · ');
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.md]}>
      <Pressable onPress={onOpen} accessibilityRole="button">
        <View style={styles.titleRow}>
          <View style={[styles.numBig, { backgroundColor: colors.primaryDark }]}><Text style={[typeScale.headingSmall, { color: '#FFFFFF' }]}>{number}</Text></View>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]} numberOfLines={2}>{name}</Text>
        </View>
      </Pressable>
      <Pressable onPress={onDirections} accessibilityRole="link" accessibilityLabel={`${t('Open in Maps')}: ${address}`} hitSlop={6} style={styles.meta}>
        <Feather name="map-pin" size={15} color={colors.primary} />
        <Text style={[typeScale.bodyMedium, { color: colors.primary, flex: 1, textDecorationLine: 'underline' }]} numberOfLines={2}>{address}</Text>
      </Pressable>
      <View style={styles.meta}>
        <ServiceIcon label={service} size={15} color={colors.textSecondary} />
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>{service}</Text>
      </View>
      {!onSite && tasksLine ? (
        <View style={styles.meta}>
          <Feather name="check-square" size={15} color={colors.textSecondary} />
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, flex: 1 }]}>{tasksLine}</Text>
        </View>
      ) : null}
      {stop.property?.accessNotes ? (
        <View style={[styles.note, { backgroundColor: colors.backgroundSecondary }]}>
          <Feather name="key" size={14} color={colors.textSecondary} />
          <Text style={[typeScale.bodySmall, styles.noteText, { color: colors.textPrimary }]}>{stop.property.accessNotes}</Text>
        </View>
      ) : null}
      {onSite && stop.arrivedAt ? (
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          {arrivedBy ? t('Checked in {time} by {name}', { time: formatClock(stop.arrivedAt), name: arrivedBy }) : t('Checked in {time}', { time: formatClock(stop.arrivedAt) })}
        </Text>
      ) : null}

      {/* ON SITE: the job itself, right here. */}
      {onSite ? (
        <>
          {stop.instructions ? (
            <View style={[styles.note, { backgroundColor: colors.warningLight }]}>
              <Feather name="alert-circle" size={14} color={colors.warning} />
              <Text style={[typeScale.bodySmall, styles.noteText, { color: colors.textPrimary }]}>{stop.instructions}</Text>
            </View>
          ) : null}
          {taskCount > 0 ? (
            <Fold
              title={required.length ? t('Checklist · {done} of {total} required', { done: requiredDone, total: required.length }) : t('Checklist')}
              summary={tasksSatisfied ? t('Done') : undefined}
              open={tasksOpen}
              onToggle={() => setTasksOpen((v) => !v)}
            >
              <StopChecklist tasks={stop.tasks} locked={false} stopId={stop.id} requiresPhotos={stop.requiresPhotos} photoCount={stop.photos.length} onError={setError} />
            </Fold>
          ) : null}
          <Fold
            title={t('Photos')}
            summary={stop.requiresPhotos ? (photosSatisfied ? t('Done') : `${Math.min(savedPhotos, stop.minPhotos)}/${stop.minPhotos}`) : undefined}
            open={photosOpen}
            onToggle={() => setPhotosOpen((v) => !v)}
          >
            <StopPhotos stopId={stop.id} photos={stop.photos} requiresPhotos={stop.requiresPhotos} minPhotos={stop.minPhotos} locked={false} />
          </Fold>
          {error ? <Text style={[typeScale.bodySmall, { color: colors.error, marginTop: spacing.sm }]}>{t(error)}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  numBig: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.sm },
  noteText: { flex: 1 },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  doneRow: { flexDirection: 'column', alignItems: 'stretch', gap: 0 },
  doneTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  doneBody: { marginTop: spacing.sm, paddingLeft: 26 + spacing.md, gap: spacing.xs },
  doneTask: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  num: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  check: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
