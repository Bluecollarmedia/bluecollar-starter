/**
 * The Snow "stop rule" switch (owner/admin): when it is on, the database will not let a stop be finished until the lead has tapped
 * I'm Here at the property. Turning it OFF changes what crews can do, so it is confirmed first.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { InlineNotice, Switch } from '@/components/ui';
import { confirmAction } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { ARRIVAL_OFF_WARNING, loadSnowRules, setRequireArrival } from '@/data/snowSettings';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

export function StopRuleToggle({ companyId }: { companyId?: string }) {
  const { colors } = useTheme();
  const [requireArrival, setRequire] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    loadSnowRules(companyId).then((r) => {
      if (!alive) return;
      if (r.ok) { setRequire(r.data.requireArrival); setError(null); } else setError(r.error);
    });
    return () => { alive = false; };
  }, [companyId]);

  async function save(next: boolean) {
    if (!companyId) return;
    const before = requireArrival;
    setRequire(next);
    setSaving(true);
    const res = await setRequireArrival(companyId, next);
    setSaving(false);
    if (!res.ok) { setRequire(before); setError(res.error); } else setError(null);
  }

  function change(next: boolean) {
    if (next) return save(true);
    confirmAction('Turn off the "I\'m Here" rule?', ARRIVAL_OFF_WARNING, 'Turn off', () => save(false), true);
  }

  return (
    <View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>Require I'm Here first</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
            {requireArrival === null ? 'Loading…' : requireArrival ? 'On: leads must arrive before finishing a stop' : "Off: a stop can be finished without I'm Here"}
          </Text>
        </View>
        <Switch value={!!requireArrival} disabled={requireArrival === null || saving || !companyId} onValueChange={change} accessibilityLabel="Require I'm Here first" />
      </View>
      {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ margin: spacing.md }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
});
