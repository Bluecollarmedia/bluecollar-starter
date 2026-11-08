import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { DateField } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { REVIEW_LABEL, type ReviewState } from '@/lib/timeCalc';
import { localDateKey } from '@/lib/ids';
import { useT, tr } from '@/i18n';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

export const fmtClock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '–');
export const fmtDay = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtDayLong = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const money = (n: number | null | undefined) => (n == null ? tr('No rate set') : `$${n.toFixed(2)}`);
export const shiftDay = (key: string, days: number) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + days); return localDateKey(d); };

/** The frame every Hours & Labor screen shares: back arrow, title, optional right action, scrolling content, pull to refresh. */
export function LaborScreen({ title, subtitle, right, children, loading, onRefresh, onBack }: {
  title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode; loading?: boolean; onRefresh?: () => void; onBack?: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm, backgroundColor: colors.background, borderBottomColor: colors.borderLight }]}>
        <Pressable onPress={onBack ?? (() => router.back())} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Go back')}><Icon name="arrow-left" size={24} color={colors.textPrimary} /></Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <View style={{ minWidth: 24, alignItems: 'flex-end' }}>{right}</View>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: tabBarClearance + spacing.lg, gap: spacing.md }} refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} /> : undefined} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} /> : children}
      </ScrollView>
    </View>
  );
}

export function Card({ children, title, right, style }: { children: React.ReactNode; title?: string; right?: React.ReactNode; style?: object }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm, style]}>
      {title || right ? (
        <View style={styles.cardHead}>
          <Text style={[typeScale.overline, { color: colors.textSecondary, flex: 1 }]}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'good' }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 96 }}>
      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typeScale.headingLarge, { color: tone === 'warn' ? colors.warning : tone === 'good' ? colors.success : colors.textPrimary }]}>{value}</Text>
      {sub ? <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{sub}</Text> : null}
    </View>
  );
}

/** "label ...... value" line. The label says exactly which measure it is (never just "Hours"). */
export function KV({ label, value, bold, hint }: { label: string; value: string; bold?: boolean; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.kv}>
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{label}</Text>
        {hint ? <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{hint}</Text> : null}
      </View>
      <Text style={[bold ? typeScale.headingSmall : typeScale.bodyLarge, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

const STATE_TONE: Record<ReviewState, 'neutral' | 'info' | 'warn' | 'good'> = { in_progress: 'info', needs_correction: 'warn', needs_end_time: 'warn', ready: 'neutral', approved: 'good', reapproval: 'warn' };
export function StatePill({ state }: { state: ReviewState }) {
  const t = useT();
  const { colors } = useTheme();
  const tone = STATE_TONE[state];
  const bg = tone === 'good' ? colors.successLight : tone === 'warn' ? colors.warningLight : tone === 'info' ? colors.primarySurface : colors.backgroundTertiary;
  const fg = tone === 'good' ? colors.success : tone === 'warn' ? colors.warning : tone === 'info' ? colors.primaryDark : colors.textSecondary;
  return <View style={[styles.pill, { backgroundColor: bg }]}><Text style={[typeScale.labelSmall, { color: fg }]}>{t(REVIEW_LABEL[state])}</Text></View>;
}

export function Chip({ label, onPress, on, icon }: { label: string; onPress: () => void; on?: boolean; icon?: React.ComponentProps<typeof Icon>['name'] }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.chip, { backgroundColor: on ? colors.primary : colors.backgroundTertiary }]}>
      {icon ? <Icon name={icon} size={14} color={on ? '#FFFFFF' : colors.textPrimary} /> : null}
      <Text style={[typeScale.labelSmall, { color: on ? '#FFFFFF' : colors.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

/** Previous / next day with a date picker in the middle. */
export function DayBar({ dateKey, onChange }: { dateKey: string; onChange: (key: string) => void }) {
  const t = useT();
  const { colors } = useTheme();
  const today = localDateKey(new Date());
  return (
    <View style={styles.dayBar}>
      <Pressable onPress={() => onChange(shiftDay(dateKey, -1))} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Previous day')}><Icon name="chevron-left" size={26} color={colors.primary} /></Pressable>
      <View style={{ flex: 1 }}>
        <DateField label="" value={dateKey} onChange={onChange} maximumDate={shiftDay(today, 1)} placeholder={t('Pick a date')} />
      </View>
      <Pressable onPress={() => onChange(shiftDay(dateKey, 1))} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Next day')}><Icon name="chevron-right" size={26} color={dateKey >= today ? colors.textTertiary : colors.primary} /></Pressable>
    </View>
  );
}

export function Empty({ icon, text }: { icon: React.ComponentProps<typeof Icon>['name']; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing['2xl'], gap: spacing.sm }}>
      <Icon name={icon} size={36} color={colors.textTertiary} />
      <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

export function NotInstalled() {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Card>
      <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{t("Hours & Labor isn't switched on yet")}</Text>
      <Text style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {t('The database updates 63, 64 and 65 have not been run. Once they are, workdays and property times show up here.')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  card: { borderRadius: radius.lg, padding: spacing.lg },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  kv: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: spacing.md },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.full },
  dayBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
