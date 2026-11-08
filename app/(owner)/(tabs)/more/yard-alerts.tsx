import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Keyboard } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, Card, Input, LoadingSpinner, Switch } from '@/components/ui';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { haptics } from '@/lib/haptics';
import { loadYardAlerts, saveYardAlerts, YARD_RADII, DEFAULT_RADIUS_M, type YardAlerts } from '@/data/yard';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

/**
 * Owner setting: be emailed when someone clocks in away from the yard. The yard is the one set on the Yard Location screen. Workers can always
 * clock in; this only decides whether the owner is told, and how close counts as "at the yard".
 */
export default function YardAlertsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();

  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'notInstalled'>('loading');
  const [error, setError] = useState('');
  const [yard, setYard] = useState<YardAlerts | null>(null);
  const [alertOn, setAlertOn] = useState(false);
  const [radiusM, setRadiusM] = useState(DEFAULT_RADIUS_M);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const apply = useCallback((a: YardAlerts) => {
    setYard(a);
    setAlertOn(a.alertOn);
    setRadiusM(a.radiusM);
    setEmail(a.alertEmail);
  }, []);

  useEffect(() => {
    let alive = true;
    loadYardAlerts().then((r) => {
      if (!alive) return;
      if (!r.ok) { setError(r.error); setState(r.notInstalled ? 'notInstalled' : 'error'); return; }
      apply(r.data);
      setState('ready');
    });
    return () => { alive = false; };
  }, [apply]);

  async function save() {
    Keyboard.dismiss();
    setBusy(true);
    setFeedback(null);
    const r = await saveYardAlerts({ radiusM, alertOn, alertEmail: email });
    setBusy(false);
    if (!r.ok) { haptics.warning(); setFeedback({ tone: 'error', text: r.error }); return; }
    apply(r.data);
    haptics.success();
    setFeedback({ tone: 'success', text: r.data.alertOn ? 'Saved. You will be emailed when someone clocks in away from the yard.' : 'Saved. Clock-in emails are off.' });
  }

  const needsYard = yard && !yard.yardSet;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>Yard & clock-in alerts</Text>
      </View>

      {state === 'loading' ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><LoadingSpinner /></View> : null}

      {state === 'notInstalled' || state === 'error' ? (
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{state === 'notInstalled' ? 'Not ready yet' : 'Could not load this'}</Text>
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{error}</Text>
          {state === 'notInstalled' ? <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>The database update for clock-in alerts has not been run yet.</Text> : null}
        </View>
      ) : null}

      {state === 'ready' ? (
        <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance + spacing.lg }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Card title="Alerts">
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>Email me when someone clocks in away from the yard</Text>
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                  Workers can always clock in. If they are not at the yard, or their phone cannot give a location, you get an email with exactly where they clocked in from.
                </Text>
              </View>
              <Switch value={alertOn} onValueChange={setAlertOn} accessibilityLabel="Email me when someone clocks in away from the yard" />
            </View>
            {needsYard ? (
              <InlineNotice icon="alert-circle" tone="error" text="No yard location is set yet, so nothing can be checked. Set it first." style={{ marginTop: spacing.md }} />
            ) : (
              <View style={styles.savedRow}>
                <Icon name="map-pin" size={16} color={colors.primary} />
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flex: 1 }]}>Yard: {yard?.yardAddress || 'set on the Yard Location screen'}</Text>
              </View>
            )}
            <Pressable onPress={() => router.push('/(owner)/more/yard-location' as any)} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button">
              <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{needsYard ? 'Set the yard location' : 'Change the yard location'}</Text>
            </Pressable>
          </Card>

          <Card title="How close counts as at the yard" style={{ marginTop: spacing.lg }}>
            <View style={styles.chips}>
              {YARD_RADII.map((o) => {
                const on = o.meters === radiusM;
                return (
                  <Pressable key={o.meters} onPress={() => setRadiusM(o.meters)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={[styles.chip, { backgroundColor: on ? colors.primary : colors.backgroundSecondary, borderColor: on ? colors.primary : colors.border }]}>
                    <Text style={[typeScale.bodySmall, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '700' }]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>Anyone who clocks in within this distance of the yard counts as at the yard.</Text>
          </Card>

          <Card title="Send the email to" style={{ marginTop: spacing.lg }}>
            <Input value={email} onChangeText={setEmail} placeholder="Leave empty to use your account email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>Empty means every owner on the account gets it, at their own email address.</Text>
          </Card>

          {feedback ? <InlineNotice icon={feedback.tone === 'success' ? 'check-circle' : 'alert-circle'} tone={feedback.tone} text={feedback.text} style={{ marginTop: spacing.lg }} /> : null}
          <Button title="Save" onPress={save} loading={busy} fullWidth style={{ marginTop: spacing.lg }} />
        </KeyboardAwareScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
