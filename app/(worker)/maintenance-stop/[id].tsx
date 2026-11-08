/**
 * One maintenance stop, for the crew: where it is, what to do, the visit's
 * checklist and photos, and the fixed bottom action (I'M HERE, then FINISH
 * STOP). Everything here is the shared stop record, so a crewmate's ticks,
 * photos and finish show up for everyone.
 */

import { ReportProblemButton } from '@/components/issues/ReportProblemButton';
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/providers/ThemeProvider';
import { GlassIconButton, Icon, InlineNotice, PressableScale } from '@/components/ui';
import { StopChecklist, clockTime } from '@/components/maintenance/StopChecklist';
import { StopPhotos } from '@/components/maintenance/StopPhotos';
import { FinishStopButton } from '@/components/maintenance/FinishStopButton';
import { db, useDb } from '@/data/store';
import { markArrived, locationLabel } from '@/data/maintenance';
import { crewStopMessage, isCrewLeader } from '@/lib/maintenanceLeader';
import { finishStopAndAdvance, missingRequirements, nextStopAfter, uploadingPhotoCount } from '@/data/maintenanceFinish';
import { getCurrentGps } from '@/lib/location';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { withTimedPhoto } from '@/data/timePhotos';
import { SkipRequestSheet } from '@/components/time/SkipRequestSheet';
import { loadMySkipRequests, requestSkip, type MySkipRequest } from '@/data/timeTracking';
import { openDirections } from '@/lib/maps';
import { haptics } from '@/lib/haptics';
import { useT, tr } from '@/i18n';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const nameOf = (personId?: string) => {
  const p = personId ? db.people[personId] : undefined;
  return p ? `${p.firstName} ${p.lastName}`.trim() : tr('A crew member');
};

