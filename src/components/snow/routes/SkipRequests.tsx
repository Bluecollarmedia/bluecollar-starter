/**
 * Skip requests (supabase/updates/027_snow_skip_requests.sql).
 *
 * LeadSkipPanel: on the lead's current stop. "Can't do this stop" asks the
 * owner with a reason; the stop stays open (never done, never skipped) until
 * the owner decides. A pending request can be taken back.
 *
 * OwnerSkipRequests: on the owner's route screen, where the dashboard's
 * "Skip requested" item lands. Approving marks the stop skipped (not
 * completed); denying keeps it open and the note tells the lead what to do.
 *
 * Every rule (who may ask, one open request per stop, once-only decisions) is
 * enforced by the database; these screens just call it and show the result.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Keyboard } from 'react-native';
import { Button, InlineNotice, Input } from '@/components/ui';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { decideSkip, listRouteSkips, requestSkip, skipHistory, withdrawSkip } from '@/data/snowSkips';
import type { SnowSkipRequest } from '@/types/snow';
import { shortWhen } from '@/lib/snowFormat';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

// ── Lead ────────────────────────────────────────────────────────────────────

export function LeadSkipPanel({ visitId, disabled, onChanged }: { visitId: string; disabled?: boolean; onChanged: () => void }) {
  const t = useT();
  const { colors } = useTheme();
  const [latest, setLatest] = useState<SnowSkipRequest | undefined>();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await skipHistory(visitId);
    setLatest(res.ok ? res.data[0] : undefined);
  }, [visitId]);

  useEffect(() => { setAsking(false); setReason(''); refresh(); }, [refresh]);

  async function send() {
    setBusy(true);
    const res = await requestSkip(visitId, reason);
    setBusy(false);
    if (!res.ok) return showMessage(t("Couldn't send the request"), t(res.error));
    Keyboard.dismiss();
    setAsking(false);
    setReason('');
    await refresh();
    onChanged();
  }

  async function withdraw() {
    if (!latest) return;
    setBusy(true);
    const res = await withdrawSkip(latest.id);
    setBusy(false);
    if (!res.ok) showMessage(t("Couldn't take it back"), t(res.error));
    await refresh();
    onChanged();
  }

  if (latest?.status === 'pending') {
    return (
      <View style={{ gap: spacing.sm }}>
        <InlineNotice icon="clock" tone="info" text={t('Skip requested. Waiting for the owner. "{reason}"', { reason: latest.reason })} />
        <Button title={t('Take request back')} variant="ghost" loading={busy} onPress={withdraw} fullWidth />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {latest?.status === 'denied' ? (
        <InlineNotice
          icon="alert-circle"
          tone="warning"
          text={latest.decisionNote ? t('The owner said this stop still needs doing: {note}', { note: latest.decisionNote }) : t('The owner said this stop still needs doing.')}
        />
      ) : null}
      {asking ? (
        <>
          <Input
            label={t("Why can't this stop be done?")}
            value={reason}
            onChangeText={setReason}
            placeholder={t('Locked gate, car in the way, no snow to clear…')}
            multiline
          />
          <View style={styles.buttons}>
            <Button title={t('Cancel')} variant="ghost" disabled={busy} onPress={() => { setAsking(false); setReason(''); }} />
            <Button title={t('Send request')} loading={busy} disabled={!reason.trim()} onPress={send} />
          </View>
        </>
      ) : (
        <Button title={t("Can't do this stop")} icon="slash" variant="ghost" disabled={disabled} onPress={() => setAsking(true)} fullWidth />
      )}
    </View>
  );
}

// ── Owner ───────────────────────────────────────────────────────────────────

export function OwnerSkipRequests({ routeId, stops, leadName, onDecided }: {
  routeId: string;
  stops: { id: string; propertyName: string }[];
  leadName?: string;
  onDecided: () => void;
}) {
  const [pending, setPending] = useState<SnowSkipRequest[]>([]);

  const refresh = useCallback(async () => {
    const res = await listRouteSkips(routeId);
    setPending(res.ok ? res.data.filter((r) => r.status === 'pending').reverse() : []);
  }, [routeId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!pending.length) return null;
  return (
    <View style={{ gap: spacing.md }}>
      {pending.map((r) => (
        <SkipDecisionCard
          key={r.id}
          request={r}
          stopName={stops.find((s) => s.id === r.visitId)?.propertyName ?? 'A stop'}
          leadName={leadName}
          onDecided={() => { refresh(); onDecided(); }}
        />
      ))}
    </View>
  );
}

function SkipDecisionCard({ request, stopName, leadName, onDecided }: {
  request: SnowSkipRequest; stopName: string; leadName?: string; onDecided: () => void;
}) {
  const { colors } = useTheme();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true);
    const res = await decideSkip(request.id, approve, note);
    setBusy(false);
    if (!res.ok) showMessage('Couldn\'t save the decision', res.error);
    onDecided();
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.warning }]}>
      <Text style={[typeScale.overline, { color: colors.warning }]}>SKIP REQUESTED</Text>
      <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{stopName}</Text>
      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>&ldquo;{request.reason}&rdquo;</Text>
      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
        {leadName ? `${leadName} · ` : ''}{shortWhen(request.createdAt)}
      </Text>
      <Input
        label="Note to the lead (optional)"
        value={note}
        onChangeText={setNote}
        placeholder="If you deny it, say what to do instead"
      />
      <View style={styles.buttons}>
        <Button title="Deny" variant="secondary" disabled={busy} onPress={() => decide(false)} />
        <Button
          title="Approve skip"
          loading={busy}
          onPress={() => confirmAction(
            `Skip ${stopName}?`,
            'It will be marked skipped, not completed, and the lead moves on.',
            'Approve skip',
            () => decide(true),
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
});
