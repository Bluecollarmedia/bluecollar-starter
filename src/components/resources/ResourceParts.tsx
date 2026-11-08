/**
 * Small building blocks shared by the owner and worker Company Resources
 * screens: category icon, resource row, checkbox row and the protected-code
 * field (masked by default, Reveal + Copy).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { haptics } from '@/lib/haptics';
import { RESOURCE_CATEGORIES, RESOURCE_CATEGORY_ORDER, type ResourceCategory } from '@/types/resource';
import type { ResourceView } from '@/hooks/useResources';
import type { PersonSummary } from '@/types/company';
import { useT, tr } from '@/i18n';

/** Groups resources by category in the standard order, skipping empty ones. */
export function groupByCategory<T extends { category: ResourceCategory }>(items: T[]) {
  return RESOURCE_CATEGORY_ORDER
    .map((category) => ({ category, info: RESOURCE_CATEGORIES[category], items: items.filter((i) => i.category === category) }))
    .filter((g) => g.items.length > 0);
}

/** Matches name, linked truck/equipment, description, holder and category. */
export function matchesResource(r: ResourceView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [r.name, r.truckName, r.itemName, r.description, r.cardHolderName, RESOURCE_CATEGORIES[r.category].label, tr(RESOURCE_CATEGORIES[r.category].label)]
    .some((f) => f?.toLowerCase().includes(q));
}

/** The one-line detail under a resource name (vehicle, equipment or card). */
export function resourceContext(r: ResourceView): string | undefined {
  if (r.category === 'vehicle') return r.truckName;
  if (r.category === 'equipment') return r.itemName;
  if (r.category === 'company_card') {
    return [r.cardLastFour ? `•••• ${r.cardLastFour}` : undefined, r.cardHolderName].filter(Boolean).join(' · ') || undefined;
  }
  return undefined;
}

export function CategoryIcon({ category, size = 32 }: { category: ResourceCategory; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.iconWrap, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySurface }]}>
      <Icon name={RESOURCE_CATEGORIES[category].icon} size={size * 0.5} color={colors.primary} />
    </View>
  );
}

interface ResourceRowProps {
  resource: ResourceView;
  onPress: () => void;
  /** Owner only: shows the "N workers" Manage Access pill. */
  onManageAccess?: () => void;
}

export function ResourceRow({ resource: r, onPress, onManageAccess }: ResourceRowProps) {
  const t = useT();
  const { colors } = useTheme();
  const context = resourceContext(r);
  // Row and Manage Access pill are siblings, not nested, so each is its own
  // button (nested buttons aren't valid on web).
  return (
    <View style={styles.rowOuter}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, { flex: 1 }, pressed && { backgroundColor: colors.backgroundSecondary }]}
        accessibilityRole="button"
        accessibilityLabel={r.name}
      >
        <CategoryIcon category={r.category} />
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{r.name}</Text>
          <View style={styles.metaRow}>
            {context && (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flexShrink: 1 }]} numberOfLines={1}>{context}</Text>
            )}
            {r.hasSecret && (
              <View style={styles.lockTag} accessibilityLabel={t('Protected code stored')}>
                <Icon name="lock" size={11} color={colors.textTertiary} />
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginLeft: 3 }]}>{t('Code')}</Text>
              </View>
            )}
          </View>
        </View>
        {!onManageAccess && <Icon name="chevron-right" size={18} color={colors.textTertiary} />}
      </Pressable>
      {onManageAccess && (
        <Pressable
          onPress={onManageAccess}
          hitSlop={6}
          style={({ pressed }) => [styles.accessPill, { backgroundColor: pressed ? colors.border : colors.primarySurface }]}
          accessibilityRole="button"
          accessibilityLabel={r.accessCount === 1 ? t('Manage access, 1 worker') : t('Manage access, {n} workers', { n: r.accessCount })}
        >
          <Icon name="users" size={13} color={colors.primaryDark} />
          <Text style={[typeScale.labelSmall, { color: colors.primaryDark, marginLeft: 4 }]}>{r.accessCount}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.checkbox,
        checked ? { backgroundColor: colors.primary, borderColor: colors.primary } : { borderColor: colors.border },
      ]}
    >
      {checked && <Icon name="check" size={14} color={colors.textOnPrimary} />}
    </View>
  );
}

