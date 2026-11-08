import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useCustomers } from '@/hooks/useCustomers';
import { StatusBadge, Avatar, ProgressBar, EmptyState, Switch } from '@/components/ui';
import { db, rpc, refresh, rowsOf, updateRow } from '@/data/store';
import { accessErrorText, portalAccessView, turnOffText } from '@/lib/customerAccess';
import { CustomerPropertiesCard } from '@/components/properties/CustomerPropertiesCard';
import { CustomerInviteCard } from '@/components/invites/CustomerInviteCard';
import { deleteUnusedMember } from '@/data/deleteMember';
import { haptics } from '@/lib/haptics';
import { semantic, tones } from '@/theme/colors';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { isFeatureOn, words, w } from '@/config/brand';

/** Customers get their own login only while the settings file has the customer portal on (features.customerPortal). */
const PORTAL_ON = isFeatureOn('customerPortal');

const projectStatusBadge = (status: string): { label: string; status: 'success' | 'info' | 'warning' | 'neutral' } => {
  if (status === 'active') return { label: 'Active', status: 'success' };
  if (status === 'completed') return { label: 'Completed', status: 'info' };
  if (status === 'on_hold') return { label: 'On Hold', status: 'warning' };
  if (status === 'prospect') return { label: 'Prospect', status: 'neutral' };
  return { label: status.replace('_', ' '), status: 'neutral' };
};

