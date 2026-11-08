import { PhotoPager } from '@/components/media/PhotoPager';
import { removeStopPhoto } from '@/data/maintenance';
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { Avatar, EmptyState, OptimizedImage, ProgressBar, ScreenHeader, StatusBadge } from '@/components/ui';
import { LocationTag, Pill, ROUTE_STATUS, STOP_STATUS, SectionTitle, formatServiceDate } from '@/components/maintenance/ReviewBits';
import { TimeCorrectionSheet } from '@/components/maintenance/TimeCorrectionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useMaintenance, useMaintenanceRoute } from '@/hooks/useMaintenance';
import { db, useDb } from '@/data/store';
import { useWorkdaysOn } from '@/hooks/useClockedInToday';
import { PrivatePhoto } from '@/components/media/PrivatePhoto';
import { correctAttendance, locationLabel, setRouteLead, setRoutePhotoRule, setStopPhotoShared, updateStop } from '@/data/maintenance';
import { PhotoRuleEditor } from '@/components/maintenance/PhotoRuleEditor';
import {
  buildRouteReview, correctStopTime, describeEvent, formatTime,
  type AttendanceReview, type RecordedTime, type StopReview, type StopTimeKind,
} from '@/data/maintenanceReview';
import { todayKey } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { PersonSummary } from '@/types/company';

/** How many activity rows show before "Show all". */
const ACTIVITY_PREVIEW = 8;

type Fix =
  | { kind: StopTimeKind; review: StopReview }
  | { kind: 'attendance'; row: AttendanceReview };

const fullName = (p?: PersonSummary) => (p ? `${p.firstName} ${p.lastName}`.trim() : 'Someone');

/**
 * Owner route review: date, crew and optional lead, each stop in the saved
 * order with arrival / finish (who and when, and how well GPS verified it),
 * checklist and photos, each worker's day start, and anything that needs a
 * look. The owner can correct a time; the crew's record is kept next to it.
 */
