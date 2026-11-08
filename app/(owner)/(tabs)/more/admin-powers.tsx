import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { ADMIN_POWERS, useAdminPermissions, type AdminPermissions } from '@/hooks/useTeamAccess';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { leaderPlural, words } from '@/config/brand';

/** Owner only: what admins may do. Everything is on until you switch it off; the database enforces each switch, not just this screen. */
export default function AdminPowersScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const A = useAdminPermissions();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function flip(key: keyof AdminPermissions, value: boolean) {
    if (!A.perms || busy) return;
    setBusy(true); setMsg('');
    const e = await A.save({ ...A.perms, [key]: value });
    setBusy(false);
    if (e) setMsg(e);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back"><Icon name="arrow-left" size={24} color={colors.textPrimary} /></Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>{words.leaderRoleLabel} powers</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.lg }]}>
          {leaderPlural()} run the day to day: {words.jobs.toLowerCase()}, schedules, customers, assignments. These more sensitive powers are on by default; switch off any you want to keep for yourself.
          {' '}{leaderPlural()} can never delete the company, deactivate or replace the owner, or make themselves an owner, whatever these say.
        </Text>
        {A.error ? <Text style={[typeScale.bodySmall, { color: semantic.error }]}>{A.error}</Text> : null}
        {msg ? <Text style={[typeScale.bodySmall, { color: semantic.error, marginBottom: spacing.md }]}>{msg}</Text> : null}
        {A.perms ? ADMIN_POWERS.map((p) => (
          <View key={p.key} style={[styles.row, { backgroundColor: colors.surface }, shadow.sm]}>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{p.label}</Text>
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{p.hint}</Text>
            </View>
            <Switch value={A.perms![p.key]} onValueChange={(v) => flip(p.key, v)} disabled={busy} accessibilityLabel={p.label} />
          </View>
        )) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.sm, marginBottom: spacing.md },
});