export default function CustomerDetailScreen() {
  const { id, justAdded } = useLocalSearchParams<{ id: string; justAdded?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getCustomer } = useCustomers();

  const customer = getCustomer(id);
  // Every hook runs before the early return below, so React always sees the same hooks in the same order.
  const [savingAccess, setSavingAccess] = useState(false);

  if (!customer) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="arrow-left" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
        <View style={styles.center}>
          <EmptyState icon="alert-circle" title="Customer not found" description="This customer may have been removed." />
        </View>
      </View>
    );
  }

  const c = customer;
  const p = c.person;
  const customerProjects = c.projects;

  const statusInfo = c.member.status === 'active'
    ? { label: 'Active', status: 'success' as const }
    : c.member.status === 'invited'
    ? { label: 'Invited', status: 'info' as const }
    : { label: 'Inactive', status: 'neutral' as const };

  const portal = portalAccessView(c.member.status);

  /** Deletes a customer with no login and no records. Anyone with projects, properties or a login is kept (turn their portal access off instead). */
  function handleDelete() {
    confirmAction(
      `Delete ${p.firstName} ${p.lastName}?`,
      w('This removes them completely and cannot be undone. It only works for a customer who never logged in and has no jobs, job sites, quotes or other records.'),
      'Delete',
      async () => {
        const res = await deleteUnusedMember(p.id);
        if (res.ok) { haptics.destructive(); router.back(); return; }
        showMessage(res.hasHistory ? "Can't delete" : "Couldn't delete", res.hasHistory ? `${res.error}

You can turn their portal access off instead.` : res.error);
      },
      true,
    );
  }

  /** The owner decides: turn this customer's access on or off. Off asks first; it keeps all their records. */
  async function changeAccess(next: boolean) {
    const apply = async () => {
      setSavingAccess(true);
      try {
        if (db.demo) {
          updateRow('company_members', c.member.id, { status: next ? (rowsOf('people').find((x) => x.id === p.id)?.userId ? 'active' : 'invited') : 'inactive' });
        } else {
          const { error } = await rpc('set_customer_portal_access', { p_person_id: p.id, p_enabled: next });
          if (error) throw new Error(error.message);
          await refresh('people', 'company_members');
        }
      } catch (e) {
        const msg = accessErrorText(e);
        showMessage("Couldn't change access", msg);
      } finally {
        setSavingAccess(false);
      }
    };
    if (next) { await apply(); return; }
    const t = turnOffText(p.firstName);
    confirmAction(t.title, t.message, 'Turn Off', () => { void apply(); }, true);
  }

  function handleCall() {
    if (!p.phone) return;
    Linking.openURL(`tel:${p.phone.replace(/[^\d+]/g, '')}`);
  }

  /** Add a project for this customer; the form opens already knowing them. */
  function addForCustomer() {
    router.push(`/(owner)/project-new?customerId=${p.id}` as any);
  }

  function handleEmail() {
    Linking.openURL(`mailto:${p.email}`);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>
          Customer Profile
        </Text>
      </View>

      <ScrollView bounces={false} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Profile header */}
          <View style={[styles.profileCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <View style={styles.profileTopRow}>
              <Avatar firstName={p.firstName} lastName={p.lastName} size={72} uri={p.avatarUrl} />
              <View style={{ marginLeft: spacing.md, flex: 1 }}>
                <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>
                  {p.firstName} {p.lastName}
                </Text>
                <View style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
                  <StatusBadge label={statusInfo.label} status={statusInfo.status} />
                </View>
              </View>
            </View>

            <View style={styles.contactRow}>
              <Pressable
                style={[styles.contactBtn, { backgroundColor: colors.primarySurface }, !p.phone && { opacity: 0.4 }]}
                onPress={handleCall}
                disabled={!p.phone}
              >
                <Icon name="phone" size={16} color={colors.primaryOnWhite} />
                <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700', marginLeft: spacing.xs }]}>Call</Text>
              </Pressable>
              <Pressable
                style={[styles.contactBtn, { backgroundColor: tones.neutral.bg }]}
                onPress={handleEmail}
              >
                <Icon name="mail" size={16} color={tones.strong.fg} />
                <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700', marginLeft: spacing.xs }]}>Email</Text>
              </Pressable>
            </View>
          </View>

          <CustomerPropertiesCard customerId={p.id} firstName={p.firstName} />

          {/* Login: a private one-time link */}
          {PORTAL_ON && (
            <View style={[styles.sectionCard, { backgroundColor: colors.surface }, shadow.sm]}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm }]}>Customer Login</Text>
              <CustomerInviteCard personId={p.id} firstName={p.firstName} phone={p.phone} autoMake={justAdded === '1'} />
            </View>
          )}


          {/* Projects */}
          <View style={[styles.sectionCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700' }]}>
                {words.jobs} ({customerProjects.length})
              </Text>
              <Pressable
                style={[styles.addProjectBtn, { backgroundColor: colors.backgroundTertiary }]}
                onPress={addForCustomer}
                accessibilityRole="button"
                accessibilityLabel={w('Add a job for this customer')}
              >
                <Icon name="plus" size={14} color={colors.textSecondary} />
                <Text style={[typeScale.labelSmall, { color: colors.textSecondary, fontWeight: '600', marginLeft: 4 }]}>Add</Text>
              </Pressable>
            </View>

            {customerProjects.length > 0 ? (
              customerProjects.map((proj, i) => {
                const badge = projectStatusBadge(proj.status);
                return (
                  <Pressable
                    key={proj.id}
                    style={[styles.projectRow, i > 0 && { marginTop: spacing.sm }]}
                    onPress={() => router.push(`/(owner)/projects/${proj.id}` as any)}
                  >
                    <View style={[styles.projectIcon, { backgroundColor: colors.backgroundTertiary }]}>
                      <Icon name="home" size={18} color={colors.textTertiary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <View style={styles.projectTopRow}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flexShrink: 1, marginRight: spacing.sm }]} numberOfLines={1}>
                          {proj.name}
                        </Text>
                        <StatusBadge label={badge.label} status={badge.status} />
                      </View>
                      {proj.address && (
                        <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>{proj.address}</Text>
                      )}
                      <View style={styles.progressRow}>
                        <ProgressBar progress={proj.progress} height={5} style={{ flex: 1 }} />
                        <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.sm }]}>{proj.progress}%</Text>
                      </View>
                    </View>
                    <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                  </Pressable>
                );
              })
            ) : (
              <Text style={[typeScale.bodySmall, { color: colors.textTertiary, marginTop: spacing.xs }]}>
                No {words.jobs.toLowerCase()} yet
              </Text>
            )}
          </View>

          {/* Account */}
          <View style={[styles.sectionCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm }]}>Account</Text>

            <View style={styles.accountRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="calendar" size={14} color={colors.textTertiary} />
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>Customer since</Text>
              </View>
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>
                {new Date(c.member.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </Text>
            </View>

            {PORTAL_ON && <View style={[styles.accountRow, { marginTop: spacing.sm }]}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon name="eye" size={14} color={colors.textTertiary} />
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>Portal access</Text>
                  <View style={{ marginLeft: spacing.sm }}><StatusBadge label={portal.label} status={portal.tone} /></View>
                </View>
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>{portal.note}</Text>
              </View>
              <Switch value={portal.on} disabled={savingAccess} onValueChange={changeAccess} accessibilityLabel={`Portal access for ${p.firstName}`} />
            </View>}
          </View>

          <Pressable
            onPress={handleDelete}
            style={[styles.deleteRow, { backgroundColor: colors.backgroundTertiary }]}
            accessibilityRole="button"
            accessibilityLabel="Delete customer"
          >
            <Icon name="trash-2" size={16} color={semantic.error} />
            <Text style={[typeScale.labelLarge, { color: semantic.error, fontWeight: '700', marginLeft: spacing.xs }]}>Delete Customer</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  backButton: { padding: spacing.xs },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: radius.lg, marginTop: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { paddingBottom: spacing['5xl'] },
  content: { paddingHorizontal: spacing.lg },
  profileCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  contactRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  sectionCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  addProjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
