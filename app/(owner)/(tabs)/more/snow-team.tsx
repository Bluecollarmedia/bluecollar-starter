/**
 * Snow Team (owner)
 *
 * Every worker in one list with what they work in snow: all services, some, or none. Tap a worker to change it (it saves as you
 * tap). Anyone on the landscaping team is already here; "Add Worker" makes a new person with a private link, same as everywhere.
 * No codes and no requests. Goes through the database functions in supabase/updates/023_snow_onboarding.sql (owner/admin only).
 */

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, TextInput } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { ScreenHeader, RaisedAddButton, Avatar, Button, InlineNotice, LoadingSpinner, Icon } from '@/components/ui';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { showMessage } from '@/components/financials/ActionSheet';
import { haptics } from '@/lib/haptics';
import { db, useDb } from '@/data/store';
import { filterSnowTeam, servicesSummary, snowTeamRows, type SnowTeamFilter, type SnowTeamRow } from '@/lib/snowTeam';
import { useSnowOnboardingAdmin, SNOW_SERVICES, snowServiceLabel, type SnowService } from '@/hooks/useSnowTeam';

const ALL_SERVICES = SNOW_SERVICES.map((s) => s.key);

/** Also the Snow Mode Team tab (`asTab`: no back button, clears the tab bar). */
export function SnowTeamScreen({ asTab = false }: { asTab?: boolean }) {
  const tabBarClearance = useTabBarClearance();
  const { colors } = useTheme();
  const router = useRouter();
  // Inside the snow shell, (owner) screens get bounced by the root guard, so Add Worker opens through the snow route.
  const inSnowShell = useSegments()[0] === 'snow';
  const addWorker = () => router.push((inSnowShell ? '/snow/owner/worker-new' : '/(owner)/worker-new') as any);
  const admin = useSnowOnboardingAdmin();
  const dbVersion = useDb();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SnowTeamFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A green note at the top so it is clear the change went through. */
  function flashSaved(message: string) {
    setSavedNote(message);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedNote(null), 5000);
  }

  const rows = useMemo(
    () => snowTeamRows(db.members, admin.members),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dbVersion, admin.members],
  );
  const shown = filterSnowTeam(rows, query, filter);
  const onSnow = rows.filter((r) => r.services.length > 0).length;

  /** Sets exactly these services for one person (none removes their snow access). The database has the final word. */
  async function setServices(row: SnowTeamRow, next: SnowService[]) {
    if (busy) return;
    setBusy(row.personId);
    haptics.select();
    const member = admin.members.find((m) => m.personId === row.personId);
    const res = next.length === 0
      ? (member && member.status === 'active' ? await admin.revoke(member) : { ok: true })
      : await admin.grantAccess({ personId: row.personId, firstName: row.firstName, lastName: row.lastName, email: row.email, phone: row.phone }, next);
    setBusy(null);
    if (!res.ok) return showMessage('Couldn’t save', (res as { error?: string }).error ?? 'Could not save.');
    flashSaved(`Saved. ${row.firstName} ${row.lastName}: ${servicesSummary(next, ALL_SERVICES, snowServiceLabel)}.`);
  }

  const filters: { key: SnowTeamFilter; label: string }[] = [
    { key: 'all', label: `All ${rows.length}` },
    { key: 'snow', label: `On snow ${onSnow}` },
    { key: 'none', label: `No snow ${rows.length - onSnow}` },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader
        title="Snow Team"
        subtitle="Every worker and what they work in snow"
        hideBack={asTab}
        right={<RaisedAddButton onPress={addWorker} accessibilityLabel="Add a worker" />}
      />
      <ScrollView
        // Always clear the floating tab bar (also when opened from More), so the last row can be reached.
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await admin.reload(); setRefreshing(false); }} />}
        keyboardShouldPersistTaps="handled"
      >
        {savedNote ? <InlineNotice icon="check-circle" tone="success" text={savedNote} style={{ marginBottom: spacing.md }} /> : null}
        {admin.loading ? (
          <LoadingSpinner />
        ) : admin.loadError ? (
          <View style={{ gap: spacing.md }}>
            <InlineNotice icon="alert-circle" tone="error" text={admin.loadError} />
            <Button title="Try Again" variant="secondary" icon="refresh-cw" onPress={admin.reload} />
          </View>
        ) : (
          <>
            <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
              <Icon name="search" size={18} color={colors.textTertiary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search workers…"
                placeholderTextColor={colors.textTertiary}
                style={[typeScale.bodyLarge, { flex: 1, color: colors.textPrimary, paddingVertical: 10 }]}
                autoCorrect={false}
                accessibilityLabel="Search workers"
              />
            </View>
            <View style={styles.chips}>
              {filters.map((f) => {
                const on = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    style={[styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySurface : colors.surface }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[typeScale.labelSmall, { color: on ? colors.primary : colors.textPrimary }]}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {rows.length === 0 ? (
              <View style={styles.empty}>
                <Icon name="users" size={36} color={colors.textTertiary} />
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', marginTop: spacing.md }]}>No workers yet</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginVertical: spacing.sm }]}>
                  Add a worker with just a name and phone number. They get a private link to set up their own login.
                </Text>
                <Button title="Add Worker" icon="user-plus" onPress={addWorker} />
              </View>
            ) : shown.length === 0 ? (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl }]}>No one matches.</Text>
            ) : (
              <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                {shown.map((r, i) => {
                  const isOpen = open === r.personId;
                  const sep = i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight } : null;
                  const has = r.services.length > 0;
                  return (
                    <View key={r.personId} style={sep}>
                      <Pressable
                        onPress={() => setOpen(isOpen ? null : r.personId)}
                        style={styles.row}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: isOpen }}
                        accessibilityLabel={`${r.firstName} ${r.lastName}, ${servicesSummary(r.services, ALL_SERVICES, snowServiceLabel)}`}
                      >
                        <Avatar firstName={r.firstName} lastName={r.lastName} uri={r.avatarUrl} size={44} />
                        <View style={{ flex: 1 }}>
                          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{`${r.firstName} ${r.lastName}`.trim() || r.email}</Text>
                          <Text style={[typeScale.caption, { color: has ? colors.primary : colors.textTertiary }]} numberOfLines={1}>
                            {servicesSummary(r.services, ALL_SERVICES, snowServiceLabel)}{r.landscaping ? '' : ' · Snow only'}
                          </Text>
                        </View>
                        <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
                      </Pressable>
                      {isOpen ? (
                        <View style={styles.editor}>
                          <View style={styles.quick}>
                            <Button title="All services" size="sm" variant={r.services.length === ALL_SERVICES.length ? 'primary' : 'secondary'} disabled={busy === r.personId} onPress={() => setServices(r, ALL_SERVICES)} />
                            <Button title="No snow" size="sm" variant={has ? 'secondary' : 'primary'} disabled={busy === r.personId || !has} onPress={() => setServices(r, [])} />
                          </View>
                          <View style={styles.quick}>
                            {SNOW_SERVICES.map((s) => {
                              const on = r.services.includes(s.key);
                              return (
                                <Pressable
                                  key={s.key}
                                  disabled={busy === r.personId}
                                  onPress={() => setServices(r, on ? (r.services.filter((x) => x !== s.key) as SnowService[]) : ([...r.services, s.key] as SnowService[]))}
                                  style={[styles.svc, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySurface : colors.surface }]}
                                  accessibilityRole="checkbox"
                                  accessibilityState={{ checked: on }}
                                  accessibilityLabel={s.label}
                                >
                                  {on ? <Icon name="check" size={14} color={colors.primary} /> : null}
                                  <Text style={[typeScale.labelSmall, { color: on ? colors.primary : colors.textPrimary }]}>{s.label}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing['4xl'] },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.md },
  chip: { paddingHorizontal: spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1 },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 64 },
  editor: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  svc: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, minHeight: 36 },
  empty: { alignItems: 'center', paddingVertical: spacing['3xl'] },
});

export default function SnowTeamRoute() {
  return <SnowTeamScreen />;
}
