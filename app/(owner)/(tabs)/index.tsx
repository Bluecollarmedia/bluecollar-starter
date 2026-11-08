import { useOpenIssueCount } from '@/data/issues';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { updateRow } from '@/data/store';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Icon } from '@/components/ui/Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useOwnerDashboard, type AttentionItem, type CrewMember, type ProjectHomeSummary } from '@/hooks/useOwnerDashboard';
import { Avatar, ProgressBar } from '@/components/ui';
import { UnreadBadge } from '@/components/ui/UnreadBadge';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic, fixed, whiteAlpha, blackAlpha } from '@/theme/colors';
import { getProjectImageUri, getCompanyImageUri } from '@/lib/projectImages';
import { BrandCover } from '@/components/branding/BrandCover';
import { DASHBOARD_HERO_HEIGHT } from '@/components/media/HeaderPhotoField';
import { useCompanySetup } from '@/hooks/useCompanySetup';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { remindWorker } from '@/data/remindWorker';
import { AdminJobCard } from '@/components/admin/AdminJobCard';
import { NeedsOkCard } from '@/components/time/NeedsOkCard';
import { showMessage } from '@/components/financials/ActionSheet';
import { WeatherButton } from '@/components/weather/WeatherButton';
import { isFeatureOn, words, w } from '@/config/brand';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';

const HAS_LIQUID_GLASS = isLiquidGlassAvailable();

/** The setup walkthrough opens by itself once per app launch until it's been gone through. */
let setupOpenedThisLaunch = false;


function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

const SEVERITY_COLORS: Record<AttentionItem['severity'], { bg: string; icon: string }> = {
  critical: { bg: semantic.errorLight, icon: semantic.error },
  warning: { bg: semantic.warningLight, icon: semantic.warning },
  info: { bg: semantic.infoLight, icon: semantic.info },
};

// Each quick action shows only while its feature is on in the settings file (src/config/brand.js).
const QUICK_ACTIONS = [
  { label: `New ${words.job}`, icon: 'plus-circle' as const, route: '/(owner)/project-new', on: true },
  { label: 'Schedule Worker', icon: 'calendar' as const, route: '/(owner)/schedule-create', on: true },
  { label: 'Add Worker', icon: 'user-plus' as const, route: '/(owner)/worker-new', on: true },
  { label: 'Announcement', icon: 'volume-2' as const, route: '/(owner)/more/announcements', on: isFeatureOn('announcements') },
].filter((a) => a.on);

