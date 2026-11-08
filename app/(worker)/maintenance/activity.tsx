import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/providers/ThemeProvider';
import { useMaintenance } from '@/hooks/useMaintenance';
import { db } from '@/data/store';
import { locationLabel } from '@/data/maintenance';
import { localDateKey } from '@/lib/ids';
import { ScreenContainer } from '@/components/layout';
import { EmptyState } from '@/components/ui';
import { formatClock } from '@/components/maintenance/format';
import { daySummary, groupByMonth, isCurrentMonth, monthHeading, monthSummary, todayKey, type FoldDay } from '@/lib/activityFold';
import { typeScale } from '@/theme/typography';
import { useT, tr } from '@/i18n';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { MaintenanceEvent, MaintenanceEventType } from '@/types/maintenance';

const HISTORY_LIMIT = 5000;

const EVENT_META: Partial<Record<MaintenanceEventType, { icon: keyof typeof Feather.glyphMap }>> = {
  day_started: { icon: 'sunrise' },
  arrived: { icon: 'map-pin' },
  task_checked: { icon: 'check-square' },
  photo_added: { icon: 'camera' },
  completed: { icon: 'check-circle' },
  skipped: { icon: 'skip-forward' },
  correction: { icon: 'edit-3' },
};

/** "Maria arrived at" / "You arrived at": the whole phrase is translated (the verb changes with who did it); the property or task follows. */
function eventSentence(t: (text: string, vars?: Record<string, string | number>) => string, type: MaintenanceEventType, isMe: boolean, name: string): string {
  switch (type) {
    case 'day_started': return isMe ? t('You started the day') : t('{name} started the day', { name });
    case 'arrived': return isMe ? t('You arrived at') : t('{name} arrived at', { name });
    case 'task_checked': return isMe ? t('You checked off') : t('{name} checked off', { name });
    case 'photo_added': return isMe ? t('You added a photo at') : t('{name} added a photo at', { name });
    case 'completed': return isMe ? t('You finished') : t('{name} finished', { name });
    case 'skipped': return isMe ? t('You skipped') : t('{name} skipped', { name });
    case 'correction': return isMe ? t('You corrected a time') : t('{name} corrected a time', { name });
    default: return '';
  }
}

function dayHeading(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return tr('Today');
  if (date.toDateString() === yesterday.toDateString()) return tr('Yesterday');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * Maintenance history for the routes this worker was on: day starts,
 * arrivals, finished stops, checklist and photo activity, each with who did
 * it. Unticking a checklist item isn't shown; it's noise in a history.
 */
export default function MaintenanceActivityScreen() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const m = useMaintenance();

  const days = useMemo(() => {
    const myRoutes = new Set(m.routes.filter(r => r.crewIds.includes(db.personId) || r.leadPersonId === db.personId).map(r => r.id));
    const events = m.events
      .filter(e => EVENT_META[e.eventType] && (e.personId === db.personId || (e.routeId && myRoutes.has(e.routeId))))
      .slice(0, HISTORY_LIMIT);
    const groups: { key: string; events: MaintenanceEvent[] }[] = [];
    for (const e of events) {
      const key = localDateKey(new Date(e.occurredAt));
      const last = groups[groups.length - 1];
      if (last?.key === key) last.events.push(e);
      else groups.push({ key, events: [e] });
    }
    return groups;
  }, [m]);

  // Today is open. Earlier days fold to one line, and earlier months fold to one line each. Tap to open any of them.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const today = todayKey();
  const months = useMemo(() => groupByMonth(days), [days]);

  function DayBlock({ day }: { day: FoldDay<MaintenanceEvent> }) {
    const isToday = day.key === today;
    const expanded = isToday || !!open[day.key];
    return (
      <View style={{ marginBottom: spacing.md }}>
        {isToday ? (
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.sm }]}>{dayHeading(day.key)}</Text>
        ) : (
          <FoldHeader title={dayHeading(day.key)} subtitle={daySummary(day.events, t)} open={expanded} onPress={() => toggle(day.key)} />
        )}
        {expanded && (
          <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, !isToday && { marginTop: spacing.sm }]}>
            {day.events.map((e, i) => <EventRow key={e.id} event={e} first={i === 0} />)}
          </View>
        )}
      </View>
    );
  }

  return (
    <ScreenContainer scrollable padded variant="grouped">
      <View style={{ paddingTop: insets.top + spacing.md, marginBottom: spacing.lg }}>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>{t('Activity')}</Text>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{t("Your crew's maintenance work")}</Text>
      </View>

      {days.length === 0 ? (
        <EmptyState icon="activity" title={t('No activity yet')} description={t('Day starts, arrivals and finished stops show up here.')} />
      ) : (
        months.map(month => {
          if (isCurrentMonth(month.key)) return month.days.map(day => <DayBlock key={day.key} day={day} />);
          const expanded = !!open[month.key];
          return (
            <View key={month.key} style={{ marginBottom: spacing.md }}>
              <FoldHeader big title={monthHeading(month.key)} subtitle={monthSummary(month, t)} open={expanded} onPress={() => toggle(month.key)} />
              {expanded && <View style={{ marginTop: spacing.sm, paddingLeft: spacing.sm }}>{month.days.map(day => <DayBlock key={day.key} day={day} />)}</View>}
            </View>
          );
        })
      )}
    </ScreenContainer>
  );
}

function FoldHeader({ title, subtitle, open, onPress, big }: { title: string; subtitle: string; open: boolean; onPress: () => void; big?: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}. ${subtitle}. ${open ? t('Tap to fold') : t('Tap to open')}`}
      style={[styles.fold, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[big ? typeScale.headingSmall : typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{title}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>{subtitle}</Text>
      </View>
      <Feather name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textTertiary} />
    </Pressable>
  );
}

function EventRow({ event, first }: { event: MaintenanceEvent; first: boolean }) {
  const t = useT();
  const { colors } = useTheme();
  const meta = EVENT_META[event.eventType]!;
  const stop = event.stopId ? db.maintenance.stopById[event.stopId] : undefined;
  const isMe = event.personId === db.personId;
  const actor = isMe ? t('You') : event.actor ? event.actor.firstName : t('Someone');
  const sentence = eventSentence(t, event.eventType, isMe, actor);
  // The person's name (or "You") is bold when the sentence starts with it.
  const boldLength = sentence.startsWith(actor) ? actor.length : 0;
  const taskTitle = event.eventType === 'task_checked' ? String(event.metadata?.title ?? t('a checklist item')) : undefined;
  const target = taskTitle ? (stop?.property ? t('{task} at {place}', { task: taskTitle, place: stop.property.name }) : taskTitle) : stop?.property?.name;
  const showLocation = event.eventType === 'day_started' || event.eventType === 'arrived' || event.eventType === 'completed';
  const verified = event.locationStatus === 'verified';

  return (
    <View style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
      <View style={[styles.icon, { backgroundColor: event.eventType === 'completed' ? colors.primarySurface : colors.backgroundTertiary }]}>
        <Feather name={meta.icon} size={15} color={event.eventType === 'completed' ? colors.primaryDark : colors.textSecondary} />
      </View>
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
          <Text style={{ fontWeight: '600' }}>{sentence.slice(0, boldLength)}</Text>{sentence.slice(boldLength)}{target ? ` ${target}` : ''}
        </Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>
          {formatClock(event.occurredAt)}
          {showLocation ? ` · ${verified ? t('GPS verified') : t(locationLabel(event.locationStatus))}` : ''}
          {event.note ? ` · ${event.note}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fold: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 52 },
  card: { borderRadius: radius.xl, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
