/**
 * Snow More -> Manage storms (Owner). Every storm, whatever its status, newest first. Tap a name to rename it: that name is the
 * title on the dashboard. There is no delete here on purpose (the owner does not want storms deleted from the app).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, GlassIconButton, Icon, InlineNotice, Input, LoadingSpinner } from '@/components/ui';
import { SnowPill } from '@/components/snow/SnowPill';
import { showMessage } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { loadStorms, renameStorm, SERVICE_LABEL, STORM_STATUS_LABEL } from '@/data/snowStorms';
import { servicesLabel, stormServices } from '@/lib/snowServices';
import { longWhen, STORM_PILL } from '@/lib/snowStormView';
import { snowStatus } from '@/theme/colors';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import type { SnowStorm } from '@/types/snow';


export function ManageStormsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [storms, setStorms] = useState<SnowStorm[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const reload = useCallback(async () => {
    const res = await loadStorms();
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setStorms(res.data);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function saveName(s: SnowStorm) {
    setBusyId(s.id);
    const res = await renameStorm(s.id, draft);
    setBusyId(null);
    if (!res.ok) return showMessage('Couldn\'t rename the storm', res.error);
    setRenaming(null);
    setDone(`Renamed to ${draft.trim()}.`);
    reload();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      >
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>Manage storms</Text>
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg }]}>
          Tap a storm's name to rename it. The name is the title on your dashboard.
        </Text>
        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginBottom: spacing.md }} /> : null}
        {done ? <InlineNotice icon="check-circle" tone="success" text={done} style={{ marginBottom: spacing.md }} /> : null}
        {loading ? (
          <LoadingSpinner />
        ) : storms.length === 0 ? (
          <EmptyState icon="cloud-snow" title="No storms" description="Storms you create show up here." />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {storms.map((s) => {
              const tone = STORM_PILL[s.status];
              const when = s.status === 'ended' && s.endedAt ? `Ended ${longWhen(s.endedAt)}` : s.dispatchedAt ? `Dispatched ${longWhen(s.dispatchedAt)}` : `Created ${longWhen(s.createdAt)}`;
              return (
                <View key={s.id} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    {renaming === s.id ? (
                      <View style={{ gap: spacing.sm }}>
                        <Input label="Storm name" value={draft} onChangeText={setDraft} autoFocus maxLength={60} returnKeyType="done" onSubmitEditing={() => saveName(s)} />
                        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                          <Button title="Save name" size="sm" onPress={() => saveName(s)} disabled={busyId !== null || !draft.trim()} />
                          <Button title="Cancel" size="sm" variant="secondary" onPress={() => setRenaming(null)} />
                        </View>
                      </View>
                    ) : (
                      <Pressable onPress={() => { setRenaming(s.id); setDraft(s.name); }} accessibilityRole="button" accessibilityLabel={`Rename ${s.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flexShrink: 1 }]}>{s.name}</Text>
                        <Icon name="edit-2" size={14} color={colors.primary} />
                      </Pressable>
                    )}
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                      {servicesLabel(stormServices(s), (x) => SERVICE_LABEL[x])} {'·'} {when}
                    </Text>
                    <SnowPill label={STORM_STATUS_LABEL[s.status]} fg={tone.fg} bg={tone.bg} />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
});
