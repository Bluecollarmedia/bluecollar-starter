import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Keyboard } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Avatar } from '@/components/ui';
import { Switch } from '@/components/ui/Switch';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { usePayroll, type PayrollEstimate, type OvertimeTerms } from '@/hooks/useOperations';
import { localDateKey } from '@/lib/ids';
import { db } from '@/data/store';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { showMessage } from '@/components/financials/ActionSheet';
import { fixed } from '@/theme/colors';

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatMoney(amount: number): string {
  return '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatMultiplier(m: number): string {
  return `${Number(m.toFixed(2))}x`;
}

function formatThreshold(hours: number): string {
  return `${Number(hours.toFixed(2))}h`;
}

function overtimeSummary(ot: OvertimeTerms): string {
  return ot.enabled ? `OT ${formatMultiplier(ot.multiplier)} after ${formatThreshold(ot.afterHours)}` : 'No OT';
}

function showAlert(title: string, msg: string) {
  showMessage(title, msg);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PayrollScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const {
    getPayrollEstimates, getRatesForWorker, setHourlyRate, setWorkerOvertime,
    targetPayEnabled, setTargetPayEnabled, setTargetRate,
  } = usePayroll();

  const getTargetRate = (personId: string) => db.paySettings[personId]?.targetHourlyRate;
  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);

  const referenceDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + weekOffset * 7);
    return localDateKey(d);
  }, [weekOffset]);

  const estimates = useMemo(
    () => getPayrollEstimates(referenceDate),
    [getPayrollEstimates, referenceDate],
  );

  const weekRange = useMemo(() => {
    if (estimates.length > 0) return { start: estimates[0].weekStart, end: estimates[0].weekEnd };
    return { start: referenceDate, end: referenceDate };
  }, [estimates, referenceDate]);

  const totalPay = useMemo(
    () => estimates.reduce((sum, e) => sum + e.totalPay, 0),
    [estimates],
  );

  const totalHours = useMemo(
    () => estimates.reduce((sum, e) => sum + e.regularHours + e.overtimeHours, 0),
    [estimates],
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, borderBottomColor: colors.borderLight }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>
          Payroll Estimate
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.weekNav, { borderBottomColor: colors.borderLight }]}>
        <Pressable onPress={() => setWeekOffset((w) => w - 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous week">
          <Icon name="chevron-left" size={24} color={colors.primary} />
        </Pressable>
        <View style={styles.weekLabelWrap}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
            {formatDate(weekRange.start)} – {formatDate(weekRange.end)}
          </Text>
          {weekOffset === 0 && (
            <Text style={[typeScale.caption, { color: colors.primary }]}>This Week</Text>
          )}
        </View>
        <Pressable onPress={() => setWeekOffset((w) => w + 1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next week">
          <Icon name="chevron-right" size={24} color={weekOffset >= 0 ? colors.textTertiary : colors.primary} />
        </Pressable>
      </View>

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.summaryRow, { gap: spacing.md }]}>
          <View style={[styles.summaryCard, { backgroundColor: colors.primarySurface }, shadow.sm]}>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>ESTIMATED TOTAL</Text>
            <Text style={[typeScale.displaySmall, { color: colors.primary }]}>
              {formatMoney(totalPay)}
            </Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>TOTAL HOURS</Text>
            <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]}>
              {formatHours(totalHours)}
            </Text>
          </View>
        </View>

        <View style={[styles.modeCard, { backgroundColor: colors.surface }, shadow.sm]}>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Target-Pay Mode</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
              {targetPayEnabled
                ? 'Workers with a target rate get target × hours. Overtime is absorbed into a lower base rate.'
                : 'Off: standard overtime at each worker\'s hourly rate.'}
            </Text>
          </View>
          <Switch value={targetPayEnabled} onValueChange={setTargetPayEnabled} accessibilityLabel="Target-Pay Mode" />
        </View>

        <View style={[styles.otBanner, { backgroundColor: colors.infoLight }]}>
          <Icon name="info" size={14} color={colors.info} />
          <Text style={[typeScale.caption, { color: colors.info, flex: 1 }]}>
            Each worker has their own rate and overtime. Tap a worker to change them.
          </Text>
        </View>

        <View style={[styles.disclaimer, { backgroundColor: colors.warningLight }]}>
          <Icon name="alert-triangle" size={14} color={colors.warning} />
          <Text style={[typeScale.caption, { color: colors.textSecondary, flex: 1 }]}>
            These are estimates based on tracked hours and current rates. Not a substitute for professional payroll processing.
          </Text>
        </View>

        {estimates.map((est) => (
          <PayrollCard
            key={est.personId}
            estimate={est}
            rateHistory={getRatesForWorker(est.personId)}
            onSetRate={(rate) => setHourlyRate(est.personId, rate)}
            onSetOvertime={(terms) => setWorkerOvertime(est.personId, terms)}
            targetPayOn={targetPayEnabled}
            targetRate={getTargetRate(est.personId)}
            onSetTarget={(rate) => setTargetRate(est.personId, rate)}
            expanded={expandedWorker === est.personId}
            onToggle={() =>
              setExpandedWorker((prev) => (prev === est.personId ? null : est.personId))
            }
            colors={colors}
          />
        ))}
      </KeyboardAwareScrollView>
    </View>
  );
}

