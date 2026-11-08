/**
 * Snow media review (Owner) and Snow updates (Customer), update 030.
 * Owner: approve or hide each photo/video of a completed stop, then send the
 * stop to the customer. Customer: completed stops at their properties with
 * the photos the owner sent. Working layout in the existing app style; no
 * approved mockup yet.
 */
import { PhotoPager, type PagerAction } from '@/components/media/PhotoPager';
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Icon, InlineNotice, LoadingSpinner, ScreenHeader, StatusBadge } from '@/components/ui';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { pickSnowMedia } from '@/components/snow/pickSnowMedia';
import { db, useDb } from '@/data/store';
import { useTheme } from '@/providers/ThemeProvider';
import { SERVICE_LABEL } from '@/data/snowStorms';
import {
  addOwnerMedia, deleteMedia, loadReviewQueue, reviewMedia, sendCustomerUpdate, withdrawMedia,
  type ReviewMedia, type ReviewStop,
} from '@/data/snowMediaReview';
import { shortWhen } from '@/lib/snowFormat';
import { SnowUploadStatus } from '@/components/snow/SnowUploadStatus';
import { useSnowUploads } from '@/hooks/useSnowUploads';
import { SNOW_OWNER_MEDIA_TARGET } from '@/data/snowMediaTargets';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const when = shortWhen;

