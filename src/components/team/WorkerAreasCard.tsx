/**
 * Owner: what one worker works on, after they are added. Three areas: Landscaping, Maintenance, and Snow (with the services that
 * person can work). Nothing is chosen before the worker is added; every worker starts the same way.
 */
import React, { useState } from 'react';
import { View, Text, Switch, Pressable, StyleSheet, Platform, Alert } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useDb } from '@/data/store';
import { setWorkerAreas } from '@/data/maintenance';
import { useSnowOnboardingAdmin, SNOW_SERVICES, type SnowService } from '@/hooks/useSnowTeam';
import { worksOnLandscaping, worksOnMaintenance } from '@/lib/workerAreas';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { CompanyMember, PersonSummary } from '@/types/company';

const tell = (msg: string) => (Platform.OS === 'web' ? alert(msg) : Alert.alert('Not changed', msg));

export function WorkerAreasCard({ member, person }: { member: CompanyMember; person: PersonSummary }) {
  const { colors } = useTheme();
  useDb();
  const snow = useSnowOnboardingAdmin();
  const [busy, setBusy] = useState(false);
  const landscaping = worksOnLandscaping(member);
  const maintenance = worksOnMaintenance(member);
  const snowMember = snow.members.find((m) => m.personId === person.id && m.status === 'active');
  const snowServices: SnowService[] = snowMember?.services ?? [];

  async function setAreas(next: { landscaping: boolean; maintenance: boolean }) {
    if (busy) return;
    setBusy(true);
    haptics.select();
    const res = await setWorkerAreas(person.id, next);
    setBusy(false);
    if (!res.ok) tell(res.error);
  }

  async function toggleSnow(service: SnowService) {
    if (busy) return;
    const next = snowServices.includes(service) ? snowServices.filter((s) => s !== service) : [...snowServices, service];
    setBusy(true);
    haptics.select();
    let res: { ok: boolean; error?: string };
    if (next.length === 0) {
      res = snowMember ? await snow.revoke(snowMember) : { ok: true };
    } else {
      res = await snow.grantAccess({ personId: person.id, firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone }, next);
    }
    setBusy(false);
    if (!res.ok) tell(res.error ?? 'Could not save.');
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

      <View style={[styles.snowBlock, { borderTopColor: colors.border }]}>
        <View style={styles.titleRow}>
          <Icon name="cloud-snow" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>Snow</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Pick the snow services {person.firstName} works. None means no snow access.</Text>
          </View>
        </View>
        <View style={styles.chips}>
          {SNOW_SERVICES.map((s) => {
            const on = snowServices.includes(s.key);
            return (
              <Pressable
                key={s.key}
                onPress={() => toggleSnow(s.key)}
                style={[styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySurface : colors.surface }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={s.label}
              >
                {on && <Icon name="check" size={14} color={colors.primary} />}
                <Text style={[typeScale.labelSmall, { color: on ? colors.primary : colors.textPrimary }]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
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
  snowBlock: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.sm, paddingTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, minHeight: 36 },
});
