/**
 * Owner and admin: the service requests people sent from the public Brighton Weather area's Request tab (update 114). New ones first.
 * Call or email the person right from the card, then mark it contacted or done.
 */
import React, { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, GlassIconButton, Icon, InlineNotice, LoadingSpinner } from '@/components/ui';
import { SnowPill } from '@/components/snow/SnowPill';
import { useTheme } from '@/providers/ThemeProvider';
import { setServiceRequestStatus, useServiceRequests } from '@/data/serviceRequests';
import { REQUEST_STATUS_LABEL, type RequestStatus, type ServiceRequestRow } from '@/lib/serviceRequest';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

const PILL: Record<RequestStatus, { fg: string; bg: string }> = {
  new: { fg: '#7A4A00', bg: '#FFF0D6' },
  contacted: { fg: '#0D4F8B', bg: '#E1EEFA' },
  done: { fg: '#1F5E2E', bg: '#E1F3E4' },
};

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ServiceRequestsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { rows, loading, error, refresh } = useServiceRequests();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function move(r: ServiceRequestRow, status: RequestStatus) {
    setBusyId(r.id);
    setProblem(null);
    const res = await setServiceRequestStatus(r.id, status);
    setBusyId(null);
    if (!res.ok) return setProblem(res.error);
    await refresh();
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={refresh} />}
      >
        <GlassIconButton icon="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.lg }]}>Service requests</Text>
        <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.lg }]}>
          People who asked for work from the Request tab. Call or email them, then mark each one.
        </Text>
        {error ? <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginBottom: spacing.md }} /> : null}
        {problem ? <InlineNotice icon="alert-circle" tone="error" text={problem} style={{ marginBottom: spacing.md }} /> : null}
        {loading && rows.length === 0 ? (
          <LoadingSpinner />
        ) : rows.length === 0 ? (
          <EmptyState icon="inbox" title="No requests yet" description="When someone sends a request from the app, it shows up here and you get a notification." />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {rows.map((r) => {
              const tone = PILL[r.status];
              return (
                <View key={r.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                    <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flexShrink: 1 }]} numberOfLines={1}>{r.name}</Text>
                    <SnowPill label={REQUEST_STATUS_LABEL[r.status]} fg={tone.fg} bg={tone.bg} />
                  </View>
                  <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                    {r.property_type === 'commercial' ? 'Commercial' : 'Residential'} {'·'} {r.town} {'·'} {when(r.created_at)}
                  </Text>
                  <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, fontWeight: '600', marginTop: spacing.sm }]}>{r.services.join(', ')}</Text>
                  {r.details ? <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginTop: spacing.xs }]}>{r.details}</Text> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    <Pressable onPress={() => { void Linking.openURL(`tel:${r.phone.replace(/[^\d+]/g, '')}`); }} accessibilityRole="button" accessibilityLabel={`Call ${r.name}`} style={[styles.contact, { borderColor: colors.border }]}>
                      <Icon name="phone" size={16} color={colors.primary} />
                      <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{r.phone}</Text>
                    </Pressable>
                    {r.email ? (
                      <Pressable onPress={() => { void Linking.openURL(`mailto:${r.email}`); }} accessibilityRole="button" accessibilityLabel={`Email ${r.name}`} style={[styles.contact, { borderColor: colors.border }]}>
                        <Icon name="mail" size={16} color={colors.primary} />
                        <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]} numberOfLines={1}>{r.email}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    {r.status === 'new' ? <Button title="Mark contacted" size="sm" loading={busyId === r.id} onPress={() => move(r, 'contacted')} style={{ flex: 1 }} /> : null}
                    {r.status !== 'done' ? <Button title="Mark done" size="sm" variant="secondary" loading={busyId === r.id} onPress={() => move(r, 'done')} style={{ flex: 1 }} /> : null}
                    {r.status !== 'new' ? <Button title="Reopen" size="sm" variant="secondary" loading={busyId === r.id} onPress={() => move(r, 'new')} style={{ flex: 1 }} /> : null}
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
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl, padding: spacing.md },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1 },
});
