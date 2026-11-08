/**
 * Owner: what one worker works on, after they are added. Two areas: Landscaping and Maintenance. Nothing is chosen before the worker
 * is added; every worker starts the same way.
 */
import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet, Platform, Alert } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useDb } from '@/data/store';
import { setWorkerAreas } from '@/data/maintenance';
import { worksOnLandscaping, worksOnMaintenance } from '@/lib/workerAreas';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { CompanyMember, PersonSummary } from '@/types/company';

const tell = (msg: string) => (Platform.OS === 'web' ? alert(msg) : Alert.alert('Not changed', msg));

export function WorkerAreasCard({ member, person }: { member: CompanyMember; person: PersonSummary }) {
  const { colors } = useTheme();
  useDb();
  const [busy, setBusy] = useState(false);
  const landscaping = worksOnLandscaping(member);
  const maintenance = worksOnMaintenance(member);

  async function setAreas(next: { landscaping: boolean; maintenance: boolean }) {
    if (busy) return;
    setBusy(true);
    haptics.select();
    const res = await setWorkerAreas(person.id, next);
    setBusy(false);
    if (!res.ok) tell(res.error);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
      <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700' }]}>Works On</Text>
      <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm }]}>
        Choose what {person.firstName} can see and do. You can change this any time.
      </Text>

      <Row icon="tool" title="Landscaping" sub="Landscaping projects and tasks" value={landscaping} disabled={busy}
        onChange={(v) => setAreas({ landscaping: v, maintenance })} />
      <Row icon="repeat" title="Maintenance" sub="Maintenance routes and the Maintenance Crew" value={maintenance} disabled={busy}
        onChange={(v) => setAreas({ landscaping, maintenance: v })} />
    </View>
  );
}

function Row({ icon, title, sub, value, onChange, disabled }: {
  icon: React.ComponentProps<typeof Icon>['name']; title: string; sub: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.titleRow}>
      <Icon name={icon} size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{title}</Text>
        <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={title} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
});
