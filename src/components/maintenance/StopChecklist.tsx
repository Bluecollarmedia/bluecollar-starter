/**
 * The checklist for one maintenance visit. Any crew member can tick an item;
 * the tick is shared with the whole crew and records who ticked it.
 * When the stop needs photos, EVERY task needs its own photo: pressing a task asks for one, and the task ticks when that photo is saved.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Icon, PressableScale } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { db, rowsOf, useDb } from '@/data/store';
import { setTaskDone } from '@/data/maintenance';
import { askForTaskPhoto } from '@/lib/stopPhotoPicker';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import type { MaintenanceStopTask } from '@/types/maintenance';

interface Props {
  tasks: MaintenanceStopTask[];
  /** Finished or skipped stops show the list read-only. */
  locked: boolean;
  /** Ticking a task offers a photo when the stop has none yet; when the property requires photos it must be added first. */
  stopId: string;
  requiresPhotos: boolean;
  photoCount: number;
  onError?: (message: string) => void;
}

export function StopChecklist({ tasks, locked, stopId, requiresPhotos, photoCount, onError }: Props) {
  const t = useT();
  const { colors } = useTheme();
  useDb();
  const [saving, setSaving] = useState<string | null>(null);
  const sorted = tasks.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  // Which tasks already have their own photo (saved, or still on its way up).
  const withPhoto = new Set((rowsOf('maintenance_photos') as unknown as { stopId: string; taskId?: string }[]).filter((p) => p.stopId === stopId && p.taskId).map((p) => p.taskId as string));

  async function toggle(task: MaintenanceStopTask) {
    if (locked || saving) return;
    haptics.light();
    if (!task.completedAt && requiresPhotos) {
      // One photo per task. Without its own photo the task is not ticked: the photo is asked for, and the task ticks when it is saved.
      if (!withPhoto.has(task.id)) {
        setSaving(task.id);
        await askForTaskPhoto(stopId, true, task.id);
        setSaving(null);
        return;
      }
    } else if (!task.completedAt && photoCount === 0) {
      setSaving(task.id);
      const go = await askForTaskPhoto(stopId, false);
      setSaving(null);
      if (!go) return;
    }
    setSaving(task.id);
    const res = await setTaskDone(task.id, !task.completedAt);
    setSaving(null);
    if (!res.ok) onError?.(res.error);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
      {sorted.map((task, i) => {
        const done = !!task.completedAt;
        const by = task.completedBy ? db.people[task.completedBy] : undefined;
        return (
          <PressableScale
            key={task.id}
            onPress={() => toggle(task)}
            disabled={locked}
            haptic={false}
            scaleTo={0.98}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done, disabled: locked }}
            accessibilityLabel={task.title}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
          >
            <View style={[styles.box, done
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { borderColor: colors.border }]}
            >
              {saving === task.id
                ? <ActivityIndicator size="small" color={done ? '#FFFFFF' : colors.primary} />
                : done && <Icon name="check" size={16} color="#FFFFFF" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }, done && { color: colors.textSecondary }]}>
                {task.title}
              </Text>
              {done ? (
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                  {by ? `${by.firstName} · ` : ''}{clockTime(task.completedAt!)}
                </Text>
              ) : requiresPhotos ? (
                <Text style={[typeScale.caption, { color: withPhoto.has(task.id) ? colors.warning : colors.textTertiary, marginTop: 2 }]}>
                  {withPhoto.has(task.id) ? t('Photo saving. This task ticks when it is saved.') : t('Needs its own photo')}{!task.isRequired ? ` · ${t('Optional')}` : ''}
                </Text>
              ) : !task.isRequired ? (
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{t('Optional')}</Text>
              ) : null}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 52 },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
