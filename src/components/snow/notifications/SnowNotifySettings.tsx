/**
 * Snow notification settings (supabase/updates/031).
 *
 *  • OwnerCustomerMessages: the OWNER decides when customers are messaged (crew arrives, service finished), once for
 *    every property, in the Snow More tab. Customers do not choose. Saved per property through snow_set_notify_prefs (logged).
 *  • OwnerStopAlertsToggle: the owner's own "alert me when a stop is done" switch. Independent of customer messages;
 *    turning it off never stops the visit, dashboard or activity log from recording the work.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon, InlineNotice, LoadingSpinner, Switch } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { loadAllNotifyPrefs, loadOwnerStopAlerts, setNotifyPrefs, setOwnerStopAlerts } from '@/data/snowNotifications';
import type { SnowNotifyPrefs } from '@/types/snowNotifications';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

// What a property gets before anyone changes anything (matches update 031).
const DEFAULT_PREFS = { notifyOnArrival: false, notifyOnCompletion: true };

type Prefs = { notifyOnArrival: boolean; notifyOnCompletion: boolean };
const prefsOf = (p?: SnowNotifyPrefs | null): Prefs => ({
  notifyOnArrival: p?.notifyOnArrival ?? DEFAULT_PREFS.notifyOnArrival,
  notifyOnCompletion: p?.notifyOnCompletion ?? DEFAULT_PREFS.notifyOnCompletion,
});

// ── Owner: what customers are messaged ─────────────────────────────────────

/**
 * The owner decides when customers get a message (crew arrives, service finished), once for every property. It is applied to each
 * property through snow_set_notify_prefs (logged as "Changed by staff"); customers do not choose.
 */
export function OwnerCustomerMessages() {
  const { colors } = useTheme();
  const [prefs, setPrefs] = useState<Record<string, Prefs> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const all = await loadAllNotifyPrefs();
    if (!all.ok) return setError(all.error);
    setError(null);
    setPrefs(Object.fromEntries(Object.entries(all.data).map(([id, p]) => [id, prefsOf(p)])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const ids = prefs ? Object.keys(prefs) : [];
  const everyone = (k: keyof Prefs) => ids.length > 0 && ids.every((id) => prefs![id][k]);

  async function change(patch: Partial<Prefs>) {
    if (!prefs || saving) return;
    const before = prefs;
    setPrefs(Object.fromEntries(Object.entries(prefs).map(([id, p]) => [id, { ...p, ...patch }])));
    setSaving(true);
    // One write per property, together (there is no bulk call).
    const sent = await Promise.all(ids.map((id) => setNotifyPrefs(id, patch)));
    const failed = sent.find((res) => !res.ok) as { ok: false; error: string } | undefined;
    setSaving(false);
    if (failed) { setPrefs(before); setError(failed.error); } else setError(null);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      {error ? <InlineNotice icon="alert-circle" tone="error" text={error} /> : null}
      {!prefs ? <LoadingSpinner /> : ids.length === 0 ? (
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>Add a Snow property first. Then you choose here when its customer is messaged.</Text>
      ) : (
        <>
          <ToggleRow
            title="Message the customer when the crew arrives"
            subtitle="Sent to the customer linked to the property."
            value={everyone('notifyOnArrival')}
            disabled={saving}
            onChange={(on) => change({ notifyOnArrival: on })}
          />
          <ToggleRow
            title="Message the customer when the service is finished"
            subtitle="Applies to every property."
            value={everyone('notifyOnCompletion')}
            disabled={saving}
            onChange={(on) => change({ notifyOnCompletion: on })}
          />
        </>
      )}
    </View>
  );
}

// ── Owner: own alerts ───────────────────────────────────────────────────────

/** `bare`: just the row (bell icon, no card of its own) for a screen that draws its own card around it. */
export function OwnerStopAlertsToggle({ companyId, bare }: { companyId: string; bare?: boolean }) {
  const { colors } = useTheme();
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadOwnerStopAlerts(companyId).then((res) => {
      if (!alive) return;
      if (res.ok) { setOn(res.data); setError(null); } else setError(res.error);
    });
    return () => { alive = false; };
  }, [companyId]);

  async function change(next: boolean) {
    const before = on;
    setOn(next);
    setSaving(true);
    const res = await setOwnerStopAlerts(companyId, next);
    setSaving(false);
    if (!res.ok) { setOn(before); setError(res.error); } else setError(null);
  }

  return (
    <View style={bare ? styles.bare : [styles.card, { backgroundColor: colors.surface }]}>
      {error ? <InlineNotice icon="alert-circle" tone="error" text={error} /> : null}
      <ToggleRow
        title="Alert me when a stop is finished"
        subtitle="Just for you. Stops are still recorded on the dashboard and activity log when this is off."
        value={!!on}
        disabled={on === null || saving}
        onChange={change}
        icon={bare ? 'bell' : undefined}
      />
    </View>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────────

function ToggleRow({ title, subtitle, value, disabled, onChange, icon }: {
  title: string; subtitle: string; value: boolean; disabled?: boolean; onChange: (on: boolean) => void;
  icon?: React.ComponentProps<typeof Icon>['name'];
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.toggleRow}>
      {icon ? <Icon name={icon} size={24} color={colors.primary} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} accessibilityLabel={title} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  bare: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.xs },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
});
