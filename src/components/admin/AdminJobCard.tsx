import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useRouter } from 'expo-router';
import { WorkerProvider } from '@/providers/WorkerProvider';
import { WorkdayCard } from '@/components/time/WorkdayCard';
import { db, updateRow, useDb } from '@/data/store';
import { todayKey } from '@/lib/ids';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

/**
 * An ADMIN who is put on a job works it like any worker: this card on their dashboard shows the job, lets them confirm it, has the
 * workday clock (Clock In / Clock Out), and opens the full worker view (Today, Jobs, finishing the work). It shows nothing for the owner,
 * nor when the admin has no job today. (An admin's login role is 'owner' for routing; their real role is db.role.)
 */
export function AdminJobCard() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const t = useT();
  const router = useRouter();
  const v = useDb();
  const today = todayKey();
  const mine = useMemo(
    () => (db.role === 'admin' ? db.assignments.filter((a) => a.personId === user?.id && a.scheduledDate === today && !['completed', 'cancelled', 'reassigned'].includes(a.status)) : []),
    [v, user?.id, today],
  );
  if (!mine.length) return null;

  return (
    <WorkerProvider>
      <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t('Your job today')}</Text>
        {mine.map((a) => {
          const confirmed = a.confirmationState === 'confirmed';
          return (
            <View key={a.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{a.project?.name ?? t('Job')}</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{a.isFullDay ? t('Full Day') : `${a.startTime ?? ''} – ${a.endTime ?? ''}`}</Text>
              </View>
              {confirmed ? (
                <Text style={[typeScale.labelSmall, { color: colors.primary }]}>{t('Confirmed')}</Text>
              ) : (
                <Pressable
                  onPress={() => { haptics.select(); updateRow('assignments', a.id, { confirmationState: 'confirmed' }); }}
                  accessibilityRole="button"
                  style={[styles.confirm, { backgroundColor: colors.primaryDark }]}
                >
                  <Text style={[typeScale.labelSmall, { color: '#FFFFFF' }]}>{t('Confirm')}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
        <WorkdayCard compact />
        <Pressable onPress={() => { haptics.select(); router.push('/(worker)/(tabs)' as any); }} accessibilityRole="button" style={[styles.open, { borderColor: colors.primary }]}>
          <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Open my worker view')}</Text>
        </Pressable>
      </View>
    </WorkerProvider>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  open: { minHeight: 44, borderRadius: radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  confirm: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full },
});