function Thumb({ m, children, onPress }: { m: { kind: string; url?: string }; children?: React.ReactNode; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel="Open photo" style={[styles.thumb, { backgroundColor: colors.borderLight }]}>
      {m.url && m.kind === 'photo' ? <Image source={{ uri: m.url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
        <View style={styles.thumbIcon}><Icon name={m.kind === 'video' ? 'video' : 'image'} size={22} color={colors.textTertiary} /></View>
      )}
      {children}
    </Pressable>
  );
}

/** Owner: Snow More → Photo review. */
export function SnowMediaReviewScreen() {
  useDb();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [stops, setStops] = useState<ReviewStop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // The photo open full screen (tap a thumbnail; swipe for the others of that stop).
  const [viewing, setViewing] = useState<{ visitId: string; mediaId: string } | null>(null);

  const reload = useCallback(async () => {
    const res = await loadReviewQueue();
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setStops(res.data);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // Photos the owner adds upload in the background; when one finishes saving, refresh the list.
  const { saved: savedOwnerPhotos } = useSnowUploads(SNOW_OWNER_MEDIA_TARGET, () => true);
  useEffect(() => { if (savedOwnerPhotos > 0) reload(); }, [savedOwnerPhotos]); // eslint-disable-line react-hooks/exhaustive-deps

  async function review(m: ReviewMedia, status: 'approved' | 'hidden') {
    setBusy(m.id);
    const res = await reviewMedia(m.id, status);
    setBusy(null);
    if (!res.ok) showMessage('Couldn\'t save', res.error);
    reload();
  }

  function withdraw(m: ReviewMedia) {
    confirmAction(
      'Withdraw this photo?',
      "It disappears from the customer's Snow updates and they can no longer open it. If they already saw or saved it, that can't be undone. It can't be sent again.",
      'Withdraw',
      async () => {
        setBusy(m.id);
        const res = await withdrawMedia(m.id);
        setBusy(null);
        if (!res.ok) showMessage("Couldn't withdraw", res.error);
        reload();
      },
      true,
    );
  }

  function remove(m: ReviewMedia) {
    confirmAction(
      'Delete this photo?',
      m.shared ? "It is removed for good, and the customer can no longer see it. This can't be undone." : "It is removed for good. This can't be undone.",
      'Delete',
      async () => {
        setBusy(m.id);
        const res = await deleteMedia(m.id);
        setBusy(null);
        if (!res.ok) showMessage("Couldn't delete", res.error);
        reload();
      },
      true,
    );
  }

  const viewStop = viewing ? stops.find((x) => x.visitId === viewing.visitId) : undefined;
  const viewPhotos = (viewStop?.media ?? []).filter((m) => m.kind === 'photo' && m.url).map((m) => ({ id: m.id, url: m.url as string }));
  function actionsFor(photo: { id: string }): PagerAction[] {
    const m = viewStop?.media.find((x) => x.id === photo.id);
    if (!m) return [];
    const out: PagerAction[] = [];
    if (!m.withdrawn && !m.shared) {
      out.push({ key: 'approve', label: m.status === 'approved' ? 'Approved' : 'Approve', icon: 'check-circle', onPress: () => review(m, 'approved') });
      out.push({ key: 'hide', label: m.status === 'hidden' ? 'Hidden' : 'Hide', icon: 'eye-off', onPress: () => review(m, 'hidden') });
    }
    if (m.shared && !m.withdrawn) out.push({ key: 'withdraw', label: 'Withdraw', icon: 'corner-up-left', onPress: () => withdraw(m) });
    out.push({ key: 'delete', label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => remove(m) });
    return out;
  }

  async function send(s: ReviewStop) {
    setBusy(s.visitId);
    const res = await sendCustomerUpdate(s.visitId);
    setBusy(null);
    if (!res.ok) return showMessage('Couldn\'t send', res.error);
    showMessage('Sent to the customer', res.data
      ? `${res.data} ${res.data === 1 ? 'photo is' : 'photos are'} now in their Snow updates.`
      : 'The stop is now in their Snow updates.');
    reload();
  }

  async function addPhotos(s: ReviewStop) {
    if (!db.companyId) return;
    const drafts = await pickSnowMedia();
    if (!drafts.length) return;
    // Instant: queued, then uploaded in the background (shown under the button).
    const res = await addOwnerMedia(db.companyId, s.visitId, drafts);
    if (!res.ok) showMessage("Couldn't add the photo", res.error);
  }

  const waiting = stops.filter((s) => !s.notified);
  const sent = stops.filter((s) => s.notified);

  function StopCard({ s }: { s: ReviewStop }) {
    const { uploading, failed } = useSnowUploads(SNOW_OWNER_MEDIA_TARGET, (p) => p.visitId === s.visitId);
    const pending = s.media.some((m) => m.status === 'pending');
    const newlyApproved = s.media.some((m) => m.status === 'approved' && !m.shared);
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, marginBottom: spacing.md, gap: spacing.sm }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{s.propertyName}</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{SERVICE_LABEL[s.service]} · {when(s.completedAt)}</Text>
          </View>
          {s.notified ? <StatusBadge label="Sent" status="success" /> : null}
        </View>
        {s.completionNote ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>“{s.completionNote}”</Text> : null}
        {s.media.length ? (
          <View style={styles.thumbs}>
            {s.media.map((m) => (
              <View key={m.id} style={{ gap: 4, opacity: m.status === 'hidden' || m.withdrawn ? 0.4 : 1 }}>
                <Thumb m={m} onPress={m.kind === 'photo' && m.url ? () => setViewing({ visitId: s.visitId, mediaId: m.id }) : undefined} />
                {m.withdrawn ? (
                  <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center' }]}>Withdrawn</Text>
                ) : m.shared ? (
                  <View style={{ alignItems: 'center', gap: 2 }}>
                    <Text style={[typeScale.caption, { color: colors.success }]}>Sent</Text>
                    <Pressable disabled={busy === m.id} onPress={() => withdraw(m)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Withdraw from the customer">
                      <Text style={[typeScale.caption, { color: colors.error, fontWeight: '600' }]}>Withdraw</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }}>
                    <Pressable disabled={busy === m.id} onPress={() => review(m, 'approved')} hitSlop={6} accessibilityLabel="Approve">
                      <Icon name="check-circle" size={22} color={m.status === 'approved' ? colors.success : colors.textTertiary} />
                    </Pressable>
                    <Pressable disabled={busy === m.id} onPress={() => review(m, 'hidden')} hitSlop={6} accessibilityLabel="Hide">
                      <Icon name="eye-off" size={22} color={m.status === 'hidden' ? colors.error : colors.textTertiary} />
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : (
          <Text style={[typeScale.caption, { color: colors.textTertiary }]}>No photos for this stop.</Text>
        )}
        <Button
          title="Add a photo or video"
          icon="camera"
          size="sm"
          variant="secondary"
          disabled={busy === s.visitId}
          onPress={() => addPhotos(s)}
        />
        <SnowUploadStatus uploading={uploading} failed={failed} />
        {!s.notified || newlyApproved ? (
          <Button
            title={s.notified ? 'Share newly approved photos' : 'Send to customer'}
            icon="send"
            size="sm"
            disabled={pending}
            loading={busy === s.visitId}
            onPress={() => send(s)}
          />
        ) : null}
        {pending ? <Text style={[typeScale.caption, { color: colors.warning }]}>Approve or hide every photo before sending.</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader title="Photo review" subtitle="Completed stops, last 14 days" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['2xl'] }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginBottom: spacing.md }} /> : null}
        {loading ? <LoadingSpinner /> : !stops.length ? (
          <EmptyState icon="camera" title="Nothing to review" description="Completed stops and their photos show up here." />
        ) : (
          <>
            {waiting.length ? <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>To send</Text> : null}
            {waiting.map((s) => <StopCard key={s.visitId} s={s} />)}
            {sent.length ? <Text style={[typeScale.overline, styles.label, { color: colors.textSecondary }]}>Sent</Text> : null}
            {sent.map((s) => <StopCard key={s.visitId} s={s} />)}
          </>
        )}
      </ScrollView>
      <PhotoPager photos={viewPhotos} startId={viewing?.mediaId ?? null} onClose={() => setViewing(null)} actionsFor={actionsFor} />
    </View>
  );
}

/** Customer: Account → Snow updates. */
const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  label: { marginLeft: spacing.sm, marginBottom: spacing.sm, marginTop: spacing.md },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 88, height: 88, borderRadius: radius.md, overflow: 'hidden' },
  thumbIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
