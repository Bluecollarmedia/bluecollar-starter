import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Avatar, Button, FilterChips, StatusBadge } from '@/components/ui';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { haptics } from '@/lib/haptics';
import { useTeamAccess, type TeamPerson, type TeamState } from '@/hooks/useTeamAccess';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

type Sheet =
  | { kind: 'deactivate'; person: TeamPerson; warnings: string[]; blocking: string[] }
  | { kind: 'reactivate'; person: TeamPerson }
  | { kind: 'role'; person: TeamPerson; to: 'admin' | 'worker' };

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', worker: 'Worker' };
const name = (p: TeamPerson) => `${p.firstName} ${p.lastName}`.trim() || p.email || 'No name';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/**
 * Team access: who is on the team, who is an admin, who is deactivated. Deactivate worker (all company access) is not the same as
 * (elsewhere, owner only) Delete company.
 */
export default function TeamAccessScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const T = useTeamAccess();
  const [filter, setFilter] = useState<TeamState>('active');
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(() => T.people.filter((p) => p.state === filter), [T.people, filter]);
  const count = (s: TeamState) => T.people.filter((p) => p.state === s).length;
  const isOwner = T.myRole === 'owner';

  function show(s: Sheet) {
    haptics.select();
    setErr(''); setAck(false); setBusy(false);
    setSheet(s);
  }
  async function startDeactivate(p: TeamPerson) {
    const c = await T.check(p.personId);
    if (typeof c === 'string') { show({ kind: 'deactivate', person: p, warnings: [], blocking: [c] }); return; }
    show({ kind: 'deactivate', person: p, warnings: c.warnings, blocking: c.blocking });
  }

  async function confirm() {
    if (!sheet || busy) return;  // a second tap while it runs does nothing
    setBusy(true); setErr('');
    const p = sheet.person;
    let e = '';
    if (sheet.kind === 'deactivate') e = await T.deactivate(p.personId, ack || sheet.warnings.length === 0);
    else if (sheet.kind === 'reactivate') e = await T.reactivate(p.personId, p.workerType ?? 'landscaping');
    else if (sheet.kind === 'role') e = await T.setRole(p.personId, sheet.to);
    setBusy(false);
    if (e) { setErr(e); return; }
    haptics.success();
    setSheet(null); setOpen(null);
  }

  const copy = (() => {
    if (!sheet) return null;
    const n = name(sheet.person);
    switch (sheet.kind) {
      case 'deactivate': return { title: `Deactivate ${n}?`, body: 'They lose ALL company access right away. Their hours, photos and records stay exactly as they are, and you can reactivate them later.', button: 'Deactivate Worker', danger: true };
      case 'reactivate': return { title: `Reactivate ${n}`, body: 'They get their worker access back. Old admin rights are never restored, and nothing is assigned to them automatically.', button: 'Reactivate', danger: false };
      case 'role': return sheet.to === 'admin'
        ? { title: `Make ${n} an admin?`, body: 'Admins help run the company. You can limit what admins may do under Admin powers, and take this back any time.', button: 'Make Admin', danger: false }
        : { title: `Remove admin from ${n}?`, body: 'They stay on the team as a worker. Their history is kept.', button: 'Remove Admin', danger: true };
    }
  })();
  const blocked = sheet?.kind === 'deactivate' && sheet.blocking.length > 0;
  const needsAck = sheet?.kind === 'deactivate' && sheet.warnings.length > 0 && !ack;

  function card(p: TeamPerson) {
    const expanded = open === p.personId;
    const locked = p.isMe || p.role === 'owner';
    const adminTarget = p.role === 'admin' && !isOwner;  // only the owner changes an admin
    return (
      <Pressable key={p.personId} style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]} onPress={() => setOpen(expanded ? null : p.personId)} accessibilityRole="button">
        <View style={styles.row}>
          <Avatar firstName={p.firstName || '?'} lastName={p.lastName} size={44} uri={p.avatarUrl} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{name(p)}{p.isMe ? ' (you)' : ''}</Text>
            <View style={styles.badges}>
              {p.role ? <StatusBadge label={ROLE_LABEL[p.role] ?? p.role} status="info" /> : null}
              {p.landscaping ? <StatusBadge label={p.workerType === 'maintenance' ? 'Maintenance' : 'Landscaping'} status="success" /> : null}
              {p.state === 'waiting' ? <StatusBadge label="Invited" status="info" /> : null}
              {p.state === 'deactivated' ? <StatusBadge label="Deactivated" status="error" /> : null}
            </View>
          </View>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
        </View>
        {expanded ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {p.state === 'deactivated' ? (
              <>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                  Deactivated{p.deactivatedAt ? ` ${when(p.deactivatedAt)}` : ''}{p.deactivatedByName ? ` by ${p.deactivatedByName}` : ''}. Their history is kept.
                </Text>
                {!locked && !adminTarget ? <Button title="Reactivate…" size="sm" variant="secondary" onPress={() => show({ kind: 'reactivate', person: p })} /> : null}
              </>
            ) : p.state === 'waiting' ? (
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>They haven't opened their invite link yet. Use Add Worker to send them a new link.</Text>
            ) : locked ? (
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{p.isMe ? 'This is you.' : 'The owner’s account can’t be changed here.'}</Text>
            ) : adminTarget ? (
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Only the owner can change an admin.</Text>
            ) : (
              <>
                {isOwner ? (
                  p.role === 'admin'
                    ? <Button title="Remove admin" size="sm" variant="secondary" onPress={() => show({ kind: 'role', person: p, to: 'worker' })} />
                    : <Button title="Make admin" size="sm" variant="secondary" onPress={() => show({ kind: 'role', person: p, to: 'admin' })} />
                ) : null}
                <Button title="Deactivate worker" size="sm" variant="danger" onPress={() => startDeactivate(p)} />
              </>
            )}
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back"><Icon name="arrow-left" size={24} color={colors.textPrimary} /></Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>Team access</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await T.reload(); setRefreshing(false); }} />}>
        {isOwner ? (
          <Pressable onPress={() => router.push('/(owner)/more/admin-powers' as never)} style={[styles.link, { backgroundColor: colors.surface }, shadow.sm]} accessibilityRole="button">
            <Icon name="shield" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>Admin powers</Text>
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Choose what admins may do</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : null}
        <FilterChips<TeamState> selected={filter} onSelect={setFilter}
          options={[{ key: 'active', label: 'Active', count: count('active') }, { key: 'waiting', label: 'Invited', count: count('waiting') }, { key: 'deactivated', label: 'Deactivated', count: count('deactivated') }]} />
        <View style={{ height: spacing.md }} />
        {T.error ? <Text style={[typeScale.bodySmall, { color: semantic.error, marginBottom: spacing.md }]}>{T.error}</Text> : null}
        {!T.loading && !T.error && shown.length === 0 ? (
          <View style={styles.empty}><Icon name="users" size={40} color={colors.textTertiary} /><Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.md }]}>Nobody here</Text></View>
        ) : null}
        {shown.map(card)}
      </ScrollView>

      <BottomSheetModal visible={!!sheet} onRequestClose={() => { if (!busy) setSheet(null); }}>
        <Pressable style={styles.overlay} onPress={() => { if (!busy) setSheet(null); }}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }]} onPress={(e) => e.stopPropagation()}>
            {copy && sheet ? (
              <>
                <Text style={[typeScale.headingLarge, { color: colors.textPrimary, textAlign: 'center' }]}>{copy.title}</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm }]}>{copy.body}</Text>

                {sheet.kind === 'deactivate' && sheet.blocking.length > 0 ? (
                  <View style={[styles.note, { backgroundColor: semantic.errorLight }]}>
                    {sheet.blocking.map((b) => <Text key={b} style={[typeScale.bodySmall, { color: semantic.error }]}>{b}</Text>)}
                  </View>
                ) : null}
                {sheet.kind === 'deactivate' && sheet.warnings.length > 0 ? (
                  <View style={[styles.note, { backgroundColor: semantic.warningLight }]}>
                    {sheet.warnings.map((w) => <Text key={w} style={[typeScale.bodySmall, { color: colors.textPrimary }]}>• {w}</Text>)}
                    <View style={styles.ackRow}>
                      <Switch value={ack} onValueChange={setAck} />
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>I have read this. Deactivate anyway (nothing above is deleted).</Text>
                    </View>
                  </View>
                ) : null}

                {err ? <Text style={[typeScale.caption, { color: semantic.error, marginTop: spacing.sm }]}>{err}</Text> : null}
                <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
                  <Button title={copy.button} onPress={confirm} variant={copy.danger ? 'danger' : 'primary'} fullWidth loading={busy} disabled={blocked || needsAck} />
                  <Button title="Cancel" onPress={() => { if (!busy) setSheet(null); }} variant="ghost" fullWidth />
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.sm, marginBottom: spacing.md },
  empty: { alignItems: 'center', paddingVertical: spacing['4xl'] },
  card: { borderRadius: radius.sm, padding: spacing.lg, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  note: { borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
});
