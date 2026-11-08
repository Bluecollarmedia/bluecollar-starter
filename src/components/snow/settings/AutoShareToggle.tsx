/**
 * The "photos go to the customer automatically" switch (owner/admin, supabase/updates/087). ON (the default): the moment a crew lead
 * completes a stop, its photos reach the property's customer and the stop shows on their Snow timeline, with nothing for the owner to do.
 * OFF: the owner approves each photo in Photo review and sends it. Saving is immediate; the switch goes back if it could not be saved.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { InlineNotice, Switch } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { loadAutoShare, setAutoShare } from '@/data/snowSettings';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

export function AutoShareToggle({ companyId }: { companyId?: string }) {
  const { colors } = useTheme();
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    loadAutoShare(companyId).then((r) => { if (alive) { if (r.ok) { setOn(r.data); setError(null); } else setError(r.error); } });
    return () => { alive = false; };
  }, [companyId]);

  async function change(next: boolean) {
    if (!companyId) return;
    const before = on;
    setOn(next);
    setSaving(true);
    const res = await setAutoShare(companyId, next);
    setSaving(false);
    if (!res.ok) { setOn(before); setError(res.error); } else setError(null);
  }

  return (
    <View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>Send photos to customers automatically</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
            {on === null ? 'Loading…' : on
              ? 'On: the customer sees a finished stop and its photos right away. You can still withdraw a photo.'
              : 'Off: you approve each photo in Photo review and send it yourself.'}
          </Text>
        </View>
        <Switch value={!!on} disabled={on === null || saving || !companyId} onValueChange={change} accessibilityLabel="Send photos to customers automatically" />
      </View>
      {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ margin: spacing.md }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 56 },
});