export default function OwnerDashboard() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [reminding, setReminding] = useState<string | null>(null);
  const [reminded, setReminded] = useState<Record<string, boolean>>({});

  // The Dashboard always opens at the top: every time its tab comes into view, and when its tab is tapped again.
  const scrollRef = useRef<ScrollView>(null);
  const navigation = useNavigation();
  const toTop = useCallback(() => scrollRef.current?.scrollTo({ y: 0, animated: false }), []);
  useFocusEffect(toTop);
  useEffect(() => {
    const subs = [navigation, navigation.getParent?.()]
      .filter(Boolean)
      .map((n: any) => n.addListener('tabPress', () => scrollRef.current?.scrollTo({ y: 0, animated: true })));
    return () => subs.forEach((unsub: () => void) => unsub());
  }, [navigation]);
  const openIssueCount = useOpenIssueCount();
  const {
    todayStats, attentionItems, attentionTotalCount,
    crewToday, crewTodayTotal, activeProjects, activeProjectsTotal,
  } = useOwnerDashboard();
  const setup = useCompanySetup();

  useEffect(() => {
    if (setup.needsWalkthrough && !setupOpenedThisLaunch) {
      setupOpenedThisLaunch = true;
      router.push('/(owner)/setup' as any);
    }
  }, [setup.needsWalkthrough, router]);

  function renderHeroStat(icon: React.ReactNode, value: number, label: string) {
    return (
      <View style={styles.heroStat}>
        <View style={styles.heroStatIconRow}>
          {icon}
          <Text style={[typeScale.headingLarge, { color: fixed.white, marginLeft: spacing.xs }]}>{value}</Text>
        </View>
        <Text style={[typeScale.caption, { color: whiteAlpha(0.85) }]}>{label}</Text>
      </View>
    );
  }

  /** Remind: sends the worker a push and stays here; the owner is told plainly what happened. */
  async function sendRemind(item: AttentionItem) {
    // An owner or admin who is on the job themselves confirms it here (they cannot remind themselves).
    if (item.confirmOwn) {
      updateRow('assignments', item.confirmOwn.assignmentId, { confirmationState: 'confirmed' });
      return;
    }
    if (!item.remind || reminding) return;
    setReminding(item.id);
    const res = await remindWorker(item.remind.assignmentId, item.remind.firstName);
    setReminding(null);
    if (res.sent) setReminded((r) => ({ ...r, [item.id]: true }));
    showMessage(res.sent ? 'Reminder' : res.tone === 'ok' ? 'Reminder' : "Couldn't remind", res.text);
  }

  function renderAttentionRow(item: AttentionItem) {
    const c = SEVERITY_COLORS[item.severity];
    return (
      <Pressable
        key={item.id}
        style={[styles.attentionRow, { backgroundColor: c.bg }]}
        onPress={() => router.push(item.route as any)}
      >
        <View style={[styles.attentionIcon, { backgroundColor: c.icon }]}>
          <Icon name={item.icon} size={16} color={fixed.white} />
        </View>
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.subtitle}
          </Text>
        </View>
        <Pressable
          style={[styles.attentionAction, { backgroundColor: colors.surface, opacity: reminding === item.id ? 0.6 : 1 }]}
          onPress={() => (item.remind || item.confirmOwn ? sendRemind(item) : router.push(item.route as any))}
          disabled={reminding === item.id}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={item.confirmOwn ? w('Confirm my job') : item.remind ? `Remind ${item.remind.firstName || 'the worker'} to confirm` : item.actionLabel}
        >
          <Text style={[typeScale.labelSmall, { color: c.icon }]}>{reminding === item.id ? 'Sending…' : reminded[item.id] ? 'Sent' : item.actionLabel}</Text>
        </Pressable>
      </Pressable>
    );
  }

  function renderCrewCard(member: CrewMember) {
    const dotColor = member.status === 'on_site' ? semantic.success
      : member.status === 'late' ? semantic.warning
      : member.status === 'awaiting_confirmation' ? semantic.warning
      : member.status === 'completed' ? colors.textTertiary
      : colors.textTertiary;

    return (
      <Pressable
        key={member.personId}
        style={styles.crewCard}
        onPress={() => router.push(`/(owner)/workers/${member.personId}` as any)}
      >
        <View style={styles.crewAvatarWrap}>
          <Avatar
            firstName={member.person?.firstName ?? '?'}
            lastName={member.person?.lastName ?? '?'}
            size={64}
            uri={member.person?.avatarUrl}
          />
        </View>
        <View style={styles.crewNameRow}>
          <View style={[styles.crewDot, { backgroundColor: dotColor }]} />
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>
            {member.person?.firstName} {member.person?.lastName}
          </Text>
        </View>
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
          {member.statusLabel}
        </Text>
        {member.timeLabel && (
          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
            {member.status === 'on_site' ? 'Since ' : member.status === 'awaiting_confirmation' ? 'Starts ' : ''}
            {member.timeLabel}
          </Text>
        )}
        {member.projectName && (
          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
            {member.projectName}
          </Text>
        )}
      </Pressable>
    );
  }

  function renderProjectCard(project: ProjectHomeSummary, index: number) {
    const statusIsOnSite = project.todayStatusLabel === 'Crew on site';
    return (
      <Pressable
        key={project.id}
        style={[styles.projectCard, { backgroundColor: colors.surface }, shadow.sm]}
        onPress={() => router.push(`/(owner)/projects/${project.id}` as any)}
      >
        <BrandCover uri={getProjectImageUri(project)} style={styles.projectImage} variant="tile" />
        <View style={styles.projectInfo}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
            {project.name}
          </Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 1 }]} numberOfLines={1}>
            {project.customer?.firstName} {project.customer?.lastName}
          </Text>
          <View style={styles.projectProgressRow}>
            <ProgressBar progress={project.progress} style={{ flex: 1 }} />
            <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
              {project.progress}%
            </Text>
          </View>
          <View style={styles.projectStatusRow}>
            {project.todayStatusLabel ? (
              statusIsOnSite ? (
                <View style={[styles.projectStatusDot, { backgroundColor: semantic.success }]} />
              ) : (
                <Icon name="clock" size={11} color={colors.textTertiary} />
              )
            ) : null}
            <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: project.todayStatusLabel ? spacing.xs : 0 }]} numberOfLines={1}>
              {project.todayStatusLabel ?? w('No crew scheduled')}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView bounces={false} ref={scrollRef} contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, flexShrink: 1 }}>
            <WeatherButton to="/(owner)/weather" />
            <View style={{ flexShrink: 1 }}>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                {getGreeting()},
              </Text>
              <Text style={[typeScale.displaySmall, { color: colors.textPrimary }]} numberOfLines={1}>
                {user?.firstName ?? 'Owner'}
              </Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                {getTodayLabel()}
              </Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/(owner)/notification-center' as any)}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              hitSlop={6}
            >
              {({ pressed }) => (
                <View>
                {HAS_LIQUID_GLASS ? (
                  <GlassView glassEffectStyle="regular" isInteractive style={[styles.glassIconButton, pressed && styles.iconButtonPressed]}>
                    <Icon name="bell" size={19} color={colors.textPrimary} />
                  </GlassView>
                ) : (
                  <View style={[styles.smallIconButton, { backgroundColor: colors.backgroundTertiary }, pressed && styles.iconButtonPressed]}>
                    <Icon name="bell" size={19} color={colors.textPrimary} />
                  </View>
                )}
                <UnreadBadge />
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => router.push('/(owner)/search' as any)}
              accessibilityRole="button"
              accessibilityLabel="Search"
              hitSlop={6}
            >
              {({ pressed }) => (
                HAS_LIQUID_GLASS ? (
                  <GlassView glassEffectStyle="regular" isInteractive style={[styles.glassIconButton, pressed && styles.iconButtonPressed]}>
                    <Icon name="search" size={19} color={colors.textPrimary} />
                  </GlassView>
                ) : (
                  <View style={[styles.smallIconButton, { backgroundColor: colors.backgroundTertiary }, pressed && styles.iconButtonPressed]}>
                    <Icon name="search" size={19} color={colors.textPrimary} />
                  </View>
                )
              )}
            </Pressable>
            <Pressable
              onPress={() => setQuickActionsOpen(true)}
              style={[styles.iconButton, { backgroundColor: colors.primarySurface }]}
              accessibilityRole="button"
              accessibilityLabel="Quick actions"
            >
              <Icon name="plus" size={20} color={colors.primaryOnWhite} />
            </Pressable>
            {/* Display only: the profile opens from your name in More > Settings, the one way in. */}
            <Avatar firstName={user?.firstName ?? ''} lastName={user?.lastName ?? ''} size={44} uri={user?.avatarUrl} />
          </View>
        </View>

        <View style={styles.content}>
          {/* Today hero */}
          <View style={[styles.heroCard, shadow.md]}>
            <BrandCover uri={getCompanyImageUri()} style={StyleSheet.absoluteFill} />
            <LinearGradient
              colors={[blackAlpha(0.25), blackAlpha(0.85)]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroContent}>
              <Text style={[typeScale.overline, { color: whiteAlpha(0.8) }]}>TODAY</Text>
              <Text style={[typeScale.headingLarge, { color: fixed.white, marginTop: 2, marginBottom: spacing.md }]}>
                {todayStats.jobsInProgress} job{todayStats.jobsInProgress === 1 ? '' : 's'} in progress
              </Text>
              <View style={styles.heroStatsRow}>
                {renderHeroStat(<Icon name="users" size={14} color={fixed.white} />, todayStats.workersScheduled, 'Workers scheduled')}
                {renderHeroStat(<View style={styles.onSiteDot} />, todayStats.onSite, 'On site')}
                {renderHeroStat(<Icon name="clock" size={14} color={fixed.white} />, todayStats.upcoming, 'Upcoming')}
              </View>
              <Pressable
                style={styles.heroButton}
                onPress={() => router.push('/(owner)/schedule' as any)}
              >
                <Text style={[typeScale.labelLarge, { color: colors.primaryDark }]}>View Today's Schedule</Text>
                <Icon name="chevron-right" size={16} color={colors.primaryDark} />
              </Pressable>
            </View>
          </View>

          {/* Recommended setup checklist, until every step is done */}
          {setup.showChecklist && (
            <View style={[styles.setupCard, { backgroundColor: colors.surface, borderColor: colors.primaryLight }, shadow.sm]}>
              <View style={styles.sectionTitleRow}>
                <Icon name="check-square" size={18} color={colors.primaryOnWhite} />
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>Finish your setup</Text>
                <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite }]}>{setup.doneCount} of {setup.total}</Text>
              </View>
              <ProgressBar progress={Math.round((setup.doneCount / setup.total) * 100)} height={6} style={{ marginVertical: spacing.sm }} />
              {setup.steps.map((s) => (
                <Pressable
                  key={s.key}
                  style={styles.setupRow}
                  onPress={() => router.push({ pathname: '/(owner)/setup', params: { step: s.key } } as any)}
                  disabled={s.done}
                >
                  <Icon name={s.done ? 'check-circle' : 'circle'} size={18} color={s.done ? semantic.success : colors.textTertiary} />
                  <Text style={[typeScale.bodySmall, { flex: 1, color: s.done ? colors.textTertiary : colors.textPrimary, textDecorationLine: s.done ? 'line-through' : 'none' }]}>
                    {s.title}
                  </Text>
                  {!s.done && <Icon name="chevron-right" size={16} color={colors.textTertiary} />}
                </Pressable>
              ))}
            </View>
          )}

          {/* Problems the crew reported */}
          {isFeatureOn('issues') && openIssueCount > 0 && (
            <Pressable
              onPress={() => router.push('/(owner)/issues' as any)}
              accessibilityRole="button"
              accessibilityLabel={`${openIssueCount} open issues`}
              style={[styles.setupCard, { backgroundColor: colors.surface, borderColor: semantic.warning, flexDirection: 'row', alignItems: 'center', gap: spacing.md }]}
            >
              <Icon name="alert-triangle" size={20} color={semantic.warning} />
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
                  {openIssueCount} open {openIssueCount === 1 ? 'issue' : 'issues'}
                </Text>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{w('Problems your crew reported')}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          )}

          {/* An admin who is on a job works it like a worker (confirm it, clock in and out). Nothing for the owner. */}
          <AdminJobCard />

          {/* Workdays that closed on their own and wait for the owner's end time */}
          {isFeatureOn('timeClock') ? <NeedsOkCard /> : null}

          {/* Needs Attention */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>Needs Attention</Text>
                {attentionTotalCount > 0 && (
                  <View style={[styles.countBadge, { backgroundColor: semantic.errorLight }]}>
                    <Text style={[typeScale.labelSmall, { color: semantic.error, fontWeight: '700' }]}>
                      {attentionTotalCount}
                    </Text>
                  </View>
                )}
              </View>
              {attentionTotalCount > 0 && (
                <Pressable onPress={() => router.push('/(owner)/notification-center' as any)}>
                  <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite }]}>See All</Text>
                </Pressable>
              )}
            </View>
            {attentionItems.length === 0 ? (
              <View style={[styles.emptyAttention, { backgroundColor: colors.backgroundSecondary }]}>
                <Icon name="check-circle" size={16} color={semantic.success} />
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
                  Everything looks good — no issues need your attention right now.
                </Text>
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {attentionItems.map(renderAttentionRow)}
              </View>
            )}
          </View>

          {/* Crew Today */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
                {w('Crew Today ')}<Text style={{ color: colors.textSecondary, fontWeight: '400' }}>· {crewTodayTotal} scheduled</Text>
              </Text>
              <Pressable onPress={() => router.push('/(owner)/workers' as any)}>
                <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite }]}>View Team</Text>
              </Pressable>
            </View>
            {crewToday.length === 0 ? (
              <View style={[styles.emptyAttention, { backgroundColor: colors.backgroundSecondary }]}>
                <Icon name="users" size={16} color={colors.textTertiary} />
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
                  No one is scheduled today.
                </Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crewRow}>
                {crewToday.map(renderCrewCard)}
                {crewTodayTotal > crewToday.length && (
                  <Pressable style={styles.crewMore} onPress={() => router.push('/(owner)/workers' as any)}>
                    <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite }]}>
                      +{crewTodayTotal - crewToday.length} more
                    </Text>
                  </Pressable>
                )}
              </ScrollView>
            )}
          </View>

          {/* Active Projects */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
                {w('Active Jobs')} <Text style={{ color: colors.textSecondary, fontWeight: '400' }}>· {activeProjectsTotal} total</Text>
              </Text>
              <Pressable onPress={() => router.push('/(owner)/projects' as any)}>
                <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite }]}>View All</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.projectsRow}>
              {activeProjects.map(renderProjectCard)}
            </ScrollView>
          </View>
        </View>
      </ScrollView>

      {/* Quick Actions sheet */}
      <BottomSheetModal visible={quickActionsOpen} onRequestClose={() => setQuickActionsOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setQuickActionsOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surfaceElevated, paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.borderLight }]} />
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md }]}>
              Quick Actions
            </Text>
            {QUICK_ACTIONS.map((action, i) => (
              <React.Fragment key={action.label}>
                <Pressable
                  style={styles.sheetOption}
                  onPress={() => { setQuickActionsOpen(false); router.push(action.route as any); }}
                >
                  <View style={[styles.sheetOptionIcon, { backgroundColor: colors.primarySurface }]}>
                    <Icon name={action.icon} size={18} color={colors.primaryOnWhite} />
                  </View>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.md }]}>
                    {action.label}
                  </Text>
                </Pressable>
                {i < QUICK_ACTIONS.length - 1 && <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />}
              </React.Fragment>
            ))}
            <Pressable
              style={[styles.cancelButton, { backgroundColor: colors.backgroundSecondary }]}
              onPress={() => setQuickActionsOpen(false)}
            >
              <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  setupCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  setupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  screen: { flex: 1 },
  scrollContent: { paddingBottom: spacing['5xl'] },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconButtonPressed: {
    opacity: 0.6,
  },
  content: { paddingHorizontal: spacing.lg },

  heroCard: {
    height: DASHBOARD_HERO_HEIGHT,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  heroContent: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  heroStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  heroStat: { alignItems: 'flex-start' },
  heroStatIconRow: { flexDirection: 'row', alignItems: 'center' },
  onSiteDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: semantic.success,
  },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: fixed.white,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },

  section: { marginBottom: spacing.xl },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },

  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
  },
  attentionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionAction: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    marginLeft: spacing.sm,
  },
  emptyAttention: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
  },

  crewRow: { gap: spacing.xl, paddingRight: spacing.lg },
  crewCard: { width: 148, alignItems: 'flex-start' },
  crewAvatarWrap: { marginBottom: spacing.sm },
  crewNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'stretch',
  },
  crewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  crewMore: {
    width: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },

  projectsRow: { gap: spacing.md, paddingRight: spacing.lg },
  projectCard: {
    width: 272,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  projectImage: { width: '100%', height: 130 },
  projectInfo: { padding: spacing.md },
  projectProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  projectStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  projectStatusDot: { width: 6, height: 6, borderRadius: 3 },

  sheetBackdrop: { flex: 1, backgroundColor: blackAlpha(0.4), justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  sheetOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth },
  cancelButton: {
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
});
