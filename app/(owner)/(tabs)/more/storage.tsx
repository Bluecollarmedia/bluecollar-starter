import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { Card, LoadingSpinner, GlassIconButton } from '@/components/ui';
import { PressScale, UsageBar } from '@/components/settings/SettingsList';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { useStorageInfo, useStorageLimit, useMaxFileSize } from '@/hooks/useStorage';
import { MAX_FILE_PRESETS_MB, SERVER_MAX_FILE_MB, mbLabel, parseMaxFileMb } from '@/lib/uploadLimit';
import { haptics } from '@/lib/haptics';
import {
  formatBytes,
  storageLimitLabel,
  STORAGE_LIMIT_OPTIONS_GB,
  SUPABASE_FREE_PLAN_GB,
} from '@/types/storage';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { w } from '@/config/brand';

export default function StorageScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { info, loading, error, refresh } = useStorageInfo();
  const { limitGb, limitBytes, setLimitGb } = useStorageLimit();
  const { maxMb, setMaxMb } = useMaxFileSize();
  const [maxText, setMaxText] = useState('');
  const typedMax = parseMaxFileMb(maxText);
  const presetIndex = STORAGE_LIMIT_OPTIONS_GB.indexOf(limitGb as typeof STORAGE_LIMIT_OPTIONS_GB[number]);
  const [customOpen, setCustomOpen] = useState(presetIndex === -1);
  const [customText, setCustomText] = useState(presetIndex === -1 ? String(limitGb) : '');
  const customIndex = STORAGE_LIMIT_OPTIONS_GB.length;
  const selectedIndex = customOpen || presetIndex === -1 ? customIndex : presetIndex;
  const customGb = Number(customText);
  const customValid = /^\d+$/.test(customText.trim()) && customGb >= 1 && customGb <= 1_000_000;

  // Keep the box in sync when the limit changes elsewhere (another device, Realtime).
  useEffect(() => {
    if (presetIndex === -1) {
      setCustomOpen(true);
      setCustomText(String(limitGb));
    }
  }, [limitGb, presetIndex]);

  function saveCustom() {
    if (!customValid) return;
    haptics.success();
    setLimitGb(customGb);
    Keyboard.dismiss();
  }

  if (loading && !info) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <Header colors={colors} insets={insets} onBack={() => router.back()} />
        <LoadingSpinner />
      </View>
    );
  }

  const usage = info?.usage;
  const settings = info?.settings;

  const unlimited = limitBytes === 0;
  const usagePercent = unlimited ? 0 : Math.round(((usage?.totalBytes ?? 0) / limitBytes) * 100);
  const usageColor = usagePercent > 90
    ? semantic.error
    : usagePercent > 75
      ? semantic.warning
      : colors.primary;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Header colors={colors} insets={insets} onBack={() => router.back()} />

      <ScrollView bounces={false} contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        {error && (
          <View style={[styles.errorBanner, { backgroundColor: semantic.errorLight }]}>
            <Icon name="alert-circle" size={16} color={semantic.error} />
            <Text style={[typeScale.caption, { color: semantic.error, flex: 1, marginLeft: spacing.sm }]}>
              {error}
            </Text>
            <Pressable onPress={refresh}>
              <Text style={[typeScale.labelSmall, { color: semantic.error }]}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* Usage Overview */}
        <Card title="Storage Usage" style={styles.card}>
          <View style={styles.usageHeader}>
            <View style={[styles.usageIcon, { backgroundColor: usageColor + '15' }]}>
              <Icon name="hard-drive" size={24} color={usageColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>
                {formatBytes(usage?.totalBytes ?? 0)}
              </Text>
              <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                {unlimited ? 'used · no limit set' : `of ${storageLimitLabel(limitGb)} used`}
              </Text>
            </View>
            {!unlimited && (
              <View style={[styles.percentBadge, { backgroundColor: usageColor + '15' }]}>
                <Text style={[typeScale.labelSmall, { color: usageColor, fontWeight: '700' }]}>
                  {usagePercent}%
                </Text>
              </View>
            )}
          </View>

          {!unlimited && (
            <View style={{ marginTop: spacing.md }}>
              <UsageBar percent={usagePercent} color={usageColor} height={8} />
            </View>
          )}

          {usagePercent > 90 && (
            <View style={[styles.warningBanner, { backgroundColor: semantic.errorLight }]}>
              <Icon name="alert-triangle" size={14} color={semantic.error} />
              <Text style={[typeScale.caption, { color: semantic.error, flex: 1, marginLeft: spacing.xs }]}>
                Storage is almost full. Delete unused files or pick a bigger limit below.
              </Text>
            </View>
          )}
        </Card>

        {/* Storage Limit */}
        <Card title="Storage Limit" style={styles.card}>
          <SegmentedControl
            values={[...STORAGE_LIMIT_OPTIONS_GB.map(shortLimitLabel), 'Custom']}
            selectedIndex={selectedIndex}
            onChange={(event) => {
              haptics.select();
              const i = event.nativeEvent.selectedSegmentIndex;
              if (i === customIndex) {
                setCustomOpen(true);
                if (!customText && limitGb > 0) setCustomText(String(limitGb));
                return;
              }
              setCustomOpen(false);
              setLimitGb(STORAGE_LIMIT_OPTIONS_GB[i]);
            }}
            tintColor={colors.primary}
            appearance="light"
            backgroundColor={colors.groupedBackground}
            fontStyle={{ color: colors.textSecondary }}
            activeFontStyle={{ color: '#FFFFFF', fontWeight: '600' }}
            style={styles.segment}
          />
          {selectedIndex === customIndex && (
            <View style={styles.customRow}>
              <View style={[styles.customField, { backgroundColor: colors.groupedBackground }]}>
                <TextInput
                  value={customText}
                  onChangeText={(t) => setCustomText(t.replace(/[^0-9]/g, ''))}
                  onSubmitEditing={saveCustom}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  placeholder="e.g. 250"
                  placeholderTextColor={colors.textTertiary}
                  style={[typeScale.bodyLarge, styles.customInput, { color: colors.textPrimary }]}
                  accessibilityLabel="Custom storage limit in GB"
                />
                <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>GB</Text>
              </View>
              <PressScale
                onPress={customValid ? saveCustom : undefined}
                disabled={!customValid}
                style={[
                  styles.customSave,
                  { backgroundColor: customValid ? colors.primary : colors.backgroundTertiary },
                ]}
                accessibilityLabel="Save storage limit"
              >
                <Text style={[typeScale.labelLarge, { color: customValid ? '#FFFFFF' : colors.textTertiary }]}>
                  {customValid && customGb === limitGb ? 'Saved' : 'Save'}
                </Text>
              </PressScale>
            </View>
          )}
          {(unlimited || limitGb > SUPABASE_FREE_PLAN_GB) ? (
            <View style={[styles.noteBox, { backgroundColor: semantic.infoLight }]}>
              <Icon name="info" size={14} color={semantic.info} />
              <Text style={[typeScale.caption, { color: semantic.info, flex: 1, marginLeft: spacing.xs }]}>
                New photos and videos are saved on Cloudflare R2: the first 10 GB are free, then about
                1.5¢ per GB per month, with no charge for viewing them. Older files stay in Supabase.
              </Text>
            </View>
          ) : (
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>
              New photos and videos are saved on Cloudflare R2, which includes 10 GB free.
            </Text>
          )}
        </Card>

        {/* File Breakdown */}
        <Card title="File Breakdown" style={styles.card}>
          <StatRow
            icon="image"
            label={w('Job Photos & Videos')}
            value={String(usage?.photoCount ?? 0)}
            colors={colors}
          />
          <StatRow
            icon="user"
            label="Profile Photos"
            value={String(usage?.avatarCount ?? 0)}
            colors={colors}
          />
          <StatRow
            icon="file"
            label="Documents"
            value={String(usage?.documentCount ?? 0)}
            colors={colors}
          />
          <View style={[styles.divider, { borderTopColor: colors.borderLight }]} />
          <StatRow
            icon="database"
            label="Total Files"
            value={String(usage?.fileCount ?? 0)}
            colors={colors}
            bold
          />
        </Card>

        {/* Storage Limits */}
        <Card title="Upload Limits" style={styles.card}>
          <View>
            <View style={styles.maxHead}>
              <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>Max File Size</Text>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{mbLabel(maxMb)}</Text>
            </View>
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
              The biggest single photo or video anyone can upload. Bigger files are turned away with a clear message.
            </Text>
            <View style={styles.maxChips}>
              {MAX_FILE_PRESETS_MB.map((mb) => (
                <Pressable
                  key={mb}
                  onPress={() => { haptics.select(); setMaxText(''); setMaxMb(mb); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: maxMb === mb }}
                  accessibilityLabel={`Set the max file size to ${mbLabel(mb)}`}
                  style={[styles.maxChip, { backgroundColor: maxMb === mb ? colors.primary : colors.groupedBackground }]}
                >
                  <Text style={[typeScale.labelLarge, { color: maxMb === mb ? '#FFFFFF' : colors.textSecondary }]}>{mb}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.customRow}>
              <View style={[styles.customField, { backgroundColor: colors.groupedBackground }]}>
                <TextInput
                  value={maxText}
                  onChangeText={(t) => setMaxText(t.replace(/[^0-9]/g, '').slice(0, 3))}
                  onSubmitEditing={() => { if (typedMax) { haptics.success(); setMaxMb(typedMax); setMaxText(''); Keyboard.dismiss(); } }}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  placeholder={`Other, 1 to ${SERVER_MAX_FILE_MB}`}
                  placeholderTextColor={colors.textTertiary}
                  style={[typeScale.bodyLarge, styles.customInput, { color: colors.textPrimary }]}
                  accessibilityLabel="Custom max file size in MB"
                />
                <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>MB</Text>
              </View>
              <PressScale
                onPress={typedMax ? () => { haptics.success(); setMaxMb(typedMax); setMaxText(''); Keyboard.dismiss(); } : undefined}
                disabled={!typedMax}
                style={[styles.customSave, { backgroundColor: typedMax ? colors.primary : colors.backgroundTertiary }]}
                accessibilityLabel="Save max file size"
              >
                <Text style={[typeScale.labelLarge, { color: typedMax ? '#FFFFFF' : colors.textTertiary }]}>Save</Text>
              </PressScale>
            </View>
          </View>
          <LimitRow
            label="Upload Rate"
            value={`${settings?.rateLimitPerMinute ?? 0}/min, ${settings?.rateLimitPerHour ?? 0}/hr`}
            colors={colors}
          />
        </Card>

        {/* Allowed File Types */}
        <Card title="Allowed File Types" style={styles.card}>
          <View style={styles.typeGrid}>
            {['JPEG', 'PNG', 'WebP', 'HEIC'].map(type => (
              <View key={type} style={[styles.typeChip, { backgroundColor: colors.primarySurface }]}>
                <Icon name="check" size={12} color={colors.primary} />
                <Text style={[typeScale.caption, { color: colors.primary, marginLeft: 4 }]}>
                  {type}
                </Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Info */}
        <View style={[styles.infoBox, { backgroundColor: colors.surface }, shadow.sm]}>
          <Icon name="shield" size={16} color={colors.primary} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '500' }]}>
              Secure Storage
            </Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>
              All uploads are validated server-side. Files are stored in Cloudflare R2 with
              signed URLs. Storage credentials never leave the server.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** Short labels so five options fit across a phone screen. */
function shortLimitLabel(limitGb: number): string {
  if (limitGb === 0) return 'Unlimited';
  return limitGb >= 1000 && limitGb % 1000 === 0 ? `${limitGb / 1000} TB` : `${limitGb} GB`;
}

function Header({ colors, insets, onBack }: { colors: any; insets: any; onBack: () => void }) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <GlassIconButton icon="chevron-left" onPress={onBack} accessibilityLabel="Go back" />
      <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>
        Storage
      </Text>
    </View>
  );
}

function StatRow({ icon, label, value, colors, bold }: {
  icon: string; label: string; value: string; colors: any; bold?: boolean;
}) {
  return (
    <View style={styles.statRow}>
      <Icon name={icon as any} size={16} color={colors.textTertiary} />
      <Text style={[
        bold ? typeScale.bodyLarge : typeScale.bodySmall,
        { color: colors.textPrimary, flex: 1, marginLeft: spacing.sm },
        bold && { fontWeight: '600' },
      ]}>
        {label}
      </Text>
      <Text style={[
        bold ? typeScale.bodyLarge : typeScale.bodySmall,
        { color: colors.textPrimary },
        bold && { fontWeight: '600' },
      ]}>
        {value}
      </Text>
    </View>
  );
}

function LimitRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={styles.limitRow}>
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '500' }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  maxHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  maxChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  maxChip: { minWidth: 52, height: 38, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  card: { marginBottom: spacing.lg },
  segment: { height: 36 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  customField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  customInput: { flex: 1, minWidth: 0, paddingVertical: 0 },
  customSave: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    borderRadius: radius.xs,
    marginTop: spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  usageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  usageIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.xs,
    marginTop: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: 1,
    marginVertical: spacing.xs,
  },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
});