interface PersonCheckRowProps {
  person: PersonSummary;
  checked: boolean;
  onToggle: () => void;
}

export function PersonCheckRow({ person, checked, onToggle }: PersonCheckRowProps) {
  const t = useT();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.backgroundSecondary }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${person.firstName} ${person.lastName}`}
    >
      <Avatar firstName={person.firstName} lastName={person.lastName} size={36} uri={person.avatarUrl} />
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>
          {person.firstName} {person.lastName}
        </Text>
        <Text style={[typeScale.caption, { color: checked ? colors.primaryDark : colors.textTertiary }]}>
          {checked ? t('Has access') : t('No access')}
        </Text>
      </View>
      <Checkbox checked={checked} />
    </Pressable>
  );
}

const HIDE_AFTER_MS = 30_000;

interface ProtectedCodeProps {
  label: string;
  reveal: () => Promise<{ code: string | null } | { error: string }>;
  /** Called when the server says the resource is no longer available. */
  onUnavailable?: () => void;
}

/**
 * Masked code with Reveal and Copy. The code is fetched from the server on
 * demand (never stored with the resource), kept only in this component's
 * state, and cleared when the screen loses focus or after 30 seconds.
 */
export function ProtectedCode({ label, reveal, onUnavailable }: ProtectedCodeProps) {
  const t = useT();
  const { colors } = useTheme();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    setCode(null);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  // Leaving the screen (or backgrounding into another screen) hides the code.
  useFocusEffect(useCallback(() => hide, [hide]));
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  async function fetchCode(): Promise<string | null> {
    if (code) return code;
    setBusy(true);
    setError(null);
    const res = await reveal();
    setBusy(false);
    if ('error' in res) {
      setError(res.error);
      onUnavailable?.();
      return null;
    }
    if (!res.code) {
      setError(t('No code is stored.'));
      return null;
    }
    setCode(res.code);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setCode(null), HIDE_AFTER_MS);
    return res.code;
  }

  async function handleCopy() {
    const value = await fetchCode();
    if (!value) return;
    await Clipboard.setStringAsync(value);
    haptics.success();
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View>
      <Text style={[typeScale.overline, { color: colors.textTertiary, marginBottom: spacing.xs }]}>{t(label).toUpperCase()}</Text>
      <View style={[styles.codeBox, { backgroundColor: colors.backgroundSecondary }]}>
        <Text
          style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1, letterSpacing: code ? 1 : 4 }]}
          selectable={!!code}
          accessibilityLabel={code ? t('Code {code}', { code: code.split('').join(' ') }) : t('Code hidden')}
        >
          {code ?? '••••••'}
        </Text>
        {busy && <ActivityIndicator size="small" color={colors.primary} />}
      </View>
      <View style={styles.codeActions}>
        <Pressable
          onPress={code ? hide : fetchCode}
          disabled={busy}
          style={({ pressed }) => [styles.codeBtn, { backgroundColor: pressed ? colors.border : colors.primarySurface }]}
          accessibilityRole="button"
          accessibilityLabel={code ? t('Hide code') : t('Reveal code')}
        >
          <Icon name={code ? 'eye-off' : 'eye'} size={16} color={colors.primaryDark} />
          <Text style={[typeScale.labelLarge, { color: colors.primaryDark, marginLeft: spacing.xs }]}>{code ? t('Hide') : t('Reveal')}</Text>
        </Pressable>
        <Pressable
          onPress={handleCopy}
          disabled={busy}
          style={({ pressed }) => [styles.codeBtn, { backgroundColor: pressed ? colors.primaryDark : colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={t('Copy code')}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} color={colors.textOnPrimary} />
          <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, marginLeft: spacing.xs }]}>{copied ? t('Copied') : t('Copy')}</Text>
        </Pressable>
      </View>
      {error && <Text style={[typeScale.caption, { color: colors.error, marginTop: spacing.xs }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    minHeight: 56,
  },
  rowOuter: { flexDirection: 'row', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 1 },
  lockTag: { flexDirection: 'row', alignItems: 'center' },
  accessPill: {
    marginRight: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  codeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  codeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: radius.full,
  },
});