function PayrollCard({
  estimate,
  rateHistory,
  onSetRate,
  onSetOvertime,
  targetPayOn,
  targetRate,
  onSetTarget,
  expanded,
  onToggle,
  colors,
}: {
  estimate: PayrollEstimate;
  rateHistory: any[];
  onSetRate: (rate: number) => void;
  onSetOvertime: (terms: { enabled: boolean; afterHours: number; multiplier: number }) => void;
  targetPayOn: boolean;
  targetRate?: number;
  onSetTarget: (rate: number) => void;
  expanded: boolean;
  onToggle: () => void;
  colors: any;
}) {
  const [rateDraft, setRateDraft] = useState('');

  function handleSaveRate() {
    const rate = Number(rateDraft.replace(/[^0-9.]/g, ''));
    if (!rateDraft.trim() || !Number.isFinite(rate) || rate <= 0) {
      const msg = 'Enter an hourly rate, like 22 or 22.50.';
      showMessage('Check the rate', msg);
      return;
    }
    onSetRate(Math.round(rate * 100) / 100);
    setRateDraft('');
    // Saved: put the keyboard away and fold this worker's card back up.
    Keyboard.dismiss();
    onToggle();
  }

  const [targetDraft, setTargetDraft] = useState('');

  function handleSaveTarget() {
    const rate = Number(targetDraft.replace(/[^0-9.]/g, ''));
    if (!targetDraft.trim() || !Number.isFinite(rate) || rate <= 0) {
      showAlert('Check the target rate', 'Enter a target hourly rate, like 35 or 35.50.');
      return;
    }
    onSetTarget(Math.round(rate * 100) / 100);
    setTargetDraft('');
    Keyboard.dismiss();
  }

  const ot = estimate.overtime;
  const tp = estimate.targetPay;
  const [afterDraft, setAfterDraft] = useState('');
  const [multDraft, setMultDraft] = useState('');
  const otDirty = afterDraft.trim() !== '' || multDraft.trim() !== '';

  function handleToggleOvertime(enabled: boolean) {
    onSetOvertime({ enabled, afterHours: ot.afterHours, multiplier: ot.multiplier });
  }

  function handleSaveOvertime() {
    const afterHours = afterDraft.trim() ? Number(afterDraft.replace(/[^0-9.]/g, '')) : ot.afterHours;
    const multiplier = multDraft.trim() ? Number(multDraft.replace(/[^0-9.]/g, '')) : ot.multiplier;
    if (!Number.isFinite(afterHours) || afterHours <= 0 || afterHours > 168) {
      showAlert('Check the hours', 'Enter the hours a week before overtime starts, like 40.');
      return;
    }
    if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10) {
      showAlert('Check the multiplier', 'Enter how much overtime pays, like 1.5 or 2.');
      return;
    }
    onSetOvertime({
      enabled: true,
      afterHours: Math.round(afterHours * 100) / 100,
      multiplier: Math.round(multiplier * 100) / 100,
    });
    setAfterDraft('');
    setMultDraft('');
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
      <Pressable style={styles.cardHeader} onPress={onToggle}>
        <Avatar
          firstName={estimate.worker.firstName}
          lastName={estimate.worker.lastName}
          size={40}
          uri={estimate.worker.avatarUrl}
        />
        <View style={styles.cardInfo}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
            {estimate.worker.firstName} {estimate.worker.lastName}
          </Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
            {formatHours(estimate.regularHours + estimate.overtimeHours)} · {tp ? `$${tp.targetRate} target` : `$${estimate.regularRate}/hr`}
          </Text>
          <Text style={[typeScale.caption, { color: ot.enabled ? colors.textSecondary : colors.textTertiary }]}>
            {overtimeSummary(ot)}
          </Text>
        </View>
        <Text style={[typeScale.headingLarge, { color: colors.primary }]}>
          {formatMoney(estimate.totalPay)}
        </Text>
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textTertiary}
          style={{ marginLeft: spacing.sm }}
        />
      </Pressable>

      {expanded && (
        <View style={[styles.cardBody, { borderTopColor: colors.borderLight }]}>
          {tp ? (
            <TargetPayStub estimate={estimate} tp={tp} colors={colors} />
          ) : (
            <View style={styles.payBreakdown}>
              <View style={styles.payRow}>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>Regular hours</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                  {formatHours(estimate.regularHours)}
                </Text>
              </View>
              <View style={styles.payRow}>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>Rate</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                  ${estimate.regularRate.toFixed(2)}/hr
                </Text>
              </View>
              <View style={styles.payRow}>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>Regular pay</Text>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                  {formatMoney(estimate.regularPay)}
                </Text>
              </View>

              {estimate.overtimeHours > 0 && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
                  <View style={styles.payRow}>
                    <Text style={[typeScale.bodySmall, { color: colors.warning }]}>Overtime hours</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.warning }]}>
                      {formatHours(estimate.overtimeHours)}
                    </Text>
                  </View>
                  <View style={styles.payRow}>
                    <Text style={[typeScale.bodySmall, { color: colors.warning }]}>OT rate</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.warning }]}>
                      ${estimate.overtimeRate.toFixed(2)}/hr
                    </Text>
                  </View>
                  <View style={styles.payRow}>
                    <Text style={[typeScale.bodySmall, { color: colors.warning }]}>Overtime pay</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.warning }]}>
                      {formatMoney(estimate.overtimePay)}
                    </Text>
                  </View>
                </>
              )}

              <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
              <View style={styles.payRow}>
                <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Total estimate</Text>
                <Text style={[typeScale.labelLarge, { color: colors.primary }]}>
                  {formatMoney(estimate.totalPay)}
                </Text>
              </View>
            </View>
          )}
          {targetPayOn && !tp && (
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>
              No target rate set, so standard overtime applies.
            </Text>
          )}

          <View style={[styles.rateHistory, { borderTopColor: colors.borderLight }]}>
            <Text style={[typeScale.overline, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
              {rateHistory.length === 0 ? 'SET PAY RATE' : 'CHANGE PAY RATE (FROM TODAY)'}
            </Text>
            <View style={styles.rateInputRow}>
              <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>$</Text>
              <TextInput
                value={rateDraft}
                onChangeText={setRateDraft}
                placeholder={estimate.regularRate ? estimate.regularRate.toFixed(2) : '0.00'}
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
                style={[styles.rateInput, { color: colors.textPrimary, borderColor: colors.border }]}
                accessibilityLabel="Hourly rate"
              />
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>/hr</Text>
              <Pressable onPress={handleSaveRate} style={[styles.rateSave, { backgroundColor: colors.primary }]} accessibilityRole="button">
                <Text style={[typeScale.labelSmall, { color: fixed.white, fontWeight: '600' }]}>Save</Text>
              </Pressable>
            </View>
          </View>

          {targetPayOn && (
            <View style={[styles.rateHistory, { borderTopColor: colors.borderLight }]}>
              <Text style={[typeScale.overline, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
                TARGET RATE (OVERTIME INCLUDED)
              </Text>
              <View style={styles.rateInputRow}>
                <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>$</Text>
                <TextInput
                  value={targetDraft}
                  onChangeText={setTargetDraft}
                  placeholder={targetRate ? targetRate.toFixed(2) : '0.00'}
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  style={[styles.rateInput, { color: colors.textPrimary, borderColor: colors.border }]}
                  accessibilityLabel="Target hourly rate"
                />
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>/hr</Text>
                <Pressable onPress={handleSaveTarget} style={[styles.rateSave, { backgroundColor: colors.primary }]} accessibilityRole="button">
                  <Text style={[typeScale.labelSmall, { color: fixed.white, fontWeight: '600' }]}>Save</Text>
                </Pressable>
              </View>
              <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                What {estimate.worker.firstName} should earn per hour worked, with overtime absorbed into a lower base rate.
              </Text>
            </View>
          )}

          <View style={[styles.rateHistory, { borderTopColor: colors.borderLight }]}>
            <View style={styles.otToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Gets overtime</Text>
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                  {ot.enabled ? `${formatMultiplier(ot.multiplier)} pay after ${formatThreshold(ot.afterHours)} a week` : 'Always paid the regular rate'}
                  {!ot.isCustom && ' (company default)'}
                </Text>
              </View>
              <Switch
                value={ot.enabled}
                onValueChange={handleToggleOvertime}
                accessibilityLabel={`Overtime for ${estimate.worker.firstName}`}
              />
            </View>

            {ot.enabled && (
              <View style={styles.otFields}>
                <View style={styles.otField}>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Starts after</Text>
                  <View style={styles.rateInputRow}>
                    <TextInput
                      value={afterDraft}
                      onChangeText={setAfterDraft}
                      placeholder={String(ot.afterHours)}
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                      style={[styles.rateInput, { color: colors.textPrimary, borderColor: colors.border }]}
                      accessibilityLabel="Hours a week before overtime starts"
                    />
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>hrs/wk</Text>
                  </View>
                </View>
                <View style={styles.otField}>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Pays</Text>
                  <View style={styles.rateInputRow}>
                    <TextInput
                      value={multDraft}
                      onChangeText={setMultDraft}
                      placeholder={String(ot.multiplier)}
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                      style={[styles.rateInput, { color: colors.textPrimary, borderColor: colors.border }]}
                      accessibilityLabel="Overtime multiplier"
                    />
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>× rate</Text>
                  </View>
                </View>
                {otDirty && (
                  <Pressable onPress={handleSaveOvertime} style={[styles.rateSave, styles.otSave, { backgroundColor: colors.primary }]} accessibilityRole="button">
                    <Text style={[typeScale.labelSmall, { color: fixed.white, fontWeight: '600' }]}>Save overtime</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {rateHistory.length > 1 && (
            <View style={[styles.rateHistory, { borderTopColor: colors.borderLight }]}>
              <Text style={[typeScale.overline, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
                RATE HISTORY
              </Text>
              {rateHistory.map((r) => (
                <View key={r.id} style={styles.rateRow}>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                    {new Date(r.effectiveDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {r.endDate && ` – ${new Date(r.endDate + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    {!r.endDate && ' – Present'}
                  </Text>
                  <Text style={[typeScale.labelSmall, { color: colors.textPrimary }]}>
                    ${r.hourlyRate.toFixed(2)}/hr
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function StubRow({ label, value, strong, color, colors }: { label: string; value: string; strong?: boolean; color?: string; colors: any }) {
  const style = strong ? typeScale.labelLarge : typeScale.bodySmall;
  return (
    <View style={styles.payRow}>
      <Text style={[style, { color: color ?? (strong ? colors.textPrimary : colors.textSecondary) }]}>{label}</Text>
      <Text style={[style, { color: color ?? colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

function TargetPayStub({ estimate, tp, colors }: { estimate: PayrollEstimate; tp: NonNullable<PayrollEstimate['targetPay']>; colors: any }) {
  const otRate = tp.solvedBaseRate * estimate.overtime.multiplier;
  const diff = Math.round((estimate.standardPay - tp.grossPay) * 100) / 100;
  return (
    <View style={styles.payBreakdown}>
      <StubRow label="Hours worked" value={formatHours(tp.totalHours)} colors={colors} />
      <StubRow label="Target rate" value={`$${tp.targetRate.toFixed(2)}/hr`} colors={colors} />
      <StubRow label="Solved base rate" value={`$${tp.solvedBaseRate.toFixed(2)}/hr`} colors={colors} />
      <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
      <StubRow
        label={`Regular  ${formatHours(tp.regularHours)} × $${tp.solvedBaseRate.toFixed(2)}`}
        value={formatMoney(tp.regularPay)}
        colors={colors}
      />
      {tp.overtimeHours > 0 && (
        <StubRow
          label={`Overtime  ${formatHours(tp.overtimeHours)} × $${otRate.toFixed(2)}`}
          value={formatMoney(tp.overtimePay)}
          color={colors.warning}
          colors={colors}
        />
      )}
      <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
      <StubRow label="Gross (target-pay)" value={formatMoney(tp.grossPay)} strong color={colors.primary} colors={colors} />

      <View style={styles.compareRow}>
        <View style={[styles.compareBox, { backgroundColor: colors.primarySurface }]}>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Target-pay</Text>
          <Text style={[typeScale.headingLarge, { color: colors.primary }]}>{formatMoney(tp.grossPay)}</Text>
        </View>
        <View style={[styles.compareBox, { backgroundColor: colors.backgroundSecondary }]}>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Standard overtime</Text>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{formatMoney(estimate.standardPay)}</Text>
          <Text style={[typeScale.caption, { color: colors.textTertiary }]}>at ${estimate.regularRate.toFixed(2)}/hr</Text>
        </View>
      </View>
      {diff !== 0 && (
        <Text style={[typeScale.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
          {diff > 0 ? `${formatMoney(diff)} less than standard overtime` : `${formatMoney(-diff)} more than standard overtime`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  weekLabelWrap: { alignItems: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing['5xl'], gap: spacing.md },
  summaryRow: { flexDirection: 'row' },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.md,
  },
  otBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  card: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardInfo: { flex: 1 },
  cardBody: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1 },
  payBreakdown: { gap: spacing.xs },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing['2xs'] },
  divider: { height: 1, marginVertical: spacing.sm },
  rateHistory: { borderTopWidth: 1, marginTop: spacing.md, paddingTop: spacing.md },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  rateInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rateInput: { flex: 1, minWidth: 0, borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 16 },
  modeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md },
  compareRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  compareBox: { flex: 1, alignItems: 'center', padding: spacing.md, borderRadius: radius.sm, gap: spacing['2xs'] },
  otToggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  otFields: { marginTop: spacing.md, gap: spacing.sm },
  otField: { gap: spacing['2xs'] },
  otSave: { alignSelf: 'flex-end', marginTop: spacing.xs },
  rateSave: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.full },
});