export default function MaintenanceStopScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const v = useDb();
  const [arriving, setArriving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { timeOn, workday } = useWorkerContext();
  const [skips, setSkips] = useState<MySkipRequest[]>([]);
  const [skipOpen, setSkipOpen] = useState(false);
  useEffect(() => {
    if (!timeOn) return;
    let live = true;
    loadMySkipRequests().then((r) => { if (live && r.ok) setSkips(r.data); });
    return () => { live = false; };
  }, [timeOn, id]);

  const stop = id ? db.maintenance.stopById[id] : undefined;
  const route = stop ? db.maintenance.routeById[stop.routeId] : undefined;
  const missing = useMemo(() => (stop ? missingRequirements(stop) : []), [v, stop, t]);
  const next = useMemo(() => (stop ? nextStopAfter(stop) : undefined), [v, stop]);

  if (!stop || !route) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerRow}>
          <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel={t('Back')} />
        </View>
        <View style={styles.center}>
          <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>{t("This stop isn't on your route.")}</Text>
        </View>
      </View>
    );
  }

  const p = stop.property;
  const locked = stop.status === 'completed' || stop.status === 'skipped';
  const required = stop.tasks.filter((task) => task.isRequired);
  const addressLine = [p?.address, p?.city, p?.state].filter(Boolean).join(', ');
  // Stops are worked in order: a later stop stays locked until the one before it is done (the database enforces it too).
  const isStaff = db.role === 'owner' || db.role === 'admin';
  const blockedBy = !isStaff && stop.status === 'pending' ? route.stops.find((s) => s.number < stop.number && (s.status === 'pending' || s.status === 'arrived')) : undefined;
  const mySkip = skips.find((s) => s.refId === stop.id && s.status === 'pending');
  const clockedIn = !timeOn || !!workday.active;
  // Only the crew leader (or owner/admin) checks the crew in and finishes the stop; everyone else sees the status.
  const leader = isCrewLeader({ leadId: route.lead?.id, personId: db.personId, role: db.role });
  const leaderName = route.lead ? `${route.lead.firstName} ${route.lead.lastName}`.trim() : undefined;

  async function sendSkip(reason: string) {
    const r = await requestSkip('maintenance_stop', stop!.id, reason);
    if (!r.ok) { setError(r.error); return; }
    haptics.success();
    setSkipOpen(false);
    const again = await loadMySkipRequests();
    if (again.ok) setSkips(again.data);
  }

  async function handleArrive() {
    setError(null);
    setArriving(true);
    haptics.light();
    // Never blocked by GPS: whatever the phone reports (or doesn't) is recorded honestly.
    const gps = await Promise.race([getCurrentGps(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 6000))]);
    const res = await withTimedPhoto(() => markArrived(stop!.id, gps), 'start', { kind: 'maintenance', stopId: stop!.id });
    setArriving(false);
    if (res.ok) haptics.success();
    else setError(res.error);
  }

  async function handleFinish() {
    setError(null);
    const res = await finishStopAndAdvance(stop!.id);
    if (res.ok) {
      haptics.success();
    } else {
      haptics.warning();
      if (res.error) setError(res.error);
    }
  }

  function goNext() {
    if (next) router.replace(`/(worker)/maintenance-stop/${next.id}`);
    else router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false}
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: 220 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel={t('Back')} />
          <Text style={[typeScale.labelLarge, { color: colors.textSecondary, flex: 1, textAlign: 'center' }]}>
            {t('Stop {n} of {total}', { n: stop.number, total: route.stops.length })}
          </Text>
          <View style={{ width: 44 }} />
        </View>

        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>{p?.name ?? t('Property')}</Text>
        {!!addressLine && (
          <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: 4 }]}>{addressLine}</Text>
        )}

        {!!p && !locked && (
          <PressableScale
            onPress={() => openDirections({ ...p, latitude: p.latitude, longitude: p.longitude }, db.workerSettings.navApp)}
            accessibilityRole="button"
            accessibilityLabel={t('Directions')}
            style={[styles.directions, { borderColor: colors.primary }]}
          >
            <Icon name="navigation" size={16} color={colors.primary} />
            <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Directions')}</Text>
          </PressableScale>
        )}

        {/* Status */}
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {stop.status === 'completed' && stop.completedAt && (
            <InlineNotice
              icon="check-circle"
              tone="success"
              text={`${t('Finished by {name} at {time}', { name: nameOf(stop.completedBy), time: clockTime(stop.completedAt) })} · ${t(locationLabel(stop.completionLocationStatus))}`}
            />
          )}
          {stop.status === 'skipped' && (
            <InlineNotice icon="slash" tone="neutral" text={stop.skipReason ? t('Skipped: {reason}', { reason: stop.skipReason }) : t('Skipped')} />
          )}
          {stop.arrivedAt && (
            <InlineNotice
              icon="map-pin"
              tone={stop.arrivalLocationStatus === 'verified' ? 'success' : 'neutral'}
              text={`${t('Arrived {time}', { time: clockTime(stop.arrivedAt) })} · ${nameOf(stop.arrivedBy)} · ${t(locationLabel(stop.arrivalLocationStatus))}`}
            />
          )}
        </View>

        {/* Services */}
        {stop.services.length > 0 && (
          <Section title={t('Services')}>
            <View style={styles.chips}>
              {stop.services.map((s) => (
                <View key={s.id} style={[styles.chip, { backgroundColor: colors.primarySurface }]}>
                  {s.completed && <Icon name="check" size={12} color={colors.primaryDark} />}
                  <Text style={[typeScale.bodySmall, { color: colors.primaryDark, fontWeight: '600' }]}>{s.label}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {/* This visit's instructions, then the property's standing notes */}
        {!!stop.instructions && (
          <Section title={t('For this visit')}>
            <View style={[styles.note, { backgroundColor: colors.warningLight }]}>
              <Icon name="alert-circle" size={16} color={colors.warning} />
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, flex: 1 }]}>{stop.instructions}</Text>
            </View>
          </Section>
        )}
        {!!route.notes && (
          <Section title={t('Route notes')}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{route.notes}</Text>
          </Section>
        )}
        {!!p?.accessNotes && (
          <Section title={t('Access')}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{p.accessNotes}</Text>
          </Section>
        )}

        {stop.tasks.length > 0 && (
          <Section title={required.length ? t('Checklist · {done} of {total} required', { done: required.filter((task) => task.completedAt).length, total: required.length }) : t('Checklist')}>
            <StopChecklist tasks={stop.tasks} locked={locked} stopId={stop.id} requiresPhotos={stop.requiresPhotos} photoCount={stop.photos.length} onError={setError} />
          </Section>
        )}

        {(stop.requiresPhotos || stop.photos.length > 0 || !locked) && (
          <Section title={t('Photos')}>
            <StopPhotos
              stopId={stop.id}
              photos={stop.photos}
              requiresPhotos={stop.requiresPhotos}
              minPhotos={stop.minPhotos}
              locked={locked}
            />
          </Section>
        )}

        {timeOn && !locked ? (
          <View style={{ marginTop: spacing.xl }}>
            {mySkip ? (
              <InlineNotice icon="clock" tone="neutral" text={t('Skip requested. Waiting for the owner. This property is still open until they approve it.')} />
            ) : (
              <Pressable onPress={() => setSkipOpen(true)} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
                <Text style={[typeScale.labelLarge, { color: colors.textSecondary }]}>{t("Can't service this property? Ask to skip it")}</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        <View style={{ marginTop: spacing.xl }}>
          <ReportProblemButton where={{ maintenancePropertyId: stop.propertyId }} />
        </View>
      </ScrollView>

      <SkipRequestSheet visible={skipOpen} propertyName={p?.name} onClose={() => setSkipOpen(false)} onSend={sendSkip} />

      {/* Fixed bottom action */}
      <View
        style={[styles.bottom, {
          paddingBottom: Math.max(insets.bottom, spacing.md),
          backgroundColor: colors.background,
          borderTopColor: colors.borderLight,
        }]}
      >
        {!!error && <InlineNotice icon="alert-triangle" tone="error" text={t(error)} style={{ marginBottom: spacing.sm }} />}
        {!leader && !locked && (
          <InlineNotice icon="users" tone="neutral" text={crewStopMessage(stop.status, leaderName, stop.arrivedAt ? clockTime(stop.arrivedAt) : null, stop.arrivedBy ? nameOf(stop.arrivedBy) : null, !!route.lead)} />
        )}
        {leader && stop.status === 'pending' && !blockedBy && clockedIn && (
          <PrimaryButton
            label={arriving ? t('RECORDING…') : t("I'M HERE")}
            icon="map-pin"
            busy={arriving}
            onPress={handleArrive}
          />
        )}
        {leader && stop.status === 'pending' && blockedBy && (
          <InlineNotice icon="lock" tone="neutral" text={t('Finish {name} first. Stops are worked in order.', { name: blockedBy.property?.name ?? t('stop {n}', { n: blockedBy.number }) })} />
        )}
        {leader && stop.status === 'pending' && !blockedBy && !clockedIn && (
          <InlineNotice icon="clock" tone="neutral" text={t('Clock in first on the Clock tab.')} />
        )}
        {leader && stop.status === 'arrived' && (
          <FinishStopButton stopId={stop.id} missing={missing} uploading={uploadingPhotoCount(stop)} onPress={handleFinish} />
        )}
        {locked && (
          <PrimaryButton
            label={next ? t('NEXT: {name}', { name: next.property?.name ?? t('STOP {n}', { n: next.number }) }) : t('BACK TO ROUTE')}
            icon={next ? 'arrow-right' : 'list'}
            onPress={goNext}
          />
        )}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={[typeScale.overline, { color: colors.textSecondary, marginBottom: spacing.sm }]}>{title}</Text>
      {children}
    </View>
  );
}

function PrimaryButton({ label, icon, onPress, busy }: { label: string; icon: string; onPress: () => void; busy?: boolean }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} disabled={busy} haptic={false} accessibilityRole="button" accessibilityLabel={label}>
      <LinearGradient colors={[colors.primary, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primary}>
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Icon name={icon as any} size={20} color="#FFFFFF" />}
        <Text numberOfLines={1} style={[typeScale.labelLarge, { color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.6, flexShrink: 1 }]}>{label}</Text>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  directions: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start',
    marginTop: spacing.md, paddingHorizontal: spacing.lg, height: 40, borderRadius: radius.full, borderWidth: 1.5,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  note: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'flex-start' },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, borderRadius: radius.full, gap: spacing.sm, paddingHorizontal: spacing.lg },
});
