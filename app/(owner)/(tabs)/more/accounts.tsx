import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { Avatar, Button, FilterChips, SearchBar, StatusBadge } from '@/components/ui';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { useAccounts, type Account, type AccountStatus } from '@/hooks/useAccounts';
import { CollapsibleFilters } from '@/components/ui/CollapsibleFilters';
import { haptics } from '@/lib/haptics';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { roleLabel, w } from '@/config/brand';

type RoleFilter = 'all' | 'owner' | 'worker' | 'customer' | 'none';
type StatusFilter = 'all' | AccountStatus;
type SortKey = 'newest' | 'oldest' | 'name' | 'last_active';
type Action = 'remove' | 'restore' | 'delete';

const CONFIRM_WORD = 'DELETE';

// The name SHOWN for each role (the database keeps 'admin'; people see the settings file's leaderRoleLabel, e.g. "Manager").
const ROLE_LABEL: Record<string, string> = { owner: roleLabel('owner'), admin: roleLabel('admin'), worker: roleLabel('worker'), customer: roleLabel('customer') };

const STATUS_BADGE: Record<AccountStatus, { label: string; status: 'success' | 'warning' | 'error' | 'neutral' }> = {
  active: { label: 'Active', status: 'success' },
  removed: { label: 'Removed', status: 'error' },
  not_joined: { label: 'Not joined', status: 'neutral' },
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fullName(a: Account): string {
  return `${a.firstName} ${a.lastName}`.trim() || a.email || 'No name';
}

/** Owner and admin both count as "owner" for filtering; admins use the owner screens. */
function roleGroup(a: Account): RoleFilter {
  if (!a.role) return 'none';
  return a.role === 'admin' ? 'owner' : a.role;
}

export default function AccountsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { accounts, loading, error, reload, removeAccess, restoreAccess, deleteAccount } = useAccounts();

  const [query, setQuery] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [pending, setPending] = useState<{ action: Action; account: Account } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = accounts.filter((a) => {
      if (role !== 'all' && roleGroup(a) !== role) return false;
      if (status !== 'all' && a.status !== status) return false;
      if (q && !`${fullName(a)} ${a.email} ${a.phone ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
    return list.sort((a, b) => {
      switch (sort) {
        case 'oldest': return time(a.signedUpAt) - time(b.signedUpAt);
        case 'name': return fullName(a).localeCompare(fullName(b));
        case 'last_active': return time(b.lastSignInAt) - time(a.lastSignInAt);
        default: return time(b.signedUpAt) - time(a.signedUpAt);
      }
    });
  }, [accounts, query, role, status, sort]);

  const roleCount = (r: RoleFilter) => accounts.filter((a) => roleGroup(a) === r).length;
  const statusCount = (s: AccountStatus) => accounts.filter((a) => a.status === s).length;

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  function openAction(action: Action, account: Account) {
    haptics.destructive();
    setTyped('');
    setActionError('');
    setPending({ action, account });
  }

  function closeSheet() {
    if (busy) return;
    setPending(null);
  }

  async function confirmAction() {
    if (!pending) return;
    if (pending.action === 'delete' && typed.trim().toUpperCase() !== CONFIRM_WORD) return;
    setBusy(true);
    setActionError('');
    const id = pending.account.personId;
    const err = pending.action === 'remove' ? await removeAccess(id)
      : pending.action === 'restore' ? await restoreAccess(id)
      : await deleteAccount(id);
    setBusy(false);
    if (err) {
      setActionError(err);
      return;
    }
    haptics.success();
    setPending(null);
    setExpandedId(null);
  }

  function renderAccount(a: Account) {
    const isExpanded = expandedId === a.personId;
    const badge = STATUS_BADGE[a.status];
    // Owners (and you) can't be changed from here.
    const locked = a.isMe || a.role === 'owner';
    const canRemove = !locked && a.status === 'active';
    const canRestore = !locked && a.status === 'removed';

    return (
      <Pressable
        key={a.personId}
        style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}
        onPress={() => setExpandedId(isExpanded ? null : a.personId)}
        accessibilityRole="button"
        accessibilityLabel={`${fullName(a)}, ${badge.label}`}
      >
        <View style={styles.cardHeader}>
          <Avatar firstName={a.firstName || '?'} lastName={a.lastName} size={44} uri={a.avatarUrl} />
          <View style={styles.cardInfo}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
              {fullName(a)}{a.isMe ? ' (you)' : ''}
            </Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{a.email}</Text>
            <View style={styles.badges}>
              {a.role && <StatusBadge label={ROLE_LABEL[a.role] ?? a.role} status="info" />}
              <StatusBadge label={badge.label} status={badge.status} />
            </View>
          </View>
          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
        </View>

        {isExpanded && (
          <>
            <View style={[styles.metaRow, { borderTopColor: colors.borderLight }]}>
              <View style={styles.metaItem}>
                <Text style={[typeScale.overline, { color: colors.textTertiary }]}>SIGNED UP</Text>
                <Text style={[typeScale.caption, { color: colors.textPrimary }]}>{formatDate(a.signedUpAt)}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={[typeScale.overline, { color: colors.textTertiary }]}>LAST SIGN-IN</Text>
                <Text style={[typeScale.caption, { color: colors.textPrimary }]}>{formatDate(a.lastSignInAt)}</Text>
              </View>
              {a.phone ? (
                <View style={styles.metaItem}>
                  <Text style={[typeScale.overline, { color: colors.textTertiary }]}>PHONE</Text>
                  <Text style={[typeScale.caption, { color: colors.textPrimary }]}>{a.phone}</Text>
                </View>
              ) : null}
            </View>

            {a.status === 'removed' && (
              <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                Access removed {formatDate(a.removedAt)}. They can't use the app until you reactivate them (Team Access) or send them a new invite link.
              </Text>
            )}

            {locked ? (
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.md }]}>
                {a.isMe ? 'This is you. Use Settings to manage your own account.' : 'Owner accounts can’t be changed here.'}
              </Text>
            ) : (
              <View style={styles.actions}>
                {canRemove && (
                  <Button title="Remove access" variant="secondary" size="sm" onPress={() => openAction('remove', a)} style={{ flex: 1 }} />
                )}
                {canRestore && (
                  <Button title="Reactivate…" variant="secondary" size="sm" onPress={() => router.push('/(owner)/more/team-access' as never)} style={{ flex: 1 }} />
                )}
                <Button title="Delete account" variant="danger" size="sm" onPress={() => openAction('delete', a)} style={{ flex: 1 }} />
              </View>
            )}
          </>
        )}
      </Pressable>
    );
  }

  const target = pending?.account;
  const deleteReady = typed.trim().toUpperCase() === CONFIRM_WORD;
  const sheetCopy = pending && target ? {
    remove: {
      icon: 'user-x', title: `Remove ${fullName(target)}?`,
      body: 'They keep their login but can’t use the app. To get back in they’ll need you to restore them here or send them a new invite link.',
      button: 'Remove Access',
    },
    restore: {
      icon: 'user-check', title: `Restore ${fullName(target)}?`,
      body: `They’ll be back in the app as ${ROLE_LABEL[target.role ?? ''] ?? 'a team member'} right away.`,
      button: 'Restore Access',
    },
    delete: {
      icon: 'alert-triangle', title: `Delete ${fullName(target)}’s account?`,
      body: w('Their login and contact details are erased for good. Their name stays on past records like hours and job history. To come back they’d have to sign up again and be approved. This can’t be undone.'),
      button: 'Delete Account',
    },
  }[pending.action] : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>
          Accounts
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search name, email or phone" />

        <CollapsibleFilters
          groups={[
            {
              key: 'role', label: 'Role', selected: role, onSelect: (k) => setRole(k as RoleFilter), defaultKey: 'all',
              options: [
                { key: 'all', label: 'All', count: accounts.length },
                { key: 'owner', label: 'Owners', count: roleCount('owner') },
                { key: 'worker', label: 'Workers', count: roleCount('worker') },
                { key: 'customer', label: 'Customers', count: roleCount('customer') },
                { key: 'none', label: 'No role', count: roleCount('none') },
              ],
            },
            {
              key: 'status', label: 'Status', selected: status, onSelect: (k) => setStatus(k as StatusFilter), defaultKey: 'all',
              options: [
                { key: 'all', label: 'All' },
                { key: 'active', label: 'Active', count: statusCount('active') },
                { key: 'removed', label: 'Removed', count: statusCount('removed') },
                { key: 'not_joined', label: 'Not joined', count: statusCount('not_joined') },
              ],
            },
            {
              key: 'sort', label: 'Sort', selected: sort, onSelect: (k) => setSort(k as SortKey), defaultKey: 'newest',
              options: [
                { key: 'newest', label: 'Newest' },
                { key: 'oldest', label: 'Oldest' },
                { key: 'name', label: 'Name A–Z' },
                { key: 'last_active', label: 'Last sign-in' },
              ],
            },
          ]}
        />

        <View style={{ height: spacing.lg }} />

        {error ? (
          <Text style={[typeScale.bodySmall, { color: semantic.error, marginBottom: spacing.md }]}>{error}</Text>
        ) : null}

        {!loading && visible.length === 0 && (
          <View style={styles.empty}>
            <Icon name="users" size={48} color={colors.textTertiary} />
            <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.md }]}>
              {accounts.length === 0 ? 'No accounts yet' : 'No accounts match'}
            </Text>
          </View>
        )}

        {visible.map(renderAccount)}
      </ScrollView>

      <BottomSheetModal visible={!!pending} onRequestClose={closeSheet}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.overlay} onPress={closeSheet}>
            <Pressable
              style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + spacing.lg }]}
              onPress={(e) => e.stopPropagation()}
            >
              {sheetCopy && pending && (
                <>
                  <View style={[styles.iconWrap, { backgroundColor: pending.action === 'restore' ? semantic.successLight : semantic.errorLight }]}>
                    <Icon name={sheetCopy.icon as any} size={24} color={pending.action === 'restore' ? semantic.success : semantic.error} />
                  </View>
                  <Text style={[typeScale.headingLarge, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing.md }]}>
                    {sheetCopy.title}
                  </Text>
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm }]}>
                    {sheetCopy.body}
                  </Text>
                  {pending.action === 'delete' && (
                    <>
                      <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.xs }]}>
                        Type {CONFIRM_WORD} to confirm
                      </Text>
                      <TextInput
                        value={typed}
                        onChangeText={setTyped}
                        placeholder={CONFIRM_WORD}
                        placeholderTextColor={colors.textTertiary}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        style={[typeScale.bodyLarge, styles.input, { color: colors.textPrimary, borderColor: deleteReady ? semantic.error : colors.border }]}
                      />
                    </>
                  )}
                  {actionError ? (
                    <Text style={[typeScale.caption, { color: semantic.error, marginTop: spacing.sm }]}>{actionError}</Text>
                  ) : null}
                  <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
                    <Button
                      title={sheetCopy.button}
                      onPress={confirmAction}
                      variant={pending.action === 'restore' ? 'primary' : 'danger'}
                      fullWidth
                      disabled={pending.action === 'delete' && !deleteReady}
                      loading={busy}
                    />
                    <Button title="Cancel" onPress={closeSheet} variant="ghost" fullWidth />
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </BottomSheetModal>
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
    gap: spacing.md,
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] },
  filterLabel: { marginTop: spacing.md, marginBottom: spacing.xs },
  empty: { alignItems: 'center', paddingVertical: spacing['4xl'] },
  card: { borderRadius: radius.sm, padding: spacing.lg, marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardInfo: { flex: 1 },
  badges: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1 },
  metaItem: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  input: { borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, letterSpacing: 2 },
});