export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const tabBarClearance = useTabBarClearance();
  const route = useMaintenanceRoute(id);
  const m = useMaintenance();
  const v = useDb();
  const today = todayKey();
  const [fix, setFix] = useState<Fix | null>(null);
  const workdays = useWorkdaysOn(route?.serviceDate ?? today);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const review = useMemo(
    () => (route ? buildRouteReview(route, m.events, m.attendance, db.people, today) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route, m, v, today],
  );
  const activity = useMemo(() => {
    if (!route) return [];
    const stopIds = new Set(route.stops.map((s) => s.id));
    const crew = new Set(route.crewIds);
    return m.events
      .filter((e) => e.routeId === route.id || (e.stopId && stopIds.has(e.stopId))
        || (e.eventType === 'correction' && e.metadata?.kind === 'attendance' && e.metadata?.service_date === route.serviceDate && crew.has(String(e.metadata?.worker_id))))
      .slice()
      .reverse();
  }, [route, m]);

  if (!route || !review) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
        <ScreenHeader title="Route" />
        <EmptyState icon="map" title="Route not found" description="It may have been deleted." actionTitle="Back to Routes" onAction={() => router.back()} />
      </View>
    );
  }

  const total = route.stops.length;
  const finished = route.stops.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const status = ROUTE_STATUS[route.status];
  const goHistory = (propertyId: string) => router.push(`/(owner)/maintenance/history/${propertyId}` as any);
  const shownActivity = showAllActivity ? activity : activity.slice(-ACTIVITY_PREVIEW);

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader
        title={formatServiceDate(route.serviceDate, { relative: true, today })}
        subtitle={[route.name, formatServiceDate(route.serviceDate)].filter(Boolean).join(' · ')}
      />
      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance + spacing['3xl'] }]}>
        {/* Summary */}
        <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
          <View style={styles.rowBetween}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
              {route.completedCount} of {total} stop{total === 1 ? '' : 's'} finished
            </Text>
            <StatusBadge label={status.label} status={status.status} />
          </View>
          <ProgressBar progress={total ? (finished / total) * 100 : 0} style={{ marginTop: spacing.sm }} />
          {route.notes ? (
            <View style={[styles.noteBox, { backgroundColor: colors.groupedBackground }]}>
              <Icon name="file-text" size={14} color={colors.textSecondary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{route.notes}</Text>
            </View>
          ) : null}
          <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.md }]}>
            {route.lead ? `Crew leader: ${fullName(route.lead)}` : 'No crew leader chosen yet'}
          </Text>
        </View>

        {/* The crew leader: the only worker who checks the crew in and finishes each stop. Every route needs one, chosen by you. */}
        {route.status !== 'cancelled' && route.status !== 'completed' ? (
          <>
            <SectionTitle>CREW LEADER</SectionTitle>
            <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, { gap: spacing.sm }]}>
              {!route.lead ? (
                <View style={[styles.noteBox, { backgroundColor: colors.warningLight ?? colors.groupedBackground }]}>
                  <Icon name="alert-triangle" size={14} color={colors.warning} />
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>
                    This route has no crew leader, so nobody on the crew can check in at its properties yet. Choose one below.
                  </Text>
                </View>
              ) : (
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Only the leader (and you) can tap I'M HERE and finish each stop.</Text>
              )}
              {route.crewIds.length === 0 ? (
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>Put people on the crew first, then choose the leader from them.</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                  {route.crewIds.map((pid) => {
                    const p = db.people[pid];
                    const on = route.lead?.id === pid;
                    return (
                      <Pressable key={pid} accessibilityRole="button" accessibilityState={{ selected: on }}
                        onPress={async () => { const r = await setRouteLead(route.id, pid); if (!r.ok) Alert.alert("Couldn't set the leader", r.error); }}
                        style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.lg, backgroundColor: on ? colors.primary : colors.backgroundTertiary }}>
                        <Text style={[typeScale.labelSmall, { color: on ? '#FFFFFF' : colors.textPrimary }]}>{p ? `${p.firstName} ${p.lastName}`.trim() : 'Worker'}{on ? ' · Leader' : ''}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        ) : null}

        {/* Needs attention */}
        {review.attention.length > 0 && (
          <>
            <SectionTitle>{`NEEDS ATTENTION (${review.attention.length})`}</SectionTitle>
            <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, { gap: spacing.sm }]}>
              {review.attention.map((a) => (
                <View key={a.key} style={styles.attentionRow}>
                  <Icon name="alert-circle" size={16} color={a.tone === 'error' ? colors.error : colors.warning} />
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{a.text}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Crew attendance */}
        <SectionTitle>{workdays.known ? 'CREW · CLOCKED IN' : 'CREW · START OF DAY'}</SectionTitle>
        <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, { paddingVertical: spacing.xs }]}>
          {review.attendance.length === 0 ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, paddingVertical: spacing.md }]}>
              No crew assigned to this route.
            </Text>
          ) : workdays.known ? review.attendance.map((row, i) => {
            // With the time clock on, each worker clocks in on their own; this shows that workday (fix times in Hours & Labor).
            const w = workdays.byPerson.get(row.personId);
            return (
              <View key={row.personId} style={[styles.attRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
                {row.person ? <Avatar firstName={row.person.firstName} lastName={row.person.lastName} uri={row.person.avatarUrl} size={36} /> : <View style={{ width: 36 }} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.inline}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{fullName(row.person)}</Text>
                    {row.isLead && <Pill label="Crew leader" tone="success" />}
                  </View>
                  <Text style={[typeScale.bodySmall, { color: w ? colors.textPrimary : colors.textSecondary }]}>
                    {w ? (w.clockOutAt ? `Clocked in ${formatTime(w.clockInAt)} · out ${formatTime(w.clockOutAt)}` : `Clocked in ${formatTime(w.clockInAt)} · on the clock`) : 'Not clocked in'}
                  </Text>
                </View>
              </View>
            );
          }) : review.attendance.map((row, i) => (
            <AttendanceRowView
              key={row.personId}
              row={row}
              first={i === 0}
              canFix={route.serviceDate <= today && route.status !== 'cancelled'}
              onFix={() => setFix({ kind: 'attendance', row })}
            />
          ))}
        </View>

        {/* Photos: one rule for the whole route, or each stop on its own below */}
        {route.status !== 'cancelled' && route.stops.some((s) => s.status === 'pending' || s.status === 'arrived') ? (() => {
          const open = route.stops.filter((s) => s.status === 'pending' || s.status === 'arrived');
          const allOn = open.every((s) => s.requiresPhotos);
          const allOff = open.every((s) => !s.requiresPhotos);
          const counts = new Set(open.filter((s) => s.requiresPhotos).map((s) => s.minPhotos));
          const same = (allOn || allOff) && counts.size <= 1;
          const count = counts.size === 1 ? [...counts][0] : 1;
          return (
            <>
              <SectionTitle>PHOTOS FOR THE WHOLE ROUTE</SectionTitle>
              <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, { paddingVertical: spacing.xs, marginBottom: spacing.md }]}>
                <PhotoRuleEditor
                  label="Photos required at every stop"
                  on={allOn}
                  count={count}
                  onChange={(on, n) => setRoutePhotoRule(route.id, on, n)}
                  hint={same ? 'This sets every stop that is not finished. You can still change one stop below. With photos on, the crew takes one photo for each task.' : 'Your stops have different photo settings. Changing this sets all of them the same. Or change one stop below.'}
                />
              </View>
            </>
          );
        })() : null}

        {/* Stops */}
        <SectionTitle>{`STOPS IN ROUTE ORDER (${total})`}</SectionTitle>
        {review.stops.length === 0 ? (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginHorizontal: spacing.xs }]}>This route has no stops.</Text>
        ) : review.stops.map((s) => (
          <StopCard
            key={s.stop.id}
            review={s}
            canFix={route.status !== 'cancelled' && route.serviceDate <= today}
            onFix={(kind) => setFix({ kind, review: s })}
            onOpenProperty={() => goHistory(s.stop.propertyId)}
          />
        ))}

        {/* Activity */}
        <SectionTitle
          right={activity.length > ACTIVITY_PREVIEW ? (
            <Pressable onPress={() => setShowAllActivity((x) => !x)} hitSlop={8} accessibilityRole="button">
              <Text style={[typeScale.labelSmall, { color: colors.primary }]}>{showAllActivity ? 'Show less' : `Show all ${activity.length}`}</Text>
            </Pressable>
          ) : undefined}
        >
          ACTIVITY
        </SectionTitle>
        <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
          {activity.length === 0 ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>Nothing recorded yet.</Text>
          ) : shownActivity.map((e, i) => (
            <View key={e.id} style={[styles.activityRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
              <Text style={[typeScale.caption, { color: colors.textSecondary, width: 64 }]}>{formatTime(e.occurredAt)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>{describeEvent(e, route)}</Text>
                {e.eventType === 'correction' && e.note ? (
                  <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>“{e.note}”</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.md, marginHorizontal: spacing.xs }]}>
          Times are when each tap reached the app. Locations come from the worker’s phone and are only called GPS verified when the phone reported a precise position inside the property’s check-in area.
        </Text>
      </ScrollView>

      <TimeCorrectionSheet
        visible={!!fix}
        title={fix?.kind === 'attendance' ? 'Set Day Start' : fix?.kind === 'completion' ? 'Correct Finish Time' : 'Correct Arrival Time'}
        description={fixDescription(fix)}
        dateKey={route.serviceDate}
        initial={fixInitial(fix)}
        onClose={() => setFix(null)}
        onSave={(at, note) => {
          if (!fix) return Promise.resolve({ ok: false as const, error: 'Nothing to correct.' });
          if (fix.kind === 'attendance') return correctAttendance(fix.row.personId, route.serviceDate, at, note);
          return correctStopTime(fix.review.stop.id, fix.kind, at, note);
        }}
      />
    </View>
  );
}

function fixInitial(fix: Fix | null): string | undefined {
  if (!fix) return undefined;
  if (fix.kind === 'attendance') return fix.row.attendance?.startedAt;
  const t = fix.kind === 'arrival' ? fix.review.arrival : fix.review.completion;
  return t.correction?.at ?? t.at ?? (fix.kind === 'arrival' ? fix.review.arrivals[0]?.at : undefined);
}

function fixDescription(fix: Fix | null): string {
  if (!fix) return '';
  if (fix.kind === 'attendance') {
    const who = fix.row.person?.firstName ?? 'This worker';
    const a = fix.row.attendance;
    if (!a) return `${who} didn’t tap Start Day. Set the time they actually started.`;
    return `${who} tapped Start Day at ${formatTime(a.originalStartedAt ?? a.startedAt)}${a.originalStartedAt ? ` (already corrected to ${formatTime(a.startedAt)})` : ''}.`;
  }
  const name = fix.review.stop.property?.name ?? 'this stop';
  const t = fix.kind === 'arrival' ? fix.review.arrival : fix.review.completion;
  const what = fix.kind === 'arrival' ? 'arrival' : 'finish';
  if (!t.at) return `No ${what} was recorded at ${name}. Set the time the crew actually ${fix.kind === 'arrival' ? 'arrived' : 'finished'}.`;
  return `${fullName(t.by)} recorded the ${what} at ${name} at ${formatTime(t.at)} (${locationLabel(t.locationStatus)}).`;
}

function AttendanceRowView({ row, first, canFix, onFix }: {
  row: AttendanceReview; first: boolean; canFix: boolean; onFix: () => void;
}) {
  const { colors } = useTheme();
  const a = row.attendance;
  return (
    <View style={[styles.attRow, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight }]}>
      {row.person ? (
        <Avatar firstName={row.person.firstName} lastName={row.person.lastName} uri={row.person.avatarUrl} size={36} />
      ) : <View style={{ width: 36 }} />}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.inline}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{fullName(row.person)}</Text>
          {row.isLead && <Pill label="Lead" tone="success" />}
        </View>
        {a ? (
          <>
            <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
              Started {formatTime(a.startedAt)}
              {a.source === 'owner_correction' ? ' · entered by owner' : ''}
            </Text>
            {a.source === 'worker' && <LocationTag status={a.locationStatus} />}
            {a.correctedAt && (
              <Text style={[typeScale.caption, { color: colors.warning }]}>
                Corrected by {fullName(a.correctedBy ? db.people[a.correctedBy] : undefined)}
                {a.originalStartedAt ? ` · worker tapped ${formatTime(a.originalStartedAt)}` : ''}
                {a.correctionNote ? ` · “${a.correctionNote}”` : ''}
              </Text>
            )}
          </>
        ) : (
          <Text style={[typeScale.bodySmall, { color: row.workedWithoutStart ? colors.warning : colors.textSecondary }]}>
            {row.workedWithoutStart ? 'Didn’t start the day at the yard' : 'Hasn’t started the day'}
          </Text>
        )}
      </View>
      {canFix && (
        <Pressable onPress={onFix} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Set day start for ${fullName(row.person)}`}>
          <Text style={[typeScale.labelSmall, { color: colors.primary }]}>{a ? 'Correct' : 'Set time'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function TimeLine({ label, t, emptyText }: { label: string; t: RecordedTime; emptyText: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.timeLine}>
      <Text style={[typeScale.caption, { color: colors.textSecondary, width: 64 }]}>{label}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        {t.at ? (
          <>
            <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
              {formatTime(t.at)} · {fullName(t.by)}
            </Text>
            <LocationTag status={t.locationStatus} />
          </>
        ) : (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{emptyText}</Text>
        )}
        {t.correction && (
          <Text style={[typeScale.caption, { color: colors.warning }]}>
            Corrected to {formatTime(t.correction.at)} by {fullName(t.correction.by)}
            {t.correction.note ? ` · “${t.correction.note}”` : ''}
          </Text>
        )}
      </View>
    </View>
  );
}

function StopCard({ review, canFix, onFix, onOpenProperty }: {
  review: StopReview; canFix: boolean; onFix: (kind: StopTimeKind) => void; onOpenProperty: () => void;
}) {
  const { colors } = useTheme();
  const { stop } = review;
  const [viewing, setViewing] = useState<string | null>(null);
  const st = STOP_STATUS[stop.status];
  const p = stop.property;
  const otherArrivals = review.arrivals.filter((a) => a.personId !== stop.arrivedBy);
  const requiredTasks = stop.tasks.filter((t) => t.isRequired).length;

  return (
    <View style={[styles.card, styles.stopCard, { backgroundColor: colors.surface }, shadow.sm]}>
      <View style={styles.stopHead}>
        <View style={[styles.stopNumber, { backgroundColor: stop.status === 'completed' ? colors.primary : colors.groupedBackground }]}>
          {stop.status === 'completed'
            ? <Icon name="check" size={16} color="#FFFFFF" />
            : <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{stop.number}</Text>}
        </View>
        <Pressable onPress={onOpenProperty} style={{ flex: 1 }} accessibilityRole="button" accessibilityLabel={`${p?.name ?? 'Property'} service history`}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={2}>{p?.name ?? 'Property'}</Text>
          {p && (
            <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
              {[p.address, p.city].filter(Boolean).join(', ')}
            </Text>
          )}
        </Pressable>
        <StatusBadge label={st.label} status={st.status} />
      </View>

      {stop.services.length > 0 && (
        <View style={styles.chips}>
          {stop.services.map((s) => <Pill key={s.id} label={s.label} tone={s.completed ? 'success' : 'neutral'} />)}
        </View>
      )}

      {stop.instructions ? (
        <View style={[styles.noteBox, { backgroundColor: colors.warningLight }]}>
          <Icon name="alert-triangle" size={14} color={colors.warning} />
          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>{stop.instructions}</Text>
        </View>
      ) : null}

      <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

      <TimeLine label="Arrived" t={review.arrival} emptyText={review.finishedWithoutArrival ? 'No I’m Here recorded' : 'Not yet'} />
      {otherArrivals.map((a) => (
        <View key={`${a.personId}-${a.at}`} style={styles.timeLine}>
          <View style={{ width: 64 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
              {fullName(a.person)} also tapped I’m Here at {formatTime(a.at)}
            </Text>
            <LocationTag status={a.locationStatus} />
          </View>
        </View>
      ))}
      {stop.status === 'skipped' ? (
        <View style={styles.timeLine}>
          <Text style={[typeScale.caption, { color: colors.textSecondary, width: 64 }]}>Skipped</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>
            {stop.skippedAt ? formatTime(stop.skippedAt) : ''}
            {stop.skippedBy ? ` · ${fullName(db.people[stop.skippedBy])}` : ''}
            {stop.skipReason ? ` · “${stop.skipReason}”` : ''}
          </Text>
        </View>
      ) : (
        <TimeLine label="Finished" t={review.completion} emptyText="Not yet" />
      )}
      {stop.completionNote ? (
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: 64 }]}>Crew note: “{stop.completionNote}”</Text>
      ) : null}

      {(stop.tasks.length > 0 || stop.requiresPhotos || stop.photos.length > 0) && (
        <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
      )}

      {stop.tasks.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
            Checklist · {review.tasksDone} of {stop.tasks.length} done{requiredTasks < stop.tasks.length ? ` (${requiredTasks} required)` : ''}
          </Text>
          {stop.tasks.map((t) => (
            <View key={t.id} style={styles.inline}>
              <Icon name={t.completedAt ? 'check-square' : 'square'} size={14} color={t.completedAt ? colors.success : colors.textTertiary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>
                {t.title}{!t.isRequired ? ' (optional)' : ''}
              </Text>
              {t.completedAt && (
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                  {fullName(t.completedBy ? db.people[t.completedBy] : undefined).split(' ')[0]} · {formatTime(t.completedAt)}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {(stop.requiresPhotos || stop.photos.length > 0) && (
        <View style={{ gap: spacing.xs, marginTop: stop.tasks.length ? spacing.sm : 0 }}>
          <Text style={[typeScale.caption, { color: stop.requiresPhotos && review.photoCount < stop.minPhotos && stop.status === 'completed' ? colors.warning : colors.textSecondary }]}>
            Photos · {review.photoCount}{stop.requiresPhotos ? ` of ${stop.minPhotos} required` : ''} · internal only unless you share them (the customer sees shared photos once the stop is finished)
          </Text>
          {stop.photos.length > 0 && stop.status === 'completed' ? (
            <Pressable
              onPress={() => {
                const shareAll = stop.photos.some((ph) => !ph.isCustomerVisible);
                for (const ph of stop.photos) if (ph.isCustomerVisible !== shareAll) setStopPhotoShared(ph.id, shareAll);
              }}
              hitSlop={6}
              accessibilityRole="button"
              style={[styles.shareAll, { borderColor: colors.primary }]}
            >
              <Icon name={stop.photos.some((ph) => !ph.isCustomerVisible) ? 'eye' : 'lock'} size={13} color={colors.primary} />
              <Text style={[typeScale.labelSmall, { color: colors.primary }]}>
                {stop.photos.some((ph) => !ph.isCustomerVisible) ? 'Share all photos with the customer' : 'Make all photos internal'}
              </Text>
            </Pressable>
          ) : null}
          {stop.photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
              {stop.photos.map((ph) => (
                <View key={ph.id} style={{ alignItems: 'center', gap: 4 }}>
                  <Pressable onPress={() => setViewing(ph.id)} accessibilityRole="button" accessibilityLabel="Open photo">
                    <PrivatePhoto fileUrl={ph.fileUrl} fileKey={ph.fileKey} style={styles.thumb as never} accessibilityLabel={ph.caption ?? 'Stop photo'} />
                  </Pressable>
                  <Pressable
                    onPress={() => setStopPhotoShared(ph.id, !ph.isCustomerVisible)}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={ph.isCustomerVisible ? 'Shared with the customer. Tap to make it internal.' : 'Internal. Tap to share with the customer.'}
                    style={[styles.sharePill, ph.isCustomerVisible ? { backgroundColor: colors.primary, borderColor: colors.primary } : { borderColor: colors.border }]}
                  >
                    <Icon name={ph.isCustomerVisible ? 'eye' : 'lock'} size={12} color={ph.isCustomerVisible ? '#FFFFFF' : colors.textSecondary} />
                    <Text style={[typeScale.caption, { color: ph.isCustomerVisible ? '#FFFFFF' : colors.textSecondary, fontWeight: '700' }]}>
                      {ph.isCustomerVisible ? 'Customer sees' : 'Internal'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {stop.status === 'pending' || stop.status === 'arrived' ? (
        <>
          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
          <PhotoRuleEditor
            label="Photos required here"
            on={stop.requiresPhotos}
            count={stop.minPhotos}
            onChange={(on, n) => updateStop(stop.id, { requiresPhotos: on, minPhotos: n })}
            hint="Just this property. With photos on, the crew takes one photo for each task."
          />
        </>
      ) : null}

      {canFix && stop.status !== 'skipped' && (
        <View style={styles.actions}>
          <Pressable onPress={() => onFix('arrival')} hitSlop={8} accessibilityRole="button">
            <Text style={[typeScale.labelSmall, { color: colors.primary }]}>{stop.arrivedAt || review.arrival.correction ? 'Correct arrival' : 'Set arrival time'}</Text>
          </Pressable>
          {stop.status === 'completed' && (
            <Pressable onPress={() => onFix('completion')} hitSlop={8} accessibilityRole="button">
              <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Correct finish</Text>
            </Pressable>
          )}
          <Pressable onPress={onOpenProperty} hitSlop={8} accessibilityRole="button" style={{ marginLeft: 'auto' }}>
            <Text style={[typeScale.labelSmall, { color: colors.textSecondary }]}>Service history</Text>
          </Pressable>
        </View>
      )}
      <PhotoPager
        photos={stop.photos.map((ph) => ({ id: ph.id, url: ph.fileUrl, key: ph.fileKey }))}
        startId={viewing}
        onClose={() => setViewing(null)}
        actionsFor={(ph) => [{
          key: 'delete', label: 'Delete', icon: 'trash-2', destructive: true,
          onPress: () => Alert.alert('Delete this photo?', 'It is removed from this stop for good.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => removeStopPhoto(ph.id) }]),
        }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  card: { borderRadius: radius.md, padding: spacing.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  noteBox: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, marginTop: spacing.md, alignItems: 'flex-start' },
  attentionRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  attRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stopCard: { marginBottom: spacing.md, gap: spacing.sm },
  stopHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stopNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth },
  timeLine: { flexDirection: 'row', alignItems: 'flex-start' },
  thumb: { width: 64, height: 64, borderRadius: radius.sm },
  sharePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full, borderWidth: 1 },
  shareAll: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.xs },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm },
});
