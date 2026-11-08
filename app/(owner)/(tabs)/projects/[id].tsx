import { useBackStep } from '@/hooks/useBackStep';
import { CustomerInviteCard } from '@/components/invites/CustomerInviteCard';
import { IssuesSection } from '@/components/issues/IssuesSection';
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Modal, TextInput, Platform, Linking, Keyboard } from 'react-native';
import { Switch } from '@/components/ui/Switch';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '@/components/ui/Icon';
import { PhotoViewer } from '@/components/worker/PhotoViewer';
import { useTheme } from '@/providers/ThemeProvider';
import { SectionTabs, StatusBadge, ProgressBar, Card, EmptyState, Divider, Avatar, Button, OptimizedImage } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { useAuth } from '@/providers/AuthProvider';
import { attachImage } from '@/data/actions';
import { ClearLogSheet } from '@/components/logs/ClearLogSheet';
import { previewProjectClear, runProjectClear } from '@/data/activityClear';
import { refresh as refreshStore } from '@/data/store';
import { openDirections, formatDistance, DEFAULT_CHECKIN_RADIUS_M } from '@/lib/maps';
import { isFeatureOn, w } from '@/config/brand';
import { CheckInRadiusSheet } from '@/components/projects/CheckInRadiusSheet';
import { ProjectPrivateNotes } from '@/components/projects/ProjectPrivateNotes';
import { useIsProjectOwner, useOwnerNotes } from '@/data/ownerProjectNotes';
import { MessageThread } from '@/components/messages/MessageThread';
import { db, rowsOf, updateRow } from '@/data/store';
import { estimateProgress } from '@/lib/projectProgress';
import { useSchedule } from '@/hooks/useSchedule';
import { useWorkers } from '@/hooks/useWorkers';
import { useCustomerAccess } from '@/hooks/useCustomerAccess';
import { getProjectImageUri } from '@/lib/projectImages';
import { BrandCover } from '@/components/branding/BrandCover';
import { haptics } from '@/lib/haptics';
import { todayKey, localDateKey, isoToLocalDateKey } from '@/lib/ids';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic, fixed, whiteAlpha, blackAlpha, withAlpha, onColor, tones, neutral } from '@/theme/colors';
import type { ProjectStatus, TaskStatus, HistoryEventType, ProjectPhoto, ProjectTask, PhotoType } from '@/types/project';
import type { Assignment } from '@/types/schedule';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { ProjectFinancials } from '@/components/financials/ProjectFinancials';
import { ProspectBanner } from '@/components/financials/ProspectBanner';
import { ProjectMaterials } from '@/components/materials/ProjectMaterials';
import { TaskMediaStrip, TaskMediaViewer, type TaskMediaItem } from '@/components/tasks/TaskMedia';
import { pickTaskMedia, saveTaskMedia, removeTaskMedia, type TaskMediaDraft } from '@/data/taskMedia';
import { keepPicked } from '@/lib/keepPickedFile';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { showMessage, confirmAction as sharedConfirm } from '@/components/financials/ActionSheet';

const today = todayKey();

function offsetDateStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function formatTimeLabel(time?: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function getDateChipLabel(dateStr: string): { top: string; bottom: string } {
  const diff = Math.round(
    (new Date(dateStr + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000,
  );
  const d = new Date(dateStr + 'T12:00:00');
  if (diff === 0) return { top: 'Today', bottom: d.toLocaleDateString('en-US', { weekday: 'short' }) };
  if (diff === 1) return { top: 'Tomorrow', bottom: d.toLocaleDateString('en-US', { weekday: 'short' }) };
  return {
    top: d.toLocaleDateString('en-US', { weekday: 'short' }),
    bottom: d.toLocaleDateString('en-US', { month: 'short' }),
  };
}

function formatFullDayHeading(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'photos', label: 'Photos' },
  { key: 'customer', label: 'Customer' },
  { key: 'more', label: 'More' },
];

// Feature switches from the settings file (src/config/brand.js) that hide parts of this screen.
const PORTAL_ON = isFeatureOn('customerPortal');
const MESSAGES_ON = isFeatureOn('messages') && PORTAL_ON;
const MAPS_ON = isFeatureOn('maps');

const MORE_ITEMS = ([
  {
    key: 'financials', label: 'Financials', icon: 'file-text' as const,
    description: w('Quotes, change orders and invoices for this job'),
    iconBg: tones.neutral.bg, iconColor: tones.strong.fg,
  },
  {
    key: 'materials', label: 'Materials', icon: 'clipboard' as const,
    description: 'Materials to order or pick up, vendor and prep reminder',
    iconBg: tones.neutral.bg, iconColor: tones.strong.fg,
  },
  {
    key: 'notes', label: 'My Notes', icon: 'edit-3' as const,
    description: 'Your private notes, pictures and materials list. Only you see these',
    iconBg: tones.neutral.bg, iconColor: tones.strong.fg,
  },
  {
    key: 'people', label: 'People', icon: 'users' as const,
    description: w('View and manage the customer and job team members'),
    iconBg: tones.neutral.bg, iconColor: tones.strong.fg,
  },
  {
    key: 'activity', label: 'Activity Log', icon: 'activity' as const,
    description: w('See the full history of activity on this job'),
    iconBg: tones.neutral.bg, iconColor: tones.strong.fg,
  },
  {
    key: 'settings', label: w('Job Settings'), icon: 'settings' as const,
    description: w('Configure job-level settings and requirements'),
    iconBg: tones.neutral.bg, iconColor: tones.strong.fg,
  },
]).filter((item) => (item.key !== 'financials' || isFeatureOn('financials')) && (item.key !== 'materials' || isFeatureOn('materials')));

type MoreSubSection = 'financials' | 'materials' | 'notes' | 'people' | 'activity' | 'settings';
const MORE_DEEP_LINKS: string[] = ['financials', 'materials', 'notes'].filter((k) => k === 'notes' || isFeatureOn(k as 'financials' | 'materials'));

const PHOTO_TYPE_LABEL: Record<string, string> = {
  before: 'Before', after: 'After', progress: 'Progress', issue: 'Issue', general: 'General',
};

function getPhotoTypeColor(photoType: string, primaryColor: string): string {
  const colors: Record<string, string> = { before: neutral.gray800, progress: neutral.gray700, after: primaryColor, issue: semantic.error, general: neutral.gray800 };
  return colors[photoType] ?? neutral.gray800;
}

const statusDotColors: Record<ProjectStatus, string> = {
  prospect: neutral.gray500,
  active: semantic.success,
  on_hold: semantic.warning,
  completed: semantic.info,
  archived: neutral.gray500,
};

const statusConfig: Record<ProjectStatus, { label: string; type: 'success' | 'warning' | 'info' | 'neutral' }> = {
  prospect: { label: 'Prospect', type: 'neutral' },
  active: { label: 'Active', type: 'success' },
  on_hold: { label: 'On Hold', type: 'warning' },
  completed: { label: 'Completed', type: 'info' },
  archived: { label: 'Archived', type: 'neutral' },
};

const taskStatusConfig: Record<TaskStatus, { label: string; type: 'success' | 'warning' | 'neutral' }> = {
  completed: { label: 'Completed', type: 'success' },
  in_progress: { label: 'In Progress', type: 'warning' },
  pending: { label: 'To Do', type: 'neutral' },
};

type TaskSectionKey = 'in_progress' | 'pending' | 'completed';

const TASK_SECTION_META: Record<TaskSectionKey, { label: string; status: TaskStatus }> = {
  in_progress: { label: 'In Progress', status: 'in_progress' },
  pending: { label: 'To Do', status: 'pending' },
  completed: { label: 'Completed', status: 'completed' },
};

const historyIcons: Record<string, keyof typeof Feather.glyphMap> = {
  project_created: 'plus-circle',
  status_changed: 'flag',
  progress_updated: 'trending-up',
  team_member_added: 'user-plus',
  team_member_removed: 'user-minus',
  task_created: 'plus-square',
  task_completed: 'check-circle',
  photo_added: 'camera',
  update_posted: 'send',
  request_created: 'message-circle',
  request_responded: 'message-square',
  settings_changed: 'settings',
  note_added: 'file-text',
};

const historyIconColors: Record<string, { bg: string; fg: string }> = {
  project_created: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  status_changed: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  progress_updated: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  team_member_added: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  team_member_removed: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  task_created: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  task_completed: { bg: tones.success.bg, fg: tones.success.fg },
  photo_added: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  update_posted: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  request_created: { bg: tones.warning.bg, fg: tones.warning.fg },
  request_responded: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  settings_changed: { bg: tones.neutral.bg, fg: tones.neutral.fg },
  note_added: { bg: tones.neutral.bg, fg: tones.neutral.fg },
};

/** "Completed by Rosa Lopez · Oct 15 at 2:30 PM" */
function completedLabel(task: ProjectTask): string {
  const who = task.completer ? ` by ${task.completer.firstName} ${task.completer.lastName}`.trimEnd() : '';
  if (!task.completedAt) return `Completed${who}`;
  const d = new Date(task.completedAt);
  const when = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  return `Completed${who} · ${when}`;
}

/** The customer joins the app once (their own login); after that every job they are on shows up by itself, so a project never asks for its own setup. */
function customerHasApp(personId?: string): boolean {
  return !!personId && !!rowsOf('people').find((x) => x.id === personId)?.userId;
}

export default function ProjectDetailScreen() {
  const { id, section } = useLocalSearchParams<{ id: string; section?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();

  // 'requests' / 'updates' are old deep-link values (e.g. from the Owner
  // Dashboard's Needs Attention "Review" action) — they now live inside the
  // Customer tab rather than as their own top-level section.
  const initialSection = SECTIONS.some(s => s.key === section)
    ? section!
    : (section === 'requests' || section === 'updates' || section === 'messages') ? 'customer'
    : section && MORE_DEEP_LINKS.includes(section) ? 'more' : 'overview';

  const [activeSection, setActiveSection] = useState(initialSection);
  const [customerSubTab, setCustomerSubTab] = useState<'updates' | 'requests' | 'messages'>(
    section === 'requests' ? 'requests' : section === 'messages' ? 'messages' : 'updates',
  );
  const [customerDrilldown, setCustomerDrilldown] = useState(section === 'requests' || section === 'updates' || section === 'messages');
  const [showManageAccess, setShowManageAccess] = useState(false);
  const [showCustomerPreview, setShowCustomerPreview] = useState(false);
  const [moreSubSection, setMoreSubSection] = useState<MoreSubSection | null>(section && MORE_DEEP_LINKS.includes(section) ? section as MoreSubSection : null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // The back swipe steps back INSIDE the project first (out of a More section, out of Updates & Requests) instead of leaving it.
  const backStep = useBackStep(
    (activeSection === 'more' && moreSubSection != null) || (activeSection === 'customer' && customerDrilldown),
    () => { if (activeSection === 'more' && moreSubSection != null) setMoreSubSection(null); else setCustomerDrilldown(false); },
  );
  // Opened again with ?section=financials|materials (e.g. a reminder tap) while already showing.
  useEffect(() => {
    if (section && MORE_DEEP_LINKS.includes(section)) {
      setActiveSection('more');
      setMoreSubSection(section as MoreSubSection);
    }
  }, [section]);

  const { project, updateProject, tasks, addTask, updateTask, team, addTeamMember, removeTeamMember, settings, updateSettings, history, updates, postUpdate, requests, respondToRequest, editRequestResponse, reopenRequest, deleteRequest, photos, addPhoto, updatePhoto, deletePhoto, photoStats, taskStats } = useProject(id);
  const { user } = useAuth();
  const isProjectOwner = useIsProjectOwner();
  // The owner's private My Notes (also written while quoting): shown on the Overview next to the Internal Notes so every note is in one view.
  const myNotes = useOwnerNotes(id);
  const schedule = useSchedule();
  const customerAccess = useCustomerAccess();
  const { workers: companyWorkers } = useWorkers();
  const [showAddTeamMember, setShowAddTeamMember] = useState(false);
  const [reviewPhoto, setReviewPhoto] = useState<ProjectPhoto | null>(null);
  const [customerDesc, setCustomerDesc] = useState('');
  const [editingCustomerDesc, setEditingCustomerDesc] = useState(false);
  const [showPhotoViewer, setShowPhotoViewer] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [updateVisible, setUpdateVisible] = useState(true);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [editingResponseFor, setEditingResponseFor] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState('');
  const [responseNote, setResponseNote] = useState('');
  const [accessVersion, setAccessVersion] = useState(0);
  const [activityExpanded, setActivityExpanded] = useState<Record<string, boolean>>({});
  // Clear this project's activity for a period (owner/admin; see setup.sql)
  const [clearingActivity, setClearingActivity] = useState(false);
  const [activityClearedNote, setActivityClearedNote] = useState<string | null>(null);
  const [showRadiusPicker, setShowRadiusPicker] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [scheduleDate, setScheduleDate] = useState(today);
  const [scheduleStripStart, setScheduleStripStart] = useState(today);
  const [expandedAssignmentId, setExpandedAssignmentId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [taskSectionExpanded, setTaskSectionExpanded] = useState<Record<TaskSectionKey, boolean>>({
    in_progress: false,
    pending: false,
    completed: false,
  });
  const [selectedTask, setSelectedTask] = useState<ProjectTask | null>(null);
  const [taskTitleDraft, setTaskTitleDraft] = useState('');
  const [taskDescDraft, setTaskDescDraft] = useState('');
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskMedia, setNewTaskMedia] = useState<TaskMediaDraft[]>([]);
  const [taskMediaViewer, setTaskMediaViewer] = useState<{ items: TaskMediaItem[]; index: number } | null>(null);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [photoFilter, setPhotoFilter] = useState<'all' | 'internal' | 'shared'>('all');
  const [showAddPhoto, setShowAddPhoto] = useState(false);
  const [newPhotoUri, setNewPhotoUri] = useState<string | null>(null);
  const [newPhotoType, setNewPhotoType] = useState<PhotoType>('progress');
  const [newPhotoTaskId, setNewPhotoTaskId] = useState('');
  const [newPhotoCaption, setNewPhotoCaption] = useState('');
  // Asked while adding: share with the customer now (and the one optional description serves both the team and the customer).
  const [newPhotoShare, setNewPhotoShare] = useState(false);
  const [showPhotoTaskPicker, setShowPhotoTaskPicker] = useState(false);

  if (!project) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <EmptyState icon="alert-circle" title={w('Job not found')} />
      </View>
    );
  }

  const p = project;
  const config = statusConfig[p.status];

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateTime(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  async function handleChangeCoverPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      const msg = w('Photo library access is needed to choose a job photo.');
      showMessage('Permission Needed', msg);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    attachImage('projects', p.id, 'coverPhotoUrl', await keepPicked(result.assets[0].uri), `projects/${p.id}`);
  }

  function handleSaveNotes() {
    updateProject({ notes: notesDraft.trim() || undefined });
    Keyboard.dismiss();
    setEditingNotes(false);
  }

  const canComplete = p.status === 'active' || p.status === 'on_hold';

  function askToConfirm(title: string, message: string, ok: string, onOk: () => void) {
    sharedConfirm(title, message, ok, onOk);
  }

  function handleCompleteProject() {
    askToConfirm(
      w('Complete this job?'),
      w('It moves to Completed on the Jobs list. You can reopen it any time.'),
      'Complete',
      () => { haptics.success(); updateProject({ status: 'completed', progress: 100 }); },
    );
  }

  function handleReopenProject() {
    askToConfirm(w('Reopen this job?'), 'It moves back to Active.', 'Reopen', () => updateProject({ status: 'active' }));
  }

  function renderOverview() {
    const customerName = p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : undefined;
    const fullAddress = p.address
      ? `${p.address}${p.city ? `, ${p.city}` : ''}${p.state ? `, ${p.state}` : ''}${p.zip ? ` ${p.zip}` : ''}`
      : undefined;

    return (
      <View>
        <View style={styles.coverWrap}>
          <BrandCover uri={getProjectImageUri(p)} style={styles.coverImage} />
          <View style={[styles.coverStatusPill, { backgroundColor: blackAlpha(0.55) }]}>
            <View style={[styles.coverStatusDot, { backgroundColor: statusDotColors[p.status] }]} />
            <Text style={[typeScale.labelSmall, { color: fixed.white }]}>{config.label}</Text>
          </View>
          <Pressable
            onPress={handleChangeCoverPhoto}
            style={[styles.coverChangeButton, { backgroundColor: blackAlpha(0.55) }]}
            accessibilityRole="button"
            accessibilityLabel={w('Change job photo')}
          >
            <Icon name="camera" size={14} color={fixed.white} />
            <Text style={[typeScale.labelSmall, { color: fixed.white }]}>Change photo</Text>
          </Pressable>
        </View>

        <View style={styles.overviewBody}>
          <ProspectBanner projectId={p.id} />
          {/* Progress */}
          <View>
            <Text style={[typeScale.overline, { color: colors.textTertiary }]}>{w('JOB PROGRESS')}</Text>
            <View style={styles.progressHeaderRow}>
              <Text style={[typeScale.displayLarge, { color: colors.primaryOnWhite }]}>{p.progress}%</Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                {taskStats.completed} of {taskStats.total} tasks
              </Text>
            </View>
            <ProgressBar progress={p.progress} height={8} style={{ marginTop: spacing.sm }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.md }}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Estimate from tasks</Text>
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                  {settings.autoProgress !== false
                    ? 'Updates by itself as tasks are checked off (an in-progress task counts half).'
                    : 'You set the number by hand. Checking off tasks does not change it.'}
                </Text>
              </View>
              <Switch
                value={settings.autoProgress !== false}
                onValueChange={(v) => {
                  updateSettings({ autoProgress: v });
                  if (v) { const est = estimateProgress(taskStats); if (est != null) updateProject({ progress: est }); }
                }}
                accessibilityLabel="Estimate progress from tasks"
              />
            </View>
            {settings.autoProgress === false ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md }}>
                <Pressable
                  onPress={() => updateProject({ progress: Math.max(0, p.progress - 5) })}
                  accessibilityRole="button" accessibilityLabel="Lower progress by 5 percent"
                  style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, borderRadius: radius.full, backgroundColor: colors.primarySurface }}
                >
                  <Text style={[typeScale.labelLarge, { color: colors.primaryOnWhite }]}>− 5%</Text>
                </Pressable>
                <Pressable
                  onPress={() => updateProject({ progress: Math.min(100, p.progress + 5) })}
                  accessibilityRole="button" accessibilityLabel="Raise progress by 5 percent"
                  style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.lg, borderRadius: radius.full, backgroundColor: colors.primarySurface }}
                >
                  <Text style={[typeScale.labelLarge, { color: colors.primaryOnWhite }]}>+ 5%</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          {/* Project Information */}
          <View>
            {customerName && (
              <Pressable
                style={styles.infoRow}
                disabled={!p.customerId}
                onPress={() => p.customerId && router.push(`/(owner)/customers/${p.customerId}` as any)}
              >
                <Icon name="user" size={16} color={colors.textTertiary} />
                <View style={styles.infoText}>
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Customer</Text>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{customerName}</Text>
                </View>
                {p.customerId && <Icon name="chevron-right" size={16} color={colors.textTertiary} />}
              </Pressable>
            )}

            {fullAddress && (
              <>
                <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
                <Pressable style={styles.infoRow} onPress={MAPS_ON ? () => openDirections(p) : undefined} disabled={!MAPS_ON} accessibilityRole={MAPS_ON ? 'button' : 'text'} accessibilityLabel={MAPS_ON ? 'Open address in Maps' : undefined}>
                  <Icon name="map-pin" size={16} color={colors.textTertiary} />
                  <View style={styles.infoText}>
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                      {p.latitude != null && p.longitude != null ? 'Address · found on the map' : 'Address'}
                    </Text>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{fullAddress}</Text>
                  </View>
                  <Icon name="navigation" size={16} color={colors.primaryOnWhite} />
                </Pressable>
              </>
            )}

            {(p.startDate || p.estimatedEndDate) && (
              <>
                <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
                <View style={styles.infoRowSplit}>
                  {p.startDate && (
                    <View style={styles.infoHalf}>
                      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Start Date</Text>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{formatDate(p.startDate)}</Text>
                    </View>
                  )}
                  {p.estimatedEndDate && (
                    <View style={styles.infoHalf}>
                      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Est. Completion</Text>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{formatDate(p.estimatedEndDate)}</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          {/* Snapshot */}
          <View style={styles.snapshotRow}>
            <View style={styles.snapshotItem}>
              <Icon name="users" size={16} color={colors.textSecondary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>
                {team.length} {w(team.length === 1 ? 'Crew Member' : 'Crew Members')}
              </Text>
            </View>
            <View style={[styles.snapshotDivider, { backgroundColor: colors.borderLight }]} />
            <View style={styles.snapshotItem}>
              <Icon name="check-square" size={16} color={colors.textSecondary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>
                {taskStats.completed}/{taskStats.total} Tasks
              </Text>
            </View>
            <View style={[styles.snapshotDivider, { backgroundColor: colors.borderLight }]} />
            <View style={styles.snapshotItem}>
              <Icon name="camera" size={16} color={colors.textSecondary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>
                {photoStats.total} Photos
              </Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          {/* Internal Notes */}
          <View>
            <View style={styles.notesHeaderRow}>
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>Internal Notes</Text>
              {!editingNotes && (
                <Pressable
                  onPress={() => { setNotesDraft(p.notes ?? ''); setEditingNotes(true); }}
                  hitSlop={8}
                  accessibilityLabel="Edit internal notes"
                >
                  <Icon name="edit-3" size={16} color={colors.primaryOnWhite} />
                </Pressable>
              )}
            </View>

            {editingNotes ? (
              <View style={{ marginTop: spacing.sm }}>
                <TextInput
                  style={[styles.composerInput, styles.composerBody, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary }]}
                  value={notesDraft}
                  onChangeText={setNotesDraft}
                  placeholder={w('Internal notes about this job (not visible to customer)')}
                  placeholderTextColor={colors.textTertiary}
                  multiline
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button title="Cancel" onPress={() => setEditingNotes(false)} variant="secondary" size="sm" style={{ flex: 1 }} />
                  <Button title="Save" onPress={handleSaveNotes} variant="primary" size="sm" style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <Text style={[typeScale.bodyLarge, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                {p.notes || (isProjectOwner && myNotes.length ? '' : 'No internal notes yet.')}
              </Text>
            )}
            {isProjectOwner && !editingNotes && myNotes.length ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={[typeScale.overline, { color: colors.textTertiary }]}>MY NOTES · {myNotes.length}</Text>
                {myNotes.slice(0, 3).map((n) => (
                  <Text key={n.id} style={[typeScale.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs }]} numberOfLines={4}>{n.body}</Text>
                ))}
                <Pressable
                  onPress={() => { setActiveSection('more'); setMoreSubSection('notes'); }}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                  accessibilityRole="button"
                >
                  <Text style={[typeScale.labelLarge, { color: colors.primaryOnWhite }]}>{myNotes.length > 3 ? `See all ${myNotes.length} in My Notes` : 'Open My Notes'}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {canComplete && (
            <Button title={w('Complete Job')} icon="check-circle" onPress={handleCompleteProject} fullWidth style={{ marginTop: spacing.xl }} />
          )}
          {p.status === 'completed' && (
            <View style={{ marginTop: spacing.xl }}>
              {p.completedAt && (
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm }]}>
                  Completed {formatDate(p.completedAt)}
                </Text>
              )}
              <Button title={w('Reopen Job')} icon="rotate-ccw" variant="secondary" onPress={handleReopenProject} fullWidth />
            </View>
          )}
          {isFeatureOn('issues') ? <IssuesSection where={{ projectId: p.id }} /> : null}
        </View>
      </View>
    );
  }

  function renderSchedule() {
    const dayAssignments = schedule.getByProject(p.id, scheduleDate);
    const stripDates = Array.from({ length: 5 }, (_, i) => offsetDateStr(scheduleStripStart, i));
    const workerCount = dayAssignments.length;

    const confirmBadge = (state: string) => {
      if (state === 'confirmed') return { label: 'Confirmed', status: 'success' as const };
      if (state === 'awaiting') return { label: 'Awaiting', status: 'warning' as const };
      return { label: 'Not Sent', status: 'neutral' as const };
    };

    function handleCancelAssignment(a: Assignment) {
      const msg = `Cancel ${a.person?.firstName ?? 'this worker'}'s assignment at ${p.name}?`;
      if (Platform.OS === 'web') {
        const reason = prompt(msg + '\n\nReason (optional):');
        if (reason === null) return;
        haptics.destructive();
        schedule.cancelAssignment(a.id, reason || undefined);
      } else {
        sharedConfirm('Cancel Assignment', msg, 'Cancel Assignment', () => { haptics.destructive(); schedule.cancelAssignment(a.id); }, true, 'Keep');
      }
      setExpandedAssignmentId(null);
    }

    function handleMoveAssignment(a: Assignment) {
      setExpandedAssignmentId(null);
      router.push(`/(owner)/schedule-create?moveFrom=${a.id}&workerId=${a.personId}&date=${scheduleDate}` as any);
    }

    return (
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStripRow}>
          {stripDates.map((dateStr) => {
            const isSelected = dateStr === scheduleDate;
            const label = getDateChipLabel(dateStr);
            const dayNum = new Date(dateStr + 'T12:00:00').getDate();
            return (
              <Pressable
                key={dateStr}
                style={[styles.dateChip, { backgroundColor: isSelected ? colors.primary : colors.backgroundTertiary }]}
                onPress={() => { haptics.select(); setScheduleDate(dateStr); setExpandedAssignmentId(null); }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${formatFullDayHeading(dateStr)}${isSelected ? ', selected' : ''}`}
              >
                <Text style={[typeScale.caption, { color: isSelected ? withAlpha(colors.textOnPrimary, 0.85) : colors.textSecondary }]}>
                  {label.top}
                </Text>
                <Text style={[typeScale.headingLarge, { color: isSelected ? colors.textOnPrimary : colors.textPrimary }]}>
                  {dayNum}
                </Text>
                <Text style={[typeScale.caption, { color: isSelected ? withAlpha(colors.textOnPrimary, 0.85) : colors.textTertiary }]}>
                  {label.bottom}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.dateChip, styles.calendarChip, { backgroundColor: colors.backgroundTertiary }]}
            onPress={() => setScheduleStripStart(offsetDateStr(scheduleStripStart, 5))}
            accessibilityRole="button"
            accessibilityLabel="Show later dates"
          >
            <Icon name="calendar" size={18} color={colors.textSecondary} />
          </Pressable>
        </ScrollView>

        <View style={styles.sectionContent}>
          <View style={styles.scheduleDayHeader}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
              {formatFullDayHeading(scheduleDate)}
            </Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
              {workerCount === 0 ? 'No workers scheduled' : `${workerCount} worker${workerCount === 1 ? '' : 's'} scheduled`}
            </Text>
          </View>

          {dayAssignments.length > 0 && (
            <View style={[styles.assignmentList, { backgroundColor: colors.surface }, shadow.sm]}>
              {dayAssignments.map((a, i) => {
                const timeStr = a.isFullDay ? 'Full Day' : `${formatTimeLabel(a.startTime)} – ${formatTimeLabel(a.endTime)}`;
                const badge = confirmBadge(a.confirmationState);
                const isExpanded = expandedAssignmentId === a.id;
                return (
                  <View key={a.id}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />}
                    <Pressable
                      style={styles.assignmentRow}
                      onPress={() => setExpandedAssignmentId(isExpanded ? null : a.id)}
                    >
                      <Avatar firstName={a.person?.firstName ?? '?'} lastName={a.person?.lastName ?? '?'} size={44} uri={a.person?.avatarUrl} />
                      <View style={{ flex: 1 }}>
                        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
                          {a.person?.firstName} {a.person?.lastName}
                        </Text>
                        <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{timeStr}</Text>
                        {a.truck && (
                          <View style={styles.truckRow}>
                            <Icon name="truck" size={11} color={colors.textTertiary} />
                            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{a.truck.name}</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.assignmentStatusCol}>
                        <StatusBadge label={badge.label} status={badge.status} />
                        <Icon name="chevron-right" size={16} color={colors.textTertiary} />
                      </View>
                    </Pressable>

                    {isExpanded && (
                      <View style={[styles.assignmentActionsRow, { backgroundColor: colors.backgroundTertiary }]}>
                        <Pressable style={styles.assignmentActionBtn} onPress={() => handleMoveAssignment(a)}>
                          <Icon name="arrow-right-circle" size={16} color={colors.primaryOnWhite} />
                          <Text style={[typeScale.caption, { color: colors.primaryOnWhite }]}>Move</Text>
                        </Pressable>
                        <Pressable style={styles.assignmentActionBtn} onPress={() => handleCancelAssignment(a)}>
                          <Icon name="x-circle" size={16} color={semantic.error} />
                          <Text style={[typeScale.caption, { color: semantic.error }]}>Cancel</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <Pressable
            style={[styles.scheduleWorkerBtn, { borderColor: colors.primary, marginTop: dayAssignments.length > 0 ? spacing.md : 0 }]}
            onPress={() => router.push(`/(owner)/schedule-create?projectId=${p.id}&date=${scheduleDate}` as any)}
          >
            <Icon name="plus" size={16} color={colors.primaryOnWhite} />
            <Text style={[typeScale.labelLarge, { color: colors.primaryOnWhite }]}>Schedule Worker</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function handleAddTeamMember(personId: string) {
    addTeamMember(personId);
    setShowAddTeamMember(false);
  }

  function handleRemoveTeamMember(personId: string, name: string) {
    const msg = w("Remove {name} from this job's team? They will no longer be assignable to this job's tasks or schedule.", { name });
    sharedConfirm('Remove team member?', msg, 'Remove', () => removeTeamMember(personId), true);
  }

  function renderPeople() {
    const availableWorkers = companyWorkers.filter(
      w => !team.some(tm => tm.personId === w.person.id),
    );

    return (
      <View style={styles.sectionContent}>
        <View style={[styles.moreSummaryCard, { backgroundColor: colors.surface }, shadow.sm]}>
          <BrandCover uri={getProjectImageUri(p)} style={styles.moreSummaryImage} variant="tile" />
          <View style={{ marginLeft: spacing.md, flex: 1 }}>
            <StatusBadge label={config.label} status={config.type} style={{ alignSelf: 'flex-start' }} />
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginTop: spacing.xs }]} numberOfLines={1}>
              {p.name}
            </Text>
            {p.address && (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
                {p.address}{p.city ? `, ${p.city}` : ''}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.teamHeaderRow}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, fontWeight: '700' }]}>
              {w('Job Team')} ({team.length})
            </Text>
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
              {w('Team members assigned to this job')}
            </Text>
          </View>
          <Pressable
            style={[styles.addTeamMemberBtn, { backgroundColor: colors.primarySurface, flexShrink: 0 }]}
            onPress={() => setShowAddTeamMember(true)}
          >
            <Icon name="plus" size={14} color={colors.primaryOnWhite} />
            <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite, fontWeight: '700', marginLeft: 4 }]} numberOfLines={1}>
              Add Team Member
            </Text>
          </Pressable>
        </View>

        {team.length === 0 ? (
          <EmptyState icon="users" title="No team members yet" description={w("Add workers to this job's team so they can be scheduled and assigned tasks.")} />
        ) : (
          <View style={[styles.teamListCard, { backgroundColor: colors.surface }, shadow.sm]}>
            {team.map((member, i) => (
              <View key={member.id}>
                {i > 0 && <Divider style={{ marginHorizontal: spacing.md }} />}
                <Pressable
                  style={styles.teamRow}
                  onPress={() => router.push(`/(owner)/workers/${member.personId}` as any)}
                >
                  <Avatar
                    firstName={member.person?.firstName ?? '?'}
                    lastName={member.person?.lastName ?? ''}
                    size={44}
                    uri={member.person?.avatarUrl}
                  />
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>
                      {member.person?.firstName} {member.person?.lastName}
                    </Text>
                    <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>Worker</Text>
                  </View>
                  <Pressable
                    hitSlop={10}
                    onPress={() => handleRemoveTeamMember(member.personId, `${member.person?.firstName} ${member.person?.lastName}`)}
                    style={{ padding: spacing.xs }}
                  >
                    <Icon name="user-minus" size={16} color={colors.textTertiary} />
                  </Pressable>
                  <Icon name="chevron-right" size={18} color={colors.textTertiary} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.aboutTeamCard, { backgroundColor: colors.backgroundTertiary }]}>
          <Icon name="info" size={16} color={colors.primaryOnWhite} />
          <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.sm, flex: 1 }]}>
            {w('Job team members have access to this job and can be assigned to tasks and schedules. This does not automatically mean they are scheduled to work here today.')}
          </Text>
        </View>

        <BottomSheetModal visible={showAddTeamMember} onRequestClose={() => setShowAddTeamMember(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
              <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
                <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Add Team Member</Text>
                <Pressable onPress={() => setShowAddTeamMember(false)} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close">
                  <Icon name="x" size={24} color={colors.textSecondary} />
                </Pressable>
              </View>
              <ScrollView bounces={false} style={styles.modalBody} showsVerticalScrollIndicator={false}>
                {availableWorkers.length === 0 ? (
                  <Text style={[typeScale.bodySmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>
                    {w("Every active worker is already on this job's team.")}
                  </Text>
                ) : (
                  availableWorkers.map((w, i) => (
                    <View key={w.person.id}>
                      {i > 0 && <Divider style={{ marginVertical: spacing.sm }} />}
                      <Pressable
                        style={styles.teamRow}
                        onPress={() => handleAddTeamMember(w.person.id)}
                      >
                        <Avatar firstName={w.person.firstName} lastName={w.person.lastName} size={40} uri={w.person.avatarUrl} />
                        <View style={{ flex: 1, marginLeft: spacing.sm }}>
                          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>
                            {w.person.firstName} {w.person.lastName}
                          </Text>
                        </View>
                        <Icon name="plus-circle" size={20} color={colors.primaryOnWhite} />
                      </Pressable>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </BottomSheetModal>
      </View>
    );
  }

  function renderCustomerUpdatesRequests() {
    const pendingCount = requests.filter(r => r.status === 'pending').length;
    const messageCount = db.messages[p.id]?.length ?? 0;
    return (
      <View>
        <View style={styles.pillToggleRow}>
          <Pressable
            style={[styles.pillToggle, { backgroundColor: customerSubTab === 'updates' ? colors.primary : colors.backgroundTertiary }]}
            onPress={() => setCustomerSubTab('updates')}
          >
            <Text style={[typeScale.labelSmall, { color: customerSubTab === 'updates' ? colors.textOnPrimary : colors.textSecondary }]}>
              Updates
            </Text>
          </Pressable>
          <Pressable
            style={[styles.pillToggle, { backgroundColor: customerSubTab === 'requests' ? colors.primary : colors.backgroundTertiary }]}
            onPress={() => setCustomerSubTab('requests')}
          >
            <Text style={[typeScale.labelSmall, { color: customerSubTab === 'requests' ? colors.textOnPrimary : colors.textSecondary }]}>
              Requests{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Text>
          </Pressable>
          {MESSAGES_ON && (
            <Pressable
              style={[styles.pillToggle, { backgroundColor: customerSubTab === 'messages' ? colors.primary : colors.backgroundTertiary }]}
              onPress={() => setCustomerSubTab('messages')}
            >
              <Text style={[typeScale.labelSmall, { color: customerSubTab === 'messages' ? colors.textOnPrimary : colors.textSecondary }]}>
                Messages{messageCount > 0 ? ` (${messageCount})` : ''}
              </Text>
            </Pressable>
          )}
        </View>
        {customerSubTab === 'updates' || (customerSubTab === 'messages' && !MESSAGES_ON) ? renderUpdates() : customerSubTab === 'requests' ? renderRequests() : (
          <View style={styles.sectionContent}>
            <MessageThread
              projectId={p.id}
              emptyText={p.customerId ? 'Send your customer a message. They\u2019ll see it in their app under Messages.' : w('Add a customer to this job to message them.')}
            />
          </View>
        )}
      </View>
    );
  }

  function handleCallCustomer() {
    if (!p.customer?.phone) return;
    Linking.openURL(`tel:${p.customer.phone.replace(/[^\d+]/g, '')}`);
  }

  function handleMessageCustomer() {
    if (!p.customer?.phone) return;
    Linking.openURL(`sms:${p.customer.phone.replace(/[^\d+]/g, '')}`);
  }

  function handleEmailCustomer() {
    if (!p.customer?.email) return;
    Linking.openURL(`mailto:${p.customer.email}`);
  }

  function handleToggleComments(value: boolean) {
    updateSettings({ customerCanComment: value });
  }

  function handleToggleRequests(value: boolean) {
    updateSettings({ customerCanRequest: value });
  }

  function handlePreviewCustomerView() {
    setShowCustomerPreview(true);
  }

  function renderCustomerOverview() {
    const access = customerAccess.getAccessForProject(p.id);
    const hasApp = customerHasApp(p.customer?.id);
    const sharedPhotoCount = photoStats.shared;

    return (
      <View style={styles.sectionContent}>
        {!p.customer ? (
          <EmptyState
            icon="user-plus"
            title="No customer assigned"
            description={w('Assign a customer to this job to manage their access and portal content.')}
          />
        ) : (
          <>
            <View style={[styles.customerCard, { backgroundColor: colors.surface }, shadow.sm]}>
              <View style={styles.customerCardTop}>
                <Avatar firstName={p.customer.firstName} lastName={p.customer.lastName} size={52} uri={p.customer.avatarUrl} />
                <View style={{ marginLeft: spacing.md, flex: 1 }}>
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>
                    {p.customer.firstName} {p.customer.lastName}
                  </Text>
                  <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>Homeowner</Text>
                </View>
              </View>

              <View style={styles.customerContactList}>
                {p.customer.phone && (
                  <View style={styles.customerContactRow}>
                    <Icon name="phone" size={14} color={colors.textTertiary} />
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{p.customer.phone}</Text>
                  </View>
                )}
                <View style={styles.customerContactRow}>
                  <Icon name="mail" size={14} color={colors.textTertiary} />
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]}>{p.customer.email}</Text>
                </View>
                {p.address && (
                  <View style={styles.customerContactRow}>
                    <Icon name="map-pin" size={14} color={colors.textTertiary} />
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.xs }]} numberOfLines={1}>
                      {p.address}{p.city ? `, ${p.city}` : ''}{p.state ? `, ${p.state}` : ''}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.customerActionRow}>
                <Pressable
                  style={[styles.customerActionBtn, { backgroundColor: colors.backgroundTertiary }, !p.customer.phone && { opacity: 0.4 }]}
                  onPress={handleCallCustomer}
                  disabled={!p.customer.phone}
                >
                  <Icon name="phone" size={16} color={semantic.success} />
                  <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>Call</Text>
                </Pressable>
                <Pressable
                  style={[styles.customerActionBtn, { backgroundColor: colors.backgroundTertiary }, !p.customer.phone && { opacity: 0.4 }]}
                  onPress={handleMessageCustomer}
                  disabled={!p.customer.phone}
                >
                  <Icon name="message-circle" size={16} color={colors.primaryOnWhite} />
                  <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>Message</Text>
                </Pressable>
                <Pressable
                  style={[styles.customerActionBtn, { backgroundColor: colors.backgroundTertiary }]}
                  onPress={handleEmailCustomer}
                >
                  <Icon name="mail" size={16} color={colors.textSecondary} />
                  <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]}>Email</Text>
                </Pressable>
              </View>
            </View>

            {PORTAL_ON && (<>
            {/* Project Access */}
            <View style={[styles.accessCard, { backgroundColor: colors.surface }, shadow.sm]}>
              <View style={styles.accessCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>{w('Job Access')}</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                    {access?.claimedBy || hasApp
                      ? w('{name} sees this job in the app automatically.', { name: p.customer.firstName })
                      : w('{firstName} hasn\'t joined the app yet. They join once with one link; after that every job they are on shows up by itself.', { firstName: p.customer.firstName })}
                  </Text>
                </View>
                <StatusBadge label={access?.claimedBy || hasApp ? 'Connected' : 'Waiting'} status={access?.claimedBy || hasApp ? 'success' : 'neutral'} />
              </View>

              {access?.claimedBy && (
                <Pressable style={[styles.accessDetailRow, { backgroundColor: colors.backgroundTertiary }]} onPress={() => setShowManageAccess(true)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <Icon name="user" size={16} color={colors.textSecondary} />
                    <View style={{ marginLeft: spacing.sm, flexShrink: 1 }}>
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]} numberOfLines={1}>
                        {access.claimedByEmail ?? p.customer.email}
                      </Text>
                      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                        Added {access.claimedAt ? formatDate(access.claimedAt) : '—'}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.manageAccessPill, { backgroundColor: colors.surface, flexShrink: 0, marginLeft: spacing.sm }]}>
                    <Text style={[typeScale.labelSmall, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>Manage</Text>
                    <Icon name="chevron-right" size={14} color={colors.textTertiary} />
                  </View>
                </Pressable>
              )}

              {!access?.claimedBy && !hasApp && (
                <Pressable style={[styles.manageAccessPillFull, { backgroundColor: colors.backgroundTertiary }]} onPress={() => setShowManageAccess(true)}>
                  <Icon name="link" size={14} color={colors.textSecondary} />
                  <Text style={[typeScale.labelSmall, { color: colors.textPrimary, fontWeight: '600', marginLeft: spacing.xs }]}>Send App Link</Text>
                </Pressable>
              )}
            </View>

            {/* Customer Settings */}
            {settings && (
              <View style={[styles.settingsCard, { backgroundColor: colors.surface }, shadow.sm]}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm }]}>Customer Settings</Text>

                <View style={styles.customerSettingRow}>
                  <View style={{ flex: 1, marginRight: spacing.sm }}>
                    <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Allow Comments</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                      Customer can leave comments on photos and updates
                    </Text>
                  </View>
                  <Switch
                    value={settings.customerCanComment}
                    onValueChange={handleToggleComments}
                  />
                </View>

                <Divider style={{ marginVertical: spacing.sm }} />

                <View style={styles.customerSettingRow}>
                  <View style={{ flex: 1, marginRight: spacing.sm }}>
                    <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Allow Requests</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                      {w('Customer can send requests related to this job')}
                    </Text>
                  </View>
                  <Switch
                    value={settings.customerCanRequest}
                    onValueChange={handleToggleRequests}
                  />
                </View>
              </View>
            )}

            {/* Customer Content */}
            <View style={[styles.settingsCard, { backgroundColor: colors.surface }, shadow.sm]}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Customer Content</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2, marginBottom: spacing.sm }]}>
                What {p.customer.firstName} can see and interact with
              </Text>

              <Pressable
                style={styles.customerContentRow}
                onPress={() => { setActiveSection('photos'); setPhotoFilter('shared'); }}
              >
                <View style={[styles.customerContentIcon, { backgroundColor: colors.primarySurface }]}>
                  <Icon name="image" size={16} color={colors.primaryOnWhite} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Shared Photos</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                    {sharedPhotoCount} photo{sharedPhotoCount === 1 ? '' : 's'} visible to customer
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textTertiary} />
              </Pressable>
              <Divider style={{ marginVertical: spacing.xs }} />

              <Pressable
                style={styles.customerContentRow}
                onPress={() => { setCustomerSubTab('updates'); setCustomerDrilldown(true); }}
              >
                <View style={[styles.customerContentIcon, { backgroundColor: colors.backgroundTertiary }]}>
                  <Icon name="file-text" size={16} color={colors.textSecondary} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>{w('Job Updates')}</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                    {updates.length === 0 ? 'No updates yet' : `${updates.length} update${updates.length === 1 ? '' : 's'} visible to customer`}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textTertiary} />
              </Pressable>
              <Divider style={{ marginVertical: spacing.xs }} />

              <Pressable
                style={styles.customerContentRow}
                onPress={() => { setCustomerSubTab('requests'); setCustomerDrilldown(true); }}
              >
                <View style={[styles.customerContentIcon, { backgroundColor: tones.neutral.bg }]}>
                  <Icon name="message-circle" size={16} color={tones.strong.fg} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Customer Requests</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                    {requests.length === 0 ? 'No requests' : `${requests.length} request${requests.length === 1 ? '' : 's'} from customer`}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textTertiary} />
              </Pressable>
              {MESSAGES_ON && <Divider style={{ marginVertical: spacing.xs }} />}

              {MESSAGES_ON && <Pressable
                style={styles.customerContentRow}
                onPress={() => { setCustomerSubTab('messages'); setCustomerDrilldown(true); }}
              >
                <View style={[styles.customerContentIcon, { backgroundColor: colors.primarySurface }]}>
                  <Icon name="send" size={16} color={colors.primaryOnWhite} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Messages</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                    {(db.messages[p.id]?.length ?? 0) === 0 ? 'No messages yet' : `${db.messages[p.id].length} message${db.messages[p.id].length === 1 ? '' : 's'}`}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textTertiary} />
              </Pressable>}
            </View>

            <Pressable style={[styles.previewBtn, { backgroundColor: colors.primary }]} onPress={handlePreviewCustomerView}>
              <Icon name="eye" size={18} color={colors.textOnPrimary} />
              <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary, fontWeight: '700', marginLeft: spacing.xs }]}>
                Preview Customer View
              </Text>
            </Pressable>
            <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xs }]}>
              See exactly what {p.customer.firstName} sees in the customer portal.
            </Text>
            </>)}
          </>
        )}
      </View>
    );
  }

  function renderCustomerTab() {
    return customerDrilldown ? renderCustomerUpdatesRequests() : renderCustomerOverview();
  }

  function renderMore() {
    if (!moreSubSection) {
      return (
        <View style={styles.sectionContent}>
          <View style={[styles.moreSummaryCard, { backgroundColor: colors.surface }, shadow.sm]}>
            <BrandCover uri={getProjectImageUri(p)} style={styles.moreSummaryImage} variant="tile" />
            <View style={{ marginLeft: spacing.md, flex: 1 }}>
              <StatusBadge label={config.label} status={config.type} style={{ alignSelf: 'flex-start' }} />
              <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginTop: spacing.xs }]} numberOfLines={1}>
                {p.name}
              </Text>
              {p.address && (
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
                  {p.address}{p.city ? `, ${p.city}` : ''}
                </Text>
              )}
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                Created {formatDate(p.createdAt)}
              </Text>
            </View>
          </View>

          {MORE_ITEMS.filter((item) => item.key !== 'notes' || isProjectOwner).map((item) => (
            <Pressable
              key={item.key}
              style={[styles.moreCardRow, { backgroundColor: colors.surface }, shadow.sm]}
              onPress={() => setMoreSubSection(item.key as MoreSubSection)}
            >
              <View style={[styles.moreCardIcon, { backgroundColor: item.iconBg }]}>
                <Icon name={item.icon} size={18} color={item.iconColor} />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>
                  {item.label}
                </Text>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
                  {item.description}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      );
    }

    return (
      <View>
        {moreSubSection === 'financials' && isFeatureOn('financials') && <ProjectFinancials projectId={p.id} />}
        {moreSubSection === 'materials' && isFeatureOn('materials') && <ProjectMaterials projectId={p.id} />}
        {moreSubSection === 'notes' && isProjectOwner && (
          <View style={styles.sectionContent}>
            <ProjectPrivateNotes
              projectId={p.id}
              projectName={p.name}
              address={[p.address, p.city].filter(Boolean).join(', ') || undefined}
              internalNotes={p.notes}
              onEditInternalNotes={() => { setMoreSubSection(null); setActiveSection('overview'); setNotesDraft(p.notes ?? ''); setEditingNotes(true); }}
            />
          </View>
        )}
        {moreSubSection === 'people' && renderPeople()}
        {moreSubSection === 'activity' && renderActivity()}
        {moreSubSection === 'settings' && renderSettings()}
      </View>
    );
  }

  function applyTaskFilter(next: 'all' | 'open' | 'completed') {
    haptics.select();
    setTaskFilter(next);
    if (next === 'all') {
      setTaskSectionExpanded({ in_progress: false, pending: false, completed: false });
    } else if (next === 'open') {
      setTaskSectionExpanded({ in_progress: true, pending: true, completed: false });
    } else {
      setTaskSectionExpanded({ in_progress: false, pending: false, completed: true });
    }
  }

  function toggleTaskSection(key: TaskSectionKey) {
    haptics.select();
    setTaskSectionExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function openTaskDetail(task: ProjectTask) {
    setTaskTitleDraft(task.title);
    setTaskDescDraft(task.description ?? '');
    setSelectedTask(task);
  }

  function handleSaveTaskDetails() {
    if (!selectedTask) return;
    updateTask(selectedTask.id, {
      title: taskTitleDraft.trim() || selectedTask.title,
      description: taskDescDraft.trim() || undefined,
    });
  }

  function handleChangeTaskStatus(newStatus: TaskStatus) {
    if (!selectedTask) return;
    updateTask(selectedTask.id, {
      status: newStatus,
      completedAt: newStatus === 'completed' ? new Date().toISOString() : undefined,
    });
    haptics.success();
    setSelectedTask({ ...selectedTask, status: newStatus });
  }

  function handleAssignTask(personId: string) {
    if (!selectedTask) return;
    const member = team.find(m => m.personId === personId);
    updateTask(selectedTask.id, {
      assignedTo: personId || undefined,
      assignee: member?.person,
    });
    setShowAssigneePicker(false);
    setSelectedTask({ ...selectedTask, assignedTo: personId || undefined, assignee: member?.person });
  }

  function handleAddTask() {
    if (!newTaskTitle.trim()) return;
    const member = team.find(m => m.personId === newTaskAssignee);
    const created = addTask({
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim() || undefined,
      status: 'pending',
      sortOrder: tasks.length + 1,
      assignedTo: newTaskAssignee || undefined,
      assignee: member?.person,
    });
    if (newTaskMedia.length > 0) saveTaskMedia(id, created.id, newTaskMedia);
    setShowAddTask(false);
    setNewTaskTitle('');
    setNewTaskDescription('');
    setNewTaskAssignee('');
    setNewTaskMedia([]);
  }

  async function handleAddNewTaskMedia() {
    const picked = await pickTaskMedia(newTaskMedia.length);
    if (picked.length > 0) setNewTaskMedia(prev => [...prev, ...picked]);
  }

  async function handleAddTaskMedia(task: ProjectTask) {
    const picked = await pickTaskMedia((db.taskAttachments[task.id] ?? []).length);
    if (picked.length > 0) saveTaskMedia(id, task.id, picked);
  }

  function handleRemoveTaskMedia(taskId: string, attachmentId: string) {
    const att = (db.taskAttachments[taskId] ?? []).find(a => a.id === attachmentId);
    if (!att) return;
    confirmAction(
      att.mediaType === 'video' ? 'Remove video?' : 'Remove photo?',
      w('The crew will no longer see it on this task.'),
      'Remove',
      () => removeTaskMedia(att),
    );
  }

  function renderTaskRow(task: ProjectTask) {
    const photoRequired = (settings?.completionPhotoRequired ?? false) && task.status !== 'completed';
    const taskPhoto = photos.find(ph => ph.taskId === task.id);

    return (
      <Pressable
        key={task.id}
        style={styles.taskRow}
        onPress={() => openTaskDetail(task)}
      >
        <Icon
          name={task.status === 'completed' ? 'check-circle' : task.status === 'in_progress' ? 'play-circle' : 'circle'}
          size={20}
          color={task.status === 'completed' ? semantic.success : task.status === 'in_progress' ? semantic.warning : colors.textTertiary}
        />
        <View style={styles.taskRowContent}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
            {task.title}
          </Text>
          <View style={styles.taskAssigneeRow}>
            {task.assignee ? (
              <>
                <Avatar firstName={task.assignee.firstName} lastName={task.assignee.lastName} size={16} uri={task.assignee.avatarUrl} />
                <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                  {task.assignee.firstName} {task.assignee.lastName}
                </Text>
              </>
            ) : (
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Unassigned</Text>
            )}
          </View>
          {photoRequired && (
            <View style={styles.taskPhotoRequiredRow}>
              <Icon name="camera" size={11} color={semantic.warning} />
              <Text style={[typeScale.caption, { color: semantic.warning }]}>Photo required</Text>
            </View>
          )}
          {task.status === 'completed' && (task.completer || task.completedAt) && (
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
              {completedLabel(task)}
            </Text>
          )}
          {task.status === 'completed' && taskPhoto && (
            <View style={styles.taskPhotoRequiredRow}>
              <Icon name="camera" size={11} color={colors.textTertiary} />
              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Completion photo attached</Text>
            </View>
          )}
        </View>
        <Icon name="chevron-right" size={16} color={colors.textTertiary} />
      </Pressable>
    );
  }

  function renderTaskSection(key: TaskSectionKey, sectionTasks: ProjectTask[]) {
    const meta = TASK_SECTION_META[key];
    const isExpanded = taskSectionExpanded[key];

    return (
      <View key={key} style={[styles.taskSection, { backgroundColor: colors.surface }, shadow.sm]}>
        <Pressable style={styles.taskSectionHeader} onPress={() => toggleTaskSection(key)}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
            {meta.label} <Text style={{ color: colors.textTertiary }}>({sectionTasks.length})</Text>
          </Text>
          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
        </Pressable>
        {isExpanded && (
          sectionTasks.length === 0 ? (
            <Text style={[typeScale.caption, { color: colors.textTertiary, paddingHorizontal: spacing.md, paddingBottom: spacing.md }]}>
              No {meta.label.toLowerCase()} tasks
            </Text>
          ) : (
            <View>
              {sectionTasks.map((task, i) => (
                <View key={task.id}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />}
                  {renderTaskRow(task)}
                </View>
              ))}
            </View>
          )
        )}
      </View>
    );
  }

  function renderTasks() {
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const completedTasks = tasks.filter(t => t.status === 'completed');

    const filterOptions: { key: 'all' | 'open' | 'completed'; label: string; count: number }[] = [
      { key: 'all', label: 'All', count: taskStats.total },
      { key: 'open', label: 'Open', count: taskStats.inProgress + taskStats.pending },
      { key: 'completed', label: 'Completed', count: taskStats.completed },
    ];

    const sectionsToShow: TaskSectionKey[] =
      taskFilter === 'all' ? ['in_progress', 'pending', 'completed']
      : taskFilter === 'open' ? ['in_progress', 'pending']
      : ['completed'];

    const sectionTaskMap: Record<TaskSectionKey, ProjectTask[]> = {
      in_progress: inProgressTasks,
      pending: pendingTasks,
      completed: completedTasks,
    };

    return (
      <View style={styles.sectionContent}>
        <View style={styles.taskStatsHeader}>
          <View style={styles.taskProgressRow}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>
              {taskStats.completed} of {taskStats.total} completed
            </Text>
            <Text style={[typeScale.bodyLarge, { color: colors.textSecondary }]}>
              {taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0}%
            </Text>
          </View>
          <ProgressBar
            progress={taskStats.total > 0 ? (taskStats.completed / taskStats.total) * 100 : 0}
            height={6}
            style={{ marginTop: spacing.sm }}
          />
        </View>

        {/* Task Lead (enforced in setup.sql): only this worker can start/complete tasks on the job. */}
        <View style={[styles.taskStatsHeader, { gap: spacing.sm }]}>
          <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>Task Lead</Text>
          <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
            {db.company?.taskLeadOnly
              ? (p.taskLeadId
                ? w('Only the Task Lead can start and complete tasks. The rest of the crew can see them.')
                : 'Pick one worker to run the task list. Until then, workers cannot change tasks.')
              : (p.taskLeadId
                ? w('Anyone on this job can check off tasks. (More → Settings → Job Tasks can limit this to the Task Lead.)')
                : w('Anyone on this job can check off tasks. Picking a Task Lead is optional. (More → Settings → Job Tasks can limit checking off to the Task Lead.)'))}
          </Text>
          {team.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {team.map(tm => {
                const on = tm.personId === p.taskLeadId;
                const label = tm.person ? `${tm.person.firstName} ${tm.person.lastName}`.trim() : 'Worker';
                return (
                  <Pressable
                    key={tm.personId}
                    onPress={() => updateProject({ taskLeadId: tm.personId })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={{
                      paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.full,
                      backgroundColor: on ? colors.primary : colors.primarySurface,
                    }}
                  >
                    <Text style={[typeScale.labelLarge, { color: on ? colors.textOnPrimary : colors.primaryOnWhite }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{w('Add workers to the job team first.')}</Text>
          )}
        </View>

        <View style={styles.taskFilterRow}>
          {filterOptions.map(opt => (
            <Pressable
              key={opt.key}
              style={[styles.taskFilterChip, { backgroundColor: taskFilter === opt.key ? colors.primarySurface : 'transparent' }]}
              onPress={() => applyTaskFilter(opt.key)}
            >
              <Text style={[typeScale.labelSmall, { color: taskFilter === opt.key ? colors.primaryOnWhite : colors.textSecondary, fontWeight: taskFilter === opt.key ? '700' : '500' }]}>
                {opt.label} ({opt.count})
              </Text>
            </Pressable>
          ))}
        </View>

        {tasks.length === 0 ? (
          <EmptyState icon="check-square" title="No tasks yet" description={w("Tasks will appear here as they're added to this job.")} />
        ) : (
          <View style={{ gap: spacing.md }}>
            {sectionsToShow.map(key => renderTaskSection(key, sectionTaskMap[key]))}
          </View>
        )}

        <Pressable
          style={[styles.scheduleWorkerBtn, { borderColor: colors.primary, marginTop: spacing.lg }]}
          onPress={() => setShowAddTask(true)}
        >
          <Icon name="plus" size={16} color={colors.primaryOnWhite} />
          <Text style={[typeScale.labelLarge, { color: colors.primaryOnWhite }]}>Add Task</Text>
        </Pressable>
      </View>
    );
  }

  function openPhotoReview(photo: ProjectPhoto) {
    setCustomerDesc(photo.customerDescription ?? '');
    setEditingCustomerDesc(false);
    setReviewPhoto(photo);
  }

  function handleSharePhoto() {
    if (!reviewPhoto) return;
    if (!customerDesc.trim()) {
      const msg = 'Add a customer description before sharing this photo. The worker note is internal-only and is never shown to the customer automatically.';
      showMessage('Description needed', msg);
      setEditingCustomerDesc(true);
      return;
    }
    updatePhoto(reviewPhoto.id, {
      isCustomerVisible: true,
      customerDescription: customerDesc,
      sharedBy: user?.id,
      sharedAt: new Date().toISOString(),
    });
    setReviewPhoto(null);
  }

  function handleUnsharePhoto() {
    if (!reviewPhoto) return;
    updatePhoto(reviewPhoto.id, {
      isCustomerVisible: false,
      sharedBy: undefined,
      sharedAt: undefined,
    });
    setReviewPhoto(null);
  }

  function handleSaveCustomerDesc() {
    if (!reviewPhoto) return;
    updatePhoto(reviewPhoto.id, { customerDescription: customerDesc });
    Keyboard.dismiss();
    setEditingCustomerDesc(false);
  }

  function handleDeletePhoto() {
    if (!reviewPhoto) return;
    const photoId = reviewPhoto.id;
    sharedConfirm('Delete Photo?', 'This permanently removes the photo and cannot be undone.', 'Delete', () => { deletePhoto(photoId); setReviewPhoto(null); }, true);
  }

  function formatPhotoDetailDateTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  function resolveTaskName(photo: ProjectPhoto): string | undefined {
    if (photo.taskTitle) return photo.taskTitle;
    if (photo.taskId) return tasks.find(t => t.id === photo.taskId)?.title;
    return undefined;
  }

  function formatPhotoDateTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }

  async function handleOpenAddPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      const msg = 'Photo library access is needed to add a photo.';
      showMessage('Permission Needed', msg);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets?.[0]) return;
    setNewPhotoUri(await keepPicked(result.assets[0].uri));
    setNewPhotoType('progress');
    setNewPhotoTaskId('');
    setNewPhotoCaption('');
    setNewPhotoShare(false);
    setShowAddPhoto(true);
  }

  function handleCreatePhoto() {
    if (!newPhotoUri) return;
    const task = tasks.find(t => t.id === newPhotoTaskId);
    addPhoto({
      taskId: newPhotoTaskId || undefined,
      uploadedBy: user?.id ?? '',
      fileUrl: newPhotoUri,
      caption: newPhotoCaption.trim() || undefined,
      isCustomerVisible: newPhotoShare,
      ...(newPhotoShare ? { customerDescription: newPhotoCaption.trim() || undefined, sharedBy: user?.id, sharedAt: new Date().toISOString() } : {}),
      photoType: newPhotoType,
      takenAt: new Date().toISOString(),
    });
    setShowAddPhoto(false);
    setNewPhotoUri(null);
  }

  function renderPhotoCard(photo: ProjectPhoto) {
    const taskName = resolveTaskName(photo);
    const typeColor = getPhotoTypeColor(photo.photoType, colors.primary);

    return (
      <Pressable
        key={photo.id}
        style={[styles.photoGridCard, { backgroundColor: colors.surface }, shadow.sm]}
        onPress={() => openPhotoReview(photo)}
      >
        <View style={styles.photoGridImageWrap}>
          <OptimizedImage source={photo.fileUrl} style={styles.photoGridImage} placeholder={photo.blurhash} />
          <View style={[styles.photoTypePill, { backgroundColor: typeColor }]}>
            <Text style={[typeScale.caption, { color: onColor(typeColor), fontWeight: '700' }]}>
              {PHOTO_TYPE_LABEL[photo.photoType] ?? photo.photoType}
            </Text>
          </View>
          <View style={[styles.photoVisibilityPill, { backgroundColor: photo.isCustomerVisible ? whiteAlpha(0.95) : blackAlpha(0.6) }]}>
            <Icon name={photo.isCustomerVisible ? 'eye' : 'lock'} size={10} color={photo.isCustomerVisible ? colors.primaryOnWhite : fixed.white} />
            <Text style={[typeScale.caption, { color: photo.isCustomerVisible ? colors.primaryOnWhite : fixed.white, marginLeft: 3, fontWeight: '700' }]}>
              {photo.isCustomerVisible ? 'Shared' : 'Internal'}
            </Text>
          </View>
        </View>
        <View style={styles.photoGridInfo}>
          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={2}>
            {taskName ?? photo.caption ?? w('Job photo')}
          </Text>
          <View style={styles.photoUploaderRow}>
            {photo.uploader && (
              <Avatar firstName={photo.uploader.firstName} lastName={photo.uploader.lastName} size={18} uri={photo.uploader.avatarUrl} />
            )}
            <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={1}>
              {photo.uploader ? `${photo.uploader.firstName} ${photo.uploader.lastName}` : 'Unknown'}
            </Text>
          </View>
          <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
            {formatPhotoDateTime(photo.takenAt)}
          </Text>
        </View>
      </Pressable>
    );
  }

  function renderPhotos() {
    const filterOptions: { key: 'all' | 'internal' | 'shared'; label: string; count: number; icon?: keyof typeof Feather.glyphMap }[] = [
      { key: 'all', label: 'All', count: photoStats.total },
      { key: 'internal', label: 'Internal', count: photoStats.unreviewed, icon: 'lock' },
      { key: 'shared', label: 'Shared', count: photoStats.shared, icon: 'eye' },
    ];

    const filteredPhotos = photos.filter(ph => {
      if (photoFilter === 'internal') return !ph.isCustomerVisible;
      if (photoFilter === 'shared') return ph.isCustomerVisible;
      return true;
    });

    const emptyText =
      photoFilter === 'internal' ? { title: 'No internal photos', description: 'Every photo has been shared with the customer.' }
      : photoFilter === 'shared' ? { title: 'No shared photos', description: 'No photos have been shared with the customer yet.' }
      : { title: 'No photos yet', description: w('No job photos yet.') };

    return (
      <View style={styles.sectionContent}>
        <View style={[styles.photoSummaryCard, { backgroundColor: colors.surface }, shadow.sm]}>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>
              {photoStats.total} Photo{photoStats.total === 1 ? '' : 's'}
            </Text>
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
              {photoStats.shared} Shared · {photoStats.unreviewed} Internal
            </Text>
          </View>
          <Pressable style={[styles.addPhotoBtn, { backgroundColor: colors.primary }]} onPress={handleOpenAddPhoto}>
            <Icon name="plus" size={16} color={colors.textOnPrimary} />
            <Text style={[typeScale.labelLarge, { color: colors.textOnPrimary }]}>Add Photo</Text>
          </Pressable>
        </View>

        <View style={styles.photoFilterRow}>
          {filterOptions.map(opt => {
            const isActive = photoFilter === opt.key;
            return (
              <Pressable
                key={opt.key}
                style={[styles.photoFilterPill, { backgroundColor: isActive ? colors.primary : colors.backgroundTertiary }]}
                onPress={() => setPhotoFilter(opt.key)}
              >
                {opt.icon && <Icon name={opt.icon} size={12} color={isActive ? colors.textOnPrimary : colors.textSecondary} />}
                <Text style={[typeScale.labelSmall, { color: isActive ? colors.textOnPrimary : colors.textSecondary, fontWeight: '600', marginLeft: opt.icon ? 4 : 0 }]}>
                  {opt.label} ({opt.count})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filteredPhotos.length === 0 ? (
          <EmptyState icon="camera" title={emptyText.title} description={emptyText.description} />
        ) : (
          <View style={styles.photoGridTwoCol}>
            {filteredPhotos.map(renderPhotoCard)}
          </View>
        )}
      </View>
    );
  }

  function handlePostUpdate() {
    if (!updateTitle.trim()) return;
    Keyboard.dismiss();
    postUpdate({ title: updateTitle.trim(), body: updateBody.trim(), isCustomerVisible: updateVisible });
    setUpdateTitle('');
    setUpdateBody('');
    setUpdateVisible(true);
    setShowComposer(false);
  }

  function renderUpdates() {
    return (
      <View style={styles.sectionContent}>
        {showComposer ? (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.md }]}>
              New Update
            </Text>
            <TextInput
              style={[styles.composerInput, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary }]}
              value={updateTitle}
              onChangeText={setUpdateTitle}
              placeholder="Update title"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={[styles.composerInput, styles.composerBody, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary }]}
              value={updateBody}
              onChangeText={setUpdateBody}
              placeholder={w("What's the latest on this job?")}
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={4}
            />
            <Pressable
              style={styles.visibilityToggle}
              onPress={() => setUpdateVisible(!updateVisible)}
            >
              <Icon name={updateVisible ? 'eye' : 'eye-off'} size={16} color={updateVisible ? colors.primaryOnWhite : colors.textTertiary} />
              <Text style={[typeScale.bodySmall, { color: updateVisible ? colors.primaryOnWhite : colors.textSecondary, marginLeft: spacing.sm }]}>
                {updateVisible ? 'Visible to customer' : 'Internal only'}
              </Text>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button title="Cancel" onPress={() => setShowComposer(false)} variant="secondary" style={{ flex: 1 }} />
              <Button title="Post Update" onPress={handlePostUpdate} variant="primary" icon="send" style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <Button
            title="New Update"
            onPress={() => setShowComposer(true)}
            variant="primary"
            icon="plus"
            fullWidth
            style={{ marginBottom: spacing.lg }}
          />
        )}

        {updates.length === 0 ? (
          <EmptyState icon="send" title="No updates yet" description="Updates posted to the customer will appear here." />
        ) : (
          updates.map((update) => (
            <Card key={update.id} style={{ marginBottom: spacing.md }}>
              <View style={styles.updateHeader}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>{update.title}</Text>
                {update.isCustomerVisible ? (
                  <View style={[styles.visibleBadge, { backgroundColor: colors.primarySurface }]}>
                    <Icon name="eye" size={11} color={colors.primaryOnWhite} />
                    <Text style={[typeScale.caption, { color: colors.primaryOnWhite }]}>Visible</Text>
                  </View>
                ) : (
                  <View style={[styles.visibleBadge, { backgroundColor: colors.backgroundTertiary }]}>
                    <Icon name="eye-off" size={11} color={colors.textTertiary} />
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Internal</Text>
                  </View>
                )}
              </View>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                {update.body}
              </Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.md }]}>
                {update.author ? `${update.author.firstName} ${update.author.lastName}` : 'Unknown'} · {formatDateTime(update.createdAt)}
              </Text>
            </Card>
          ))
        )}
      </View>
    );
  }

  function handleRequestAction(reqId: string, action: 'acknowledged' | 'declined' | 'converted') {
    const req = requests.find(r => r.id === reqId);
    if (!req) return;
    // "Convert to task" adds the request to the project's task list.
    const task = action === 'converted'
      ? addTask({ title: req.title, description: req.description, status: 'pending', sortOrder: tasks.length })
      : undefined;
    respondToRequest(reqId, action, responseNote.trim() || undefined, task?.id);
    setRespondingTo(null);
    setResponseNote('');
  }

  function confirmAction(title: string, message: string, ok: string, onOk: () => void) {
    sharedConfirm(title, message, ok, onOk, true);
  }

  function handleDeleteRequest(reqId: string) {
    confirmAction('Delete this request?', 'It will be removed for you and the customer. This can\u2019t be undone.', 'Delete', () => deleteRequest(reqId));
  }

  function renderRequests() {
    const statusBadge = (status: string) => {
      switch (status) {
        case 'completed': return { label: 'Completed', status: 'success' as const };
        case 'declined': return { label: 'Declined', status: 'error' as const };
        case 'acknowledged': return { label: 'Acknowledged', status: 'info' as const };
        case 'converted': return { label: 'Converted', status: 'success' as const };
        default: return { label: 'Pending', status: 'warning' as const };
      }
    };

    const categoryLabel: Record<string, string> = {
      change_request: 'Change Request',
      question: 'Question',
      additional_work: 'Additional Work',
      other: 'Other',
    };

    const pendingRequests = requests.filter(r => r.status === 'pending');
    const otherRequests = requests.filter(r => r.status !== 'pending');

    return (
      <View style={styles.sectionContent}>
        {requests.length === 0 ? (
          <EmptyState icon="message-circle" title="No requests" description="Customer requests will appear here." />
        ) : (
          <>
            {pendingRequests.length > 0 && (
              <View style={{ marginBottom: spacing.lg }}>
                <Text style={[typeScale.labelSmall, { color: colors.warning, marginBottom: spacing.sm }]}>
                  {pendingRequests.length} pending review
                </Text>
                {pendingRequests.map((req) => {
                  const badge = statusBadge(req.status);
                  const isResponding = respondingTo === req.id;
                  return (
                    <Card key={req.id} style={{ marginBottom: spacing.md }}>
                      <View style={styles.updateHeader}>
                        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>{req.title}</Text>
                        <StatusBadge label={badge.label} status={badge.status} />
                      </View>
                      <View style={[styles.photoTypeBadge, { backgroundColor: colors.backgroundTertiary, alignSelf: 'flex-start', marginTop: spacing.xs }]}>
                        <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                          {categoryLabel[req.category] ?? req.category}
                        </Text>
                      </View>
                      {req.description && (
                        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                          {req.description}
                        </Text>
                      )}
                      <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.md }]}>
                        {req.requester ? `${req.requester.firstName} ${req.requester.lastName}` : 'Customer'} · {formatDateTime(req.createdAt)}
                      </Text>

                      {isResponding ? (
                        <View style={{ marginTop: spacing.md }}>
                          <TextInput
                            style={[styles.composerInput, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary }]}
                            value={responseNote}
                            onChangeText={setResponseNote}
                            placeholder="Add a response note (optional)"
                            placeholderTextColor={colors.textTertiary}
                            multiline
                          />
                          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                            <Button title="Acknowledge" onPress={() => handleRequestAction(req.id, 'acknowledged')} variant="primary" size="sm" icon="check" style={{ flex: 1 }} />
                            <Button title="Decline" onPress={() => handleRequestAction(req.id, 'declined')} variant="secondary" size="sm" icon="x" style={{ flex: 1 }} />
                          </View>
                          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                            <Button title="Convert to Task" onPress={() => handleRequestAction(req.id, 'converted')} variant="secondary" size="sm" icon="plus-square" style={{ flex: 1 }} />
                            <Button title="Cancel" onPress={() => { setRespondingTo(null); setResponseNote(''); }} variant="secondary" size="sm" style={{ flex: 1 }} />
                          </View>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md }}>
                          <Button
                            title="Respond"
                            onPress={() => { setRespondingTo(req.id); setResponseNote(''); }}
                            variant="secondary"
                            size="sm"
                            icon="message-square"
                            style={{ flex: 1 }}
                          />
                          <Button title="Delete" onPress={() => handleDeleteRequest(req.id)} variant="ghost" size="sm" icon="trash-2" />
                        </View>
                      )}
                    </Card>
                  );
                })}
              </View>
            )}

            {otherRequests.map((req) => {
              const badge = statusBadge(req.status);
              return (
                <Card key={req.id} style={{ marginBottom: spacing.md }}>
                  <View style={styles.updateHeader}>
                    <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>{req.title}</Text>
                    <StatusBadge label={badge.label} status={badge.status} />
                  </View>
                  <View style={[styles.photoTypeBadge, { backgroundColor: colors.backgroundTertiary, alignSelf: 'flex-start', marginTop: spacing.xs }]}>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                      {categoryLabel[req.category] ?? req.category}
                    </Text>
                  </View>
                  {req.description && (
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                      {req.description}
                    </Text>
                  )}
                  {req.responseNote && (
                    <View style={[styles.responseBox, { backgroundColor: colors.primarySurface }]}>
                      <Text style={[typeScale.caption, { color: colors.primaryOnWhite, fontWeight: '600' }]}>Response</Text>
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginTop: spacing.xs }]}>
                        {req.responseNote}
                      </Text>
                    </View>
                  )}
                  {req.linkedTaskId && (
                    <View style={[styles.reviewMetaRow, { marginTop: spacing.sm }]}>
                      <Icon name="link" size={12} color={colors.primaryOnWhite} />
                      <Text style={[typeScale.caption, { color: colors.primaryOnWhite, marginLeft: spacing.xs }]}>
                        Linked to task
                      </Text>
                    </View>
                  )}
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.md }]}>
                    {req.requester ? `${req.requester.firstName} ${req.requester.lastName}` : 'Customer'} · {formatDateTime(req.createdAt)}
                  </Text>

                  {editingResponseFor === req.id ? (
                    <View style={{ marginTop: spacing.md }}>
                      <TextInput
                        style={[styles.composerInput, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary }]}
                        value={responseDraft}
                        onChangeText={setResponseDraft}
                        placeholder="Response to the customer"
                        placeholderTextColor={colors.textTertiary}
                        multiline
                        autoFocus
                      />
                      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                        <Button title="Save" onPress={() => { Keyboard.dismiss(); editRequestResponse(req.id, responseDraft); setEditingResponseFor(null); }} size="sm" icon="check" style={{ flex: 1 }} />
                        <Button title="Cancel" onPress={() => setEditingResponseFor(null)} variant="secondary" size="sm" style={{ flex: 1 }} />
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md, flexWrap: 'wrap' }}>
                      <Button
                        title={req.responseNote ? 'Edit Response' : 'Add Response'}
                        onPress={() => { setEditingResponseFor(req.id); setResponseDraft(req.responseNote ?? ''); }}
                        variant="secondary"
                        size="sm"
                        icon="edit-2"
                      />
                      {req.status !== 'completed' && (
                        <Button title="Mark Done" onPress={() => respondToRequest(req.id, 'completed', req.responseNote)} variant="secondary" size="sm" icon="check-circle" />
                      )}
                      <Button title="Reopen" onPress={() => reopenRequest(req.id)} variant="secondary" size="sm" icon="rotate-ccw" />
                      <Button title="Delete" onPress={() => handleDeleteRequest(req.id)} variant="ghost" size="sm" icon="trash-2" />
                    </View>
                  )}
                </Card>
              );
            })}
          </>
        )}
      </View>
    );
  }

  function formatActivityDayLabel(dateKey: string): { label: string; fullDate: string } {
    const diff = Math.round((new Date(today + 'T12:00:00').getTime() - new Date(dateKey + 'T12:00:00').getTime()) / 86400000);
    const fullDate = new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    if (diff === 0) return { label: 'Today', fullDate };
    if (diff === 1) return { label: 'Yesterday', fullDate };
    return { label: new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), fullDate };
  }

  function formatActivityTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function renderActivity() {
    const groups: { dateKey: string; entries: typeof history }[] = [];
    const groupIndex = new Map<string, number>();
    for (const entry of history) {
      const dateKey = isoToLocalDateKey(entry.createdAt);
      if (!groupIndex.has(dateKey)) {
        groupIndex.set(dateKey, groups.length);
        groups.push({ dateKey, entries: [] });
      }
      groups[groupIndex.get(dateKey)!].entries.push(entry);
    }

    const isExpanded = (dateKey: string) => activityExpanded[dateKey] ?? dateKey === today;
    const allExpanded = groups.length > 0 && groups.every(g => isExpanded(g.dateKey));

    function toggleDay(dateKey: string) {
      haptics.select();
      setActivityExpanded(prev => ({ ...prev, [dateKey]: !isExpanded(dateKey) }));
    }

    function setAll(value: boolean) {
      haptics.select();
      const next: Record<string, boolean> = {};
      groups.forEach(g => { next[g.dateKey] = value; });
      setActivityExpanded(prev => ({ ...prev, ...next }));
    }

    return (
      <View style={styles.sectionContent}>
        <View style={[styles.moreSummaryCard, { backgroundColor: colors.surface }, shadow.sm]}>
          <BrandCover uri={getProjectImageUri(p)} style={styles.moreSummaryImage} variant="tile" />
          <View style={{ marginLeft: spacing.md, flex: 1 }}>
            <StatusBadge label={config.label} status={config.type} style={{ alignSelf: 'flex-start' }} />
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginTop: spacing.xs }]} numberOfLines={1}>
              {p.name}
            </Text>
            {p.address && (
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
                {p.address}{p.city ? `, ${p.city}` : ''}
              </Text>
            )}
          </View>
        </View>

        {activityClearedNote ? (
          <Text style={[typeScale.bodySmall, { color: semantic.success, marginBottom: spacing.sm }]}>{activityClearedNote}</Text>
        ) : null}
        <ClearLogSheet
          visible={clearingActivity}
          onClose={() => setClearingActivity(false)}
          title={w("Clear this job's activity")}
          what="activity"
          modes={['delete']}
          years={[]}
          preview={(range) => previewProjectClear(p.id, range)}
          run={(range) => runProjectClear(p.id, range)}
          onDone={(msg) => { setActivityClearedNote(msg); refreshStore('project_history'); }}
        />
        {history.length === 0 ? (
          <EmptyState icon="activity" title="No activity" description={w('Job history will appear here as things happen.')} />
        ) : (
          <>
            <View style={styles.activityToolbarRow}>
              <Pressable
                style={[styles.expandAllBtn, { backgroundColor: colors.backgroundTertiary }]}
                onPress={() => setAll(!allExpanded)}
              >
                <Icon name={allExpanded ? 'minimize-2' : 'maximize-2'} size={13} color={colors.textSecondary} />
                <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginLeft: spacing.xs, fontWeight: '600' }]}>
                  {allExpanded ? 'Collapse All' : 'Expand All'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.expandAllBtn, { backgroundColor: colors.backgroundTertiary, marginLeft: spacing.sm }]}
                onPress={() => { setActivityClearedNote(null); setClearingActivity(true); }}
                accessibilityRole="button"
                accessibilityLabel={w("Clear this job's activity")}
              >
                <Icon name="trash-2" size={13} color={colors.textSecondary} />
                <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginLeft: spacing.xs, fontWeight: '600' }]}>Clear</Text>
              </Pressable>
            </View>

            {groups.map((group) => {
              const expanded = isExpanded(group.dateKey);
              const { label, fullDate } = formatActivityDayLabel(group.dateKey);
              const dotColor = label === 'Today' ? semantic.success : label === 'Yesterday' ? semantic.warning : colors.textTertiary;

              return (
                <View key={group.dateKey} style={[styles.activityDayCard, { backgroundColor: colors.surface }, shadow.sm]}>
                  <Pressable style={styles.activityDayHeader} onPress={() => toggleDay(group.dateKey)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.sm }}>
                      <View style={[styles.activityDayDot, { backgroundColor: dotColor }]} />
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>{label}</Text>
                      <Text style={[typeScale.caption, { color: colors.textTertiary, marginLeft: spacing.sm }]} numberOfLines={1}>
                        {group.entries.length} {group.entries.length === 1 ? 'activity' : 'activities'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
                      <Text style={[typeScale.caption, { color: colors.textTertiary, marginRight: spacing.sm }]} numberOfLines={1}>
                        {fullDate}
                      </Text>
                      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
                    </View>
                  </Pressable>

                  {expanded && (
                    <View style={[styles.timeline, { paddingHorizontal: spacing.md, paddingBottom: spacing.sm }]}>
                      {group.entries.map((entry, i) => {
                        const iconColors = historyIconColors[entry.eventType] ?? { bg: colors.backgroundTertiary, fg: colors.textTertiary };
                        const linkedPhoto = entry.eventType === 'photo_added' && entry.metadata?.photoId
                          ? photos.find(ph => ph.id === entry.metadata!.photoId)
                          : undefined;
                        return (
                          <View key={entry.id} style={styles.timelineItem}>
                            <Text style={[typeScale.caption, { color: colors.textTertiary, width: 58, marginTop: 4 }]}>
                              {formatActivityTime(entry.createdAt)}
                            </Text>
                            <View style={styles.timelineIconCol}>
                              <View style={[styles.timelineIcon, { backgroundColor: iconColors.bg }]}>
                                <Icon name={historyIcons[entry.eventType] ?? 'activity'} size={14} color={iconColors.fg} />
                              </View>
                              {i < group.entries.length - 1 && <View style={[styles.timelineLine, { backgroundColor: colors.borderLight }]} />}
                            </View>
                            <View style={styles.timelineContent}>
                              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>{entry.description}</Text>
                              <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
                                {entry.actor ? `By ${entry.actor.firstName} ${entry.actor.lastName}` : 'By System'}
                              </Text>
                            </View>
                            {linkedPhoto && (
                              <Pressable onPress={() => openPhotoReview(linkedPhoto)} accessibilityRole="button" accessibilityLabel="View photo">
                                <OptimizedImage source={linkedPhoto.fileUrl} style={styles.activityThumb} />
                              </Pressable>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}

        <View style={[styles.aboutTeamCard, { backgroundColor: colors.backgroundTertiary }]}>
          <Icon name="info" size={16} color={colors.primaryOnWhite} />
          <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.sm, flex: 1 }]}>
            {w('This shows the complete history of activity on this job, including updates, task completions, team changes, and more.')}
          </Text>
        </View>
      </View>
    );
  }

  /** Asks first on every platform (these actions cut a customer off). */
  function confirmThen(title: string, message: string, action: string, run: () => void) {
    sharedConfirm(title, message, action, run, true);
  }

  function handleRevokeAccess() {
    confirmThen(
      'Remove customer access?',
      w('The customer will no longer be able to view this job. To give them access again, send a new invite link from their customer page.'),
      'Remove Access',
      async () => {
        await customerAccess.revokeAccess(p.id);
        setAccessVersion((v) => v + 1);
      },
    );
  }

  /** One tap opens the sheet once (extra taps while it is opening are ignored). */
  function openRadiusPicker() {
    setShowRadiusPicker((open) => (open ? open : true));
  }

  function handleSetRadius(meters: number, coords: { latitude: number; longitude: number } | null) {
    // This project's own setting. When the project has no saved map spot yet, save the one the sheet just resolved, so the worker's
    // check-in (and the database) measure from exactly the spot the owner saw on the map.
    updateSettings({ checkinRadiusMeters: meters });
    if (coords && (p.latitude == null || p.longitude == null)) updateProject({ latitude: coords.latitude, longitude: coords.longitude });
    setShowRadiusPicker(false);
  }

  function renderSettings() {
    if (!settings) {
      return (
        <View style={styles.sectionContent}>
          <EmptyState icon="settings" title="No settings" description={w('Default settings are in use for this job.')} />
        </View>
      );
    }

    const access = customerAccess.getAccessForProject(p.id);

    return (
      <View style={styles.sectionContent}>
        {/* Customer Access */}
        {p.customer && (
          <View style={[styles.settingsCardBlock, { backgroundColor: colors.surface }, shadow.sm]}>
            <View style={styles.settingsCardHeader}>
              <View style={[styles.settingsCardIcon, { backgroundColor: tones.neutral.bg }]}>
                <Icon name="user" size={16} color={tones.strong.fg} />
              </View>
              <View style={{ marginLeft: spacing.sm, flex: 1 }}>
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Customer Login</Text>
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{w('Send {name} a private link to see this job.', { name: p.customer.firstName })}</Text>
              </View>
            </View>
            <Divider style={{ marginBottom: spacing.sm }} />
            <CustomerInviteCard personId={p.customer.id} firstName={p.customer.firstName} phone={p.customer.phone} />
            {access?.claimedBy && (
              <Pressable
                onPress={handleRevokeAccess}
                style={[styles.revokeRow, { backgroundColor: semantic.errorLight, marginTop: spacing.md }]}
              >
                <Icon name="user-x" size={15} color={semantic.error} />
                <Text style={[typeScale.labelLarge, { color: semantic.error, fontWeight: '700', marginLeft: spacing.xs }]}>
                  Revoke Access
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Customer Interaction */}
        <View style={[styles.settingsCardBlock, { backgroundColor: colors.surface }, shadow.sm]}>
          <View style={styles.settingsCardHeader}>
            <View style={[styles.settingsCardIcon, { backgroundColor: tones.neutral.bg }]}>
              <Icon name="message-circle" size={16} color={tones.strong.fg} />
            </View>
            <View style={{ marginLeft: spacing.sm, flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Customer Interaction</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{w('Control what your customer can do in the job portal.')}</Text>
            </View>
          </View>
          <Divider style={{ marginBottom: spacing.xs }} />

          <View style={styles.settingsDetailRow}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Customer interaction enabled</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{w('Allow customer to view the job portal.')}</Text>
            </View>
            <Switch
              value={settings.customerInteractionEnabled}
              onValueChange={(v) => updateSettings({ customerInteractionEnabled: v })}
            />
          </View>
          <Divider style={{ marginVertical: spacing.xs }} />

          <View style={styles.settingsDetailRow}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Customer can submit requests</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>Allow customer to send requests through the portal.</Text>
            </View>
            <Switch
              value={settings.customerCanRequest}
              onValueChange={(v) => updateSettings({ customerCanRequest: v })}
            />
          </View>
          <Divider style={{ marginVertical: spacing.xs }} />

          <View style={styles.settingsDetailRow}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Customer can view photos</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{w('Allow customer to view job photos.')}</Text>
            </View>
            <Switch
              value={settings.customerCanViewPhotos}
              onValueChange={(v) => updateSettings({ customerCanViewPhotos: v })}
            />
          </View>
        </View>

        {/* Work Requirements */}
        <View style={[styles.settingsCardBlock, { backgroundColor: colors.surface }, shadow.sm]}>
          <View style={styles.settingsCardHeader}>
            <View style={[styles.settingsCardIcon, { backgroundColor: tones.neutral.bg }]}>
              <Icon name="tool" size={16} color={tones.strong.fg} />
            </View>
            <View style={{ marginLeft: spacing.sm, flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Work Requirements</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{w('Set requirements for workers on this job.')}</Text>
            </View>
          </View>
          <Divider style={{ marginBottom: spacing.xs }} />

          <View style={styles.settingsDetailRow}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Completion photo required</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>Workers must upload a photo to complete tasks.</Text>
            </View>
            <Switch
              value={settings.completionPhotoRequired}
              onValueChange={(v) => updateSettings({ completionPhotoRequired: v })}
            />
          </View>

          <Divider style={{ marginVertical: spacing.xs }} />
          <View style={styles.settingsDetailRow}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Only the Task Lead checks off tasks</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{w('Off: anyone on the job can. On: only the Task Lead you pick below. Applies to every job.')}</Text>
            </View>
            <Switch
              value={db.company?.taskLeadOnly === true}
              onValueChange={(v) => { if (db.company) updateRow('companies', db.company.id, { taskLeadOnly: v }); }}
              accessibilityLabel="Only the Task Lead checks off tasks"
            />
          </View>

          {(
            <>
              <Divider style={{ marginVertical: spacing.xs }} />
              <Pressable style={styles.settingsDetailRow} onPress={openRadiusPicker}>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Check-in distance</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>Workers can only tap I'm here within this distance of the address.</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginRight: spacing.xs }]}>
                    {(settings.checkinRadiusMeters ?? DEFAULT_CHECKIN_RADIUS_M) <= 0 ? 'Anywhere' : formatDistance(settings.checkinRadiusMeters ?? DEFAULT_CHECKIN_RADIUS_M)}
                  </Text>
                  <Icon name="chevron-right" size={16} color={colors.textTertiary} />
                </View>
              </Pressable>
            </>
          )}
        </View>

        <CheckInRadiusSheet
          visible={showRadiusPicker}
          place={p}
          radiusMeters={settings.checkinRadiusMeters ?? DEFAULT_CHECKIN_RADIUS_M}
          onClose={() => setShowRadiusPicker(false)}
          onSave={handleSetRadius}
        />
      </View>
    );
  }

  const sectionRenderers: Record<string, () => React.ReactNode> = {
    overview: renderOverview,
    schedule: renderSchedule,
    tasks: renderTasks,
    photos: renderPhotos,
    customer: renderCustomerTab,
    more: renderMore,
  };

  const isMoreDrilldown = activeSection === 'more' && moreSubSection != null;
  const isCustomerDrilldown = activeSection === 'customer' && customerDrilldown;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerTop}>
          <Pressable
            onPress={backStep.leave}
            style={styles.backButton}
            accessibilityLabel={w('Back to jobs')}
          >
            <Icon name="arrow-left" size={24} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerTitle}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} numberOfLines={1}>
              {p.name}
            </Text>
          </View>
          <Pressable
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="More options"
            onPress={() => setShowMoreMenu(true)}
          >
            <Icon name="more-horizontal" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {isMoreDrilldown ? (
        <Pressable
          style={[styles.moreSectionBar, { borderBottomColor: colors.borderLight }]}
          onPress={() => setMoreSubSection(null)}
          accessibilityRole="button"
          accessibilityLabel="Back to More"
        >
          <Icon name="chevron-left" size={20} color={colors.primaryOnWhite} />
          <Text style={[typeScale.labelLarge, { color: colors.primaryOnWhite, marginLeft: spacing.xs }]}>
            {MORE_ITEMS.find(s => s.key === moreSubSection)?.label ?? 'More'}
          </Text>
        </Pressable>
      ) : isCustomerDrilldown ? (
        <Pressable
          style={[styles.moreSectionBar, { borderBottomColor: colors.borderLight }]}
          onPress={() => setCustomerDrilldown(false)}
          accessibilityRole="button"
          accessibilityLabel="Back to Customer"
        >
          <Icon name="chevron-left" size={20} color={colors.primaryOnWhite} />
          <Text style={[typeScale.labelLarge, { color: colors.primaryOnWhite, marginLeft: spacing.xs }]}>
            Updates &amp; Requests
          </Text>
        </Pressable>
      ) : (
        <SectionTabs
          tabs={SECTIONS}
          activeTab={activeSection}
          onTabChange={(key) => { setActiveSection(key); if (key === 'more') setMoreSubSection(null); if (key === 'customer') setCustomerDrilldown(false); }}
        />
      )}

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance }]}
        showsVerticalScrollIndicator={false}
      >
        {sectionRenderers[activeSection]?.()}
      </KeyboardAwareScrollView>

      {/* More Menu */}
      <Modal visible={showMoreMenu} animationType="fade" transparent onRequestClose={() => setShowMoreMenu(false)}>
        <Pressable style={styles.moreMenuOverlay} onPress={() => setShowMoreMenu(false)}>
          <View style={[styles.moreMenuCard, { backgroundColor: colors.surface, top: insets.top + 56 }]}>
            <Pressable
              style={[styles.moreMenuRow, { borderBottomColor: colors.borderLight }]}
              onPress={() => { setShowMoreMenu(false); router.push({ pathname: '/(owner)/project-new', params: { editId: p.id } } as any); }}
            >
              <Icon name="edit-2" size={18} color={colors.textSecondary} />
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.md }]}>
                {w('Edit Job')}
              </Text>
            </Pressable>
            {(canComplete || p.status === 'completed') && (
              <Pressable
                style={[styles.moreMenuRow, { borderBottomColor: colors.borderLight }]}
                onPress={() => { setShowMoreMenu(false); if (canComplete) handleCompleteProject(); else handleReopenProject(); }}
              >
                <Icon name={canComplete ? 'check-circle' : 'rotate-ccw'} size={18} color={colors.textSecondary} />
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.md }]}>
                  {w(canComplete ? 'Complete Job' : 'Reopen Job')}
                </Text>
              </Pressable>
            )}
            {MORE_ITEMS.map((item) => (
              <Pressable
                key={item.key}
                style={[styles.moreMenuRow, { borderBottomColor: colors.borderLight }]}
                onPress={() => { setActiveSection('more'); setMoreSubSection(item.key as MoreSubSection); setShowMoreMenu(false); }}
              >
                <Icon name={item.icon} size={18} color={colors.textSecondary} />
                <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginLeft: spacing.md }]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Task Detail Modal */}
      <BottomSheetModal visible={!!selectedTask} onRequestClose={() => setSelectedTask(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Task</Text>
              <Pressable onPress={() => setSelectedTask(null)} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            {selectedTask && (
              <ScrollView bounces={false} style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>Title</Text>
                <TextInput
                  style={[styles.composerInput, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary, marginTop: spacing.xs }]}
                  value={taskTitleDraft}
                  onChangeText={setTaskTitleDraft}
                  onBlur={handleSaveTaskDetails}
                  placeholder="Task title"
                  placeholderTextColor={colors.textTertiary}
                />

                <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.md }]}>Description</Text>
                <TextInput
                  style={[styles.composerInput, styles.composerBody, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary, marginTop: spacing.xs }]}
                  value={taskDescDraft}
                  onChangeText={setTaskDescDraft}
                  onBlur={handleSaveTaskDetails}
                  placeholder="Add a description (optional)"
                  placeholderTextColor={colors.textTertiary}
                  multiline
                />

                <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.md }]}>Photos and videos</Text>
                {(() => {
                  const items: TaskMediaItem[] = (db.taskAttachments[selectedTask.id] ?? []).map(a => ({ key: a.id, uri: a.fileUrl, mediaType: a.mediaType }));
                  return (
                    <TaskMediaStrip
                      items={items}
                      onOpen={(index) => setTaskMediaViewer({ items, index })}
                      onAdd={() => handleAddTaskMedia(selectedTask)}
                      onRemove={(key) => handleRemoveTaskMedia(selectedTask.id, key)}
                    />
                  );
                })()}

                <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>Status</Text>
                <View style={styles.taskStatusPickerRow}>
                  {(['pending', 'in_progress', 'completed'] as TaskStatus[]).map(s => (
                    <Pressable
                      key={s}
                      style={[
                        styles.taskStatusOption,
                        { backgroundColor: selectedTask.status === s ? colors.primary : colors.backgroundTertiary },
                      ]}
                      onPress={() => handleChangeTaskStatus(s)}
                    >
                      <Text style={[typeScale.labelSmall, { color: selectedTask.status === s ? colors.textOnPrimary : colors.textSecondary }]}>
                        {taskStatusConfig[s].label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>Assigned To</Text>
                <Pressable
                  style={[styles.selector, { backgroundColor: colors.surface, marginTop: spacing.xs }, shadow.sm]}
                  onPress={() => setShowAssigneePicker(v => !v)}
                >
                  {selectedTask.assignee ? (
                    <View style={styles.selectedRow}>
                      <Avatar firstName={selectedTask.assignee.firstName} lastName={selectedTask.assignee.lastName} size={24} uri={selectedTask.assignee.avatarUrl} />
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                        {selectedTask.assignee.firstName} {selectedTask.assignee.lastName}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>Unassigned</Text>
                  )}
                  <Icon name={showAssigneePicker ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
                </Pressable>
                {showAssigneePicker && (
                  <View style={[styles.pickerList, { backgroundColor: colors.surface }, shadow.sm]}>
                    <Pressable style={styles.pickerItem} onPress={() => handleAssignTask('')}>
                      <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>Unassigned</Text>
                    </Pressable>
                    {team.map(member => (
                      <Pressable
                        key={member.personId}
                        style={[styles.pickerItem, member.personId === selectedTask.assignedTo && { backgroundColor: colors.primarySurface }]}
                        onPress={() => handleAssignTask(member.personId)}
                      >
                        <View style={styles.selectedRow}>
                          <Avatar firstName={member.person!.firstName} lastName={member.person!.lastName} size={24} uri={member.person!.avatarUrl} />
                          <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                            {member.person!.firstName} {member.person!.lastName}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}

                {(() => {
                  const live = tasks.find(t => t.id === selectedTask.id) ?? selectedTask;
                  if (live.status !== 'completed' || (!live.completer && !live.completedAt)) return null;
                  return (
                    <View style={[styles.taskPhotoNote, { backgroundColor: colors.backgroundTertiary }]}>
                      <Icon name="check-circle" size={14} color={semantic.success} />
                      <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, flex: 1 }]}>
                        {completedLabel(live)}
                      </Text>
                    </View>
                  );
                })()}

                {settings?.completionPhotoRequired && (
                  <View style={[styles.taskPhotoNote, { backgroundColor: colors.backgroundTertiary }]}>
                    <Icon name="camera" size={14} color={colors.textSecondary} />
                    <Text style={[typeScale.caption, { color: colors.textSecondary, marginLeft: spacing.xs, flex: 1 }]}>
                      {w('This job requires a completion photo before a task can be marked done.')}
                    </Text>
                  </View>
                )}

                {(() => {
                  const taskPhoto = photos.find(ph => ph.taskId === selectedTask.id);
                  if (!taskPhoto) return null;
                  return (
                    <Pressable
                      style={styles.taskPhotoPreviewRow}
                      onPress={() => { setSelectedTask(null); openPhotoReview(taskPhoto); }}
                    >
                      <OptimizedImage source={taskPhoto.fileUrl} style={styles.taskPhotoThumb} placeholder={taskPhoto.blurhash} />
                      <View style={{ flex: 1 }}>
                        <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>Completion photo</Text>
                        <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Tap to view</Text>
                      </View>
                      <Icon name="chevron-right" size={16} color={colors.textTertiary} />
                    </Pressable>
                  );
                })()}
              </ScrollView>
            )}
            <TaskMediaViewer
              items={taskMediaViewer?.items ?? []}
              index={taskMediaViewer?.index ?? null}
              onIndexChange={(index) => setTaskMediaViewer(v => (v ? { ...v, index } : v))}
              onClose={() => setTaskMediaViewer(null)}
            />
          </View>
        </View>
      </BottomSheetModal>

      {/* Add Task Modal */}
      <BottomSheetModal visible={showAddTask} onRequestClose={() => setShowAddTask(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>New Task</Text>
              <Pressable onPress={() => setShowAddTask(false)} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView bounces={false} style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>Title</Text>
              <TextInput
                style={[styles.composerInput, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary, marginTop: spacing.xs }]}
                value={newTaskTitle}
                onChangeText={setNewTaskTitle}
                placeholder="e.g. Saw-cut the old slab along the fence line"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.md }]}>Description (optional)</Text>
              <TextInput
                style={[styles.composerInput, styles.composerBody, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary, marginTop: spacing.xs }]}
                value={newTaskDescription}
                onChangeText={setNewTaskDescription}
                placeholder="Add details for whoever picks this up..."
                placeholderTextColor={colors.textTertiary}
                multiline
              />

              <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.md }]}>Photos or videos (optional)</Text>
              <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                {w('Show the crew what to do. Videos can be up to a minute long.')}
              </Text>
              <TaskMediaStrip
                drafts
                items={newTaskMedia}
                onOpen={(index) => setTaskMediaViewer({ items: newTaskMedia, index })}
                onAdd={handleAddNewTaskMedia}
                onRemove={(key) => setNewTaskMedia(prev => prev.filter(m => m.key !== key))}
              />

              <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>Assign To (optional)</Text>
              <View style={[styles.pickerList, { backgroundColor: colors.surface, marginTop: spacing.xs }, shadow.sm]}>
                <Pressable
                  style={[styles.pickerItem, !newTaskAssignee && { backgroundColor: colors.primarySurface }]}
                  onPress={() => setNewTaskAssignee('')}
                >
                  <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>Unassigned</Text>
                </Pressable>
                {team.map(member => (
                  <Pressable
                    key={member.personId}
                    style={[styles.pickerItem, member.personId === newTaskAssignee && { backgroundColor: colors.primarySurface }]}
                    onPress={() => setNewTaskAssignee(member.personId)}
                  >
                    <View style={styles.selectedRow}>
                      <Avatar firstName={member.person!.firstName} lastName={member.person!.lastName} size={24} uri={member.person!.avatarUrl} />
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                        {member.person!.firstName} {member.person!.lastName}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>

              <View style={styles.actions}>
                <Button title="Create Task" onPress={handleAddTask} icon="plus" fullWidth />
                <Button title="Cancel" onPress={() => setShowAddTask(false)} variant="ghost" fullWidth />
              </View>
            </ScrollView>
            <TaskMediaViewer
              items={taskMediaViewer?.items ?? []}
              index={taskMediaViewer?.index ?? null}
              onIndexChange={(index) => setTaskMediaViewer(v => (v ? { ...v, index } : v))}
              onClose={() => setTaskMediaViewer(null)}
            />
          </View>
        </View>
      </BottomSheetModal>

      {/* Add Photo Modal */}
      <BottomSheetModal visible={showAddPhoto} onRequestClose={() => setShowAddPhoto(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Add Photo</Text>
              <Pressable onPress={() => setShowAddPhoto(false)} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView bounces={false} style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {newPhotoUri && (
                <OptimizedImage source={newPhotoUri} style={[styles.reviewImage, { marginTop: spacing.lg }]} />
              )}

              <View style={[styles.taskPhotoNote, { backgroundColor: newPhotoShare ? colors.primarySurface : colors.backgroundTertiary, marginTop: spacing.lg, alignItems: 'center' }]}>
                <Icon name={newPhotoShare ? 'eye' : 'lock'} size={16} color={newPhotoShare ? colors.primaryOnWhite : colors.textSecondary} />
                <View style={{ flex: 1, marginLeft: spacing.sm }}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '700' }]}>Share with the customer?</Text>
                  <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
                    {newPhotoShare ? 'The customer will see this photo in their portal.' : 'Off: only your team sees this photo.'}
                  </Text>
                </View>
                <Switch value={newPhotoShare} onValueChange={setNewPhotoShare} accessibilityLabel="Share this photo with the customer" />
              </View>

              <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>Description (optional)</Text>
              <TextInput
                style={[styles.composerInput, styles.composerBody, { backgroundColor: colors.surface, borderColor: colors.borderLight, color: colors.textPrimary, marginTop: spacing.xs }]}
                value={newPhotoCaption}
                onChangeText={setNewPhotoCaption}
                placeholder={newPhotoShare ? 'What does this photo show? The customer sees this.' : 'What does this photo show?'}
                placeholderTextColor={colors.textTertiary}
                multiline
              />

              <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>Photo Type</Text>
              <View style={styles.taskStatusPickerRow}>
                {(['before', 'progress', 'after', 'issue'] as PhotoType[]).map(t => (
                  <Pressable
                    key={t}
                    style={[styles.taskStatusOption, { backgroundColor: newPhotoType === t ? colors.primary : colors.backgroundTertiary }]}
                    onPress={() => setNewPhotoType(t)}
                  >
                    <Text style={[typeScale.labelSmall, { color: newPhotoType === t ? colors.textOnPrimary : colors.textSecondary }]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginTop: spacing.lg }]}>Related Task (optional)</Text>
              <Pressable
                style={[styles.selector, { backgroundColor: colors.surface, marginTop: spacing.xs }, shadow.sm]}
                onPress={() => setShowPhotoTaskPicker(v => !v)}
              >
                <Text style={[typeScale.bodySmall, { color: newPhotoTaskId ? colors.textPrimary : colors.textTertiary }]}>
                  {tasks.find(t => t.id === newPhotoTaskId)?.title ?? 'No related task'}
                </Text>
                <Icon name={showPhotoTaskPicker ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
              </Pressable>
              {showPhotoTaskPicker && (
                <View style={[styles.pickerList, { backgroundColor: colors.surface }, shadow.sm]}>
                  <Pressable style={styles.pickerItem} onPress={() => { setNewPhotoTaskId(''); setShowPhotoTaskPicker(false); }}>
                    <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>No related task</Text>
                  </Pressable>
                  {tasks.map(t => (
                    <Pressable
                      key={t.id}
                      style={[styles.pickerItem, t.id === newPhotoTaskId && { backgroundColor: colors.primarySurface }]}
                      onPress={() => { setNewPhotoTaskId(t.id); setShowPhotoTaskPicker(false); }}
                    >
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>{t.title}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <View style={styles.actions}>
                <Button title="Add Photo" onPress={handleCreatePhoto} icon="plus" fullWidth />
                <Button title="Cancel" onPress={() => setShowAddPhoto(false)} variant="ghost" fullWidth />
              </View>
            </ScrollView>
          </View>
        </View>
      </BottomSheetModal>

      {/* Photo Details Modal */}
      <BottomSheetModal visible={!!reviewPhoto} onRequestClose={() => setReviewPhoto(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={styles.dragHandleWrap}>
              <View style={[styles.dragHandle, { backgroundColor: colors.borderLight }]} />
            </View>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Photo Details</Text>
              <Pressable onPress={() => setReviewPhoto(null)} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            {reviewPhoto && (
              <ScrollView bounces={false} style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <Pressable style={styles.detailPhotoWrap} onPress={() => setShowPhotoViewer(true)}>
                  <OptimizedImage
                    source={reviewPhoto.fileUrl}
                    style={[styles.detailPhoto, { backgroundColor: colors.backgroundTertiary }]}
                    placeholder={reviewPhoto.blurhash}
                  />
                  {reviewPhoto.photoType && (
                    <View style={[styles.photoTypePill, { top: spacing.sm, left: spacing.sm, backgroundColor: getPhotoTypeColor(reviewPhoto.photoType, colors.primary) }]}>
                      <Text style={[typeScale.caption, { color: onColor(getPhotoTypeColor(reviewPhoto.photoType, colors.primary)), fontWeight: '700' }]}>
                        {PHOTO_TYPE_LABEL[reviewPhoto.photoType] ?? reviewPhoto.photoType}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.photoVisibilityPill, { top: spacing.sm, right: spacing.sm, backgroundColor: reviewPhoto.isCustomerVisible ? whiteAlpha(0.95) : blackAlpha(0.6) }]}>
                    <Icon name={reviewPhoto.isCustomerVisible ? 'eye' : 'lock'} size={10} color={reviewPhoto.isCustomerVisible ? colors.primaryOnWhite : fixed.white} />
                    <Text style={[typeScale.caption, { color: reviewPhoto.isCustomerVisible ? colors.primaryOnWhite : fixed.white, marginLeft: 3, fontWeight: '700' }]}>
                      {reviewPhoto.isCustomerVisible ? 'Shared' : 'Internal'}
                    </Text>
                  </View>
                  <View style={styles.expandIcon}>
                    <Icon name="maximize-2" size={14} color={fixed.white} />
                  </View>
                </Pressable>

                <View style={styles.detailMetaRow}>
                  <View style={styles.detailMetaCol}>
                    <View style={styles.reviewMetaRow}>
                      <Avatar
                        firstName={reviewPhoto.uploader?.firstName ?? '?'}
                        lastName={reviewPhoto.uploader?.lastName ?? ''}
                        size={22}
                        uri={reviewPhoto.uploader?.avatarUrl}
                      />
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginLeft: spacing.xs, fontWeight: '600' }]}>
                        {reviewPhoto.uploader ? `${reviewPhoto.uploader.firstName} ${reviewPhoto.uploader.lastName}` : 'Unknown'}
                      </Text>
                    </View>
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>
                      {formatPhotoDetailDateTime(reviewPhoto.takenAt)}
                    </Text>
                  </View>
                  {resolveTaskName(reviewPhoto) && (
                    <View style={styles.detailMetaColRight}>
                      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Task</Text>
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600', marginTop: 2 }]} numberOfLines={2}>
                        {resolveTaskName(reviewPhoto)}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={[styles.noteCard, { backgroundColor: colors.backgroundTertiary }]}>
                  <View style={styles.noteCardHeader}>
                    <Icon name="lock" size={12} color={colors.textTertiary} />
                    <Text style={[typeScale.labelSmall, { color: colors.textTertiary, marginLeft: spacing.xs }]}>
                      Worker Note (Internal only)
                    </Text>
                  </View>
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                    {reviewPhoto.caption ?? 'No note added'}
                  </Text>
                </View>

                <View style={[styles.descCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                  <View style={styles.descCardHeader}>
                    <Text style={[typeScale.labelSmall, { color: colors.textTertiary }]}>Customer Description</Text>
                    {!editingCustomerDesc && (
                      <Pressable
                        onPress={() => setEditingCustomerDesc(true)}
                        style={[styles.editPill, { backgroundColor: colors.backgroundTertiary }]}
                      >
                        <Text style={[typeScale.caption, { color: colors.textSecondary, fontWeight: '600' }]}>Edit</Text>
                      </Pressable>
                    )}
                  </View>

                  {editingCustomerDesc ? (
                    <>
                      <TextInput
                        style={[styles.descInput, {
                          backgroundColor: colors.background,
                          borderColor: colors.borderLight,
                          color: colors.textPrimary,
                        }]}
                        value={customerDesc}
                        onChangeText={setCustomerDesc}
                        placeholder="Add a description for the customer..."
                        placeholderTextColor={colors.textTertiary}
                        multiline
                        numberOfLines={3}
                        autoFocus
                      />
                      <View style={styles.descEditActions}>
                        <Pressable
                          onPress={() => { setCustomerDesc(reviewPhoto.customerDescription ?? ''); setEditingCustomerDesc(false); }}
                          style={styles.descEditBtn}
                        >
                          <Text style={[typeScale.labelSmall, { color: colors.textSecondary }]}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={reviewPhoto.isCustomerVisible ? handleSaveCustomerDesc : () => setEditingCustomerDesc(false)}
                          style={styles.descEditBtn}
                        >
                          <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite, fontWeight: '700' }]}>Save</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <View style={[styles.descBox, { borderColor: colors.borderLight }]}>
                      <Text style={[typeScale.bodySmall, { color: customerDesc ? colors.textPrimary : colors.textTertiary }]}>
                        {customerDesc || 'No customer description yet'}
                      </Text>
                    </View>
                  )}
                </View>

                {reviewPhoto.isCustomerVisible ? (
                  <View style={[styles.visibilityCard, { backgroundColor: colors.primarySurface }]}>
                    <View style={styles.visibilityCardTop}>
                      <Icon name="eye" size={16} color={colors.primaryOnWhite} />
                      <Text style={[typeScale.bodySmall, { color: colors.primaryOnWhite, marginLeft: spacing.xs, fontWeight: '700' }]}>
                        Shared with customer
                      </Text>
                    </View>
                    {reviewPhoto.sharedAt && (
                      <Text style={[typeScale.caption, { color: colors.primaryOnWhite, marginTop: 2 }]}>
                        {formatPhotoDetailDateTime(reviewPhoto.sharedAt)}
                      </Text>
                    )}
                    <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                      The customer can see this photo and its description in their portal.
                    </Text>
                    <Pressable onPress={handleUnsharePhoto} style={[styles.unshareBtn, { borderColor: colors.primary }]}>
                      <Text style={[typeScale.labelSmall, { color: colors.primaryOnWhite, fontWeight: '700' }]}>Unshare</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={[styles.visibilityCard, { backgroundColor: colors.backgroundTertiary }]}>
                    <View style={styles.visibilityCardTop}>
                      <Icon name="lock" size={16} color={colors.textSecondary} />
                      <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginLeft: spacing.xs, fontWeight: '700' }]}>
                        Internal
                      </Text>
                    </View>
                    <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                      Only your team can see this photo.
                    </Text>
                    <Button
                      title="Share with Customer"
                      onPress={handleSharePhoto}
                      variant="primary"
                      icon="eye"
                      fullWidth
                      style={{ marginTop: spacing.md }}
                    />
                  </View>
                )}

                <Pressable onPress={handleDeletePhoto} style={styles.deleteRow}>
                  <Icon name="trash-2" size={16} color={semantic.error} />
                  <Text style={[typeScale.bodySmall, { color: semantic.error, marginLeft: spacing.xs, fontWeight: '600' }]}>
                    Delete Photo
                  </Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </BottomSheetModal>

      {/* Photo Details full-screen viewer */}
      <Modal visible={showPhotoViewer && !!reviewPhoto} transparent animationType="fade" onRequestClose={() => setShowPhotoViewer(false)}>
        {reviewPhoto && (
          <PhotoViewer
            photos={photos.some((ph) => ph.id === reviewPhoto.id) ? photos : [reviewPhoto]}
            index={Math.max(0, photos.findIndex((ph) => ph.id === reviewPhoto.id))}
            onIndexChange={(i) => { if (photos[i]) openPhotoReview(photos[i]); }}
            onClose={() => setShowPhotoViewer(false)}
            insets={insets}
          />
        )}
      </Modal>

      {/* Manage Access Modal */}
      <BottomSheetModal visible={showManageAccess} onRequestClose={() => setShowManageAccess(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Manage Access</Text>
              <Pressable onPress={() => setShowManageAccess(false)} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            {p.customer && (() => {
              const access = customerAccess.getAccessForProject(p.id);
              return (
                <ScrollView bounces={false} style={styles.modalBody} showsVerticalScrollIndicator={false}>
                  <View style={styles.manageAccessRow}>
                    <Text style={[typeScale.labelSmall, { color: colors.textTertiary }]}>Customer</Text>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: 2 }]}>
                      {p.customer.firstName} {p.customer.lastName}
                    </Text>
                  </View>
                  <View style={styles.manageAccessRow}>
                    <Text style={[typeScale.labelSmall, { color: colors.textTertiary }]}>{w('Job')}</Text>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: 2 }]}>{p.name}</Text>
                  </View>
                  <View style={styles.manageAccessRow}>
                    <Text style={[typeScale.labelSmall, { color: colors.textTertiary }]}>Authorized Email</Text>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, marginTop: 2 }]}>
                      {access?.claimedByEmail ?? p.customer.email}
                    </Text>
                  </View>
                  <View style={styles.manageAccessRow}>
                    <Text style={[typeScale.labelSmall, { color: colors.textTertiary }]}>Status</Text>
                    <View style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
                      <StatusBadge label={access?.claimedBy || customerHasApp(p.customer.id) ? 'Connected' : 'Waiting'} status={access?.claimedBy || customerHasApp(p.customer.id) ? 'success' : 'neutral'} />
                    </View>
                  </View>

                  {access?.claimedBy ? (
                    <Pressable
                      onPress={() => { handleRevokeAccess(); setShowManageAccess(false); }}
                      style={[styles.dangerBtn, { backgroundColor: semantic.errorLight, marginTop: spacing.lg }]}
                    >
                      <Icon name="user-x" size={14} color={semantic.error} />
                      <Text style={[typeScale.labelSmall, { color: semantic.error, marginLeft: spacing.xs }]}>
                        {w('Remove Job Access')}
                      </Text>
                    </Pressable>
                  ) : (
                    <View style={{ marginTop: spacing.lg }}>
                      <CustomerInviteCard personId={p.customer.id} firstName={p.customer.firstName} phone={p.customer.phone} />
                    </View>
                  )}
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </BottomSheetModal>

      {/* Preview Customer View Modal */}
      <BottomSheetModal visible={showCustomerPreview} onRequestClose={() => setShowCustomerPreview(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, maxHeight: '92%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.borderLight }]}>
              <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>Customer View Preview</Text>
              <Pressable onPress={() => setShowCustomerPreview(false)} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="x" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView bounces={false} style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={[styles.previewBanner, { backgroundColor: colors.primarySurface }]}>
                <Icon name="eye" size={14} color={colors.primaryOnWhite} />
                <Text style={[typeScale.caption, { color: colors.primaryOnWhite, marginLeft: spacing.xs, flex: 1 }]}>
                  Read-only preview. This uses the same customer-visibility rules as the real portal — internal photos, worker notes, and admin data are never shown here.
                </Text>
              </View>

              <View style={{ marginTop: spacing.lg }}>
                <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{p.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}>
                  <StatusBadge
                    label={p.status === 'active' ? 'In Progress' : config.label}
                    status={config.type}
                  />
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginLeft: spacing.sm }]}>{p.progress}% complete</Text>
                </View>
                <ProgressBar progress={p.progress} height={8} style={{ marginTop: spacing.sm }} />
              </View>

              <Text style={[typeScale.labelLarge, { color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
                Shared Photos ({photos.filter(ph => ph.isCustomerVisible).length})
              </Text>
              {photos.filter(ph => ph.isCustomerVisible).length === 0 ? (
                <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>No photos shared yet.</Text>
              ) : (
                <View style={styles.previewPhotoGrid}>
                  {photos.filter(ph => ph.isCustomerVisible).map(ph => (
                    <OptimizedImage key={ph.id} source={ph.fileUrl} style={styles.previewPhotoThumb} />
                  ))}
                </View>
              )}

              <Text style={[typeScale.labelLarge, { color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
                {w('Job Updates')} ({updates.filter(u => u.isCustomerVisible).length})
              </Text>
              {updates.filter(u => u.isCustomerVisible).length === 0 ? (
                <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>No updates shared yet.</Text>
              ) : (
                updates.filter(u => u.isCustomerVisible).map(u => (
                  <View key={u.id} style={[styles.previewUpdateCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                    <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '700' }]}>{u.title}</Text>
                    {u.body && (
                      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{u.body}</Text>
                    )}
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>{formatDateTime(u.createdAt)}</Text>
                  </View>
                ))
              )}

              <Text style={[typeScale.labelLarge, { color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
                Requests Sent ({requests.length})
              </Text>
              {requests.length === 0 ? (
                <Text style={[typeScale.bodySmall, { color: colors.textTertiary, marginBottom: spacing.xl }]}>No requests sent yet.</Text>
              ) : (
                requests.map(r => (
                  <View key={r.id} style={[styles.previewUpdateCard, { backgroundColor: colors.surface, borderColor: colors.borderLight, marginBottom: r === requests[requests.length - 1] ? spacing.xl : spacing.sm }]}>
                    <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '700' }]}>{r.title}</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>{formatDateTime(r.createdAt)}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </BottomSheetModal>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    flex: 1,
  },
  headerAction: {
    padding: spacing.xs,
  },
  moreSectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  moreMenuOverlay: {
    flex: 1,
    backgroundColor: blackAlpha(0.15),
  },
  moreMenuCard: {
    position: 'absolute',
    right: spacing.lg,
    borderRadius: radius.md,
    overflow: 'hidden',
    minWidth: 200,
    ...shadow.md,
  },
  moreMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scrollContent: {
    paddingBottom: spacing['5xl'],
  },
  sectionContent: {
    padding: spacing.lg,
  },

  // Overview
  coverWrap: {
    width: '100%',
    height: 200,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverChangeButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  coverStatusPill: {
    position: 'absolute',
    left: spacing.lg,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  coverStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  overviewBody: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  infoText: {
    flex: 1,
    gap: 2,
  },
  infoRowSplit: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
  },
  infoHalf: {
    flex: 1,
    gap: 2,
  },
  snapshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  snapshotItem: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  snapshotDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  notesHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pillToggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  pillToggle: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  moreSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  moreSummaryImage: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
  },
  moreCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  moreCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Schedule
  dateStripRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dateChip: {
    width: 56,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: 1,
  },
  calendarChip: {
    justifyContent: 'center',
  },
  scheduleDayHeader: {
    marginBottom: spacing.md,
  },
  assignmentList: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  truckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  assignmentStatusCol: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  assignmentActionsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  assignmentActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scheduleWorkerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },

  // People
  // Tasks
  taskStatsHeader: {
    marginBottom: spacing.md,
  },
  taskProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  taskFilterRow: {
    flexDirection: 'row',
    backgroundColor: blackAlpha(0.04),
    borderRadius: radius.lg,
    padding: 3,
    marginBottom: spacing.lg,
  },
  taskFilterChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  taskSection: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  taskSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
  },
  taskRowContent: {
    flex: 1,
    gap: 3,
  },
  taskAssigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  taskPhotoRequiredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskStatusPickerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  taskStatusOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  taskPhotoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.sm,
    marginTop: spacing.lg,
  },
  taskPhotoPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  taskPhotoThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
  },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pickerList: {
    borderRadius: radius.lg,
    marginTop: spacing.xs,
    maxHeight: 240,
    overflow: 'hidden',
  },
  pickerItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  actions: {
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },

  // Updates
  updateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  visibleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
  },

  // Requests
  responseBox: {
    padding: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.md,
  },

  // Activity
  timeline: {
    paddingLeft: spacing.xs,
  },
  timelineItem: {
    flexDirection: 'row',
    minHeight: 48,
  },
  timelineIconCol: {
    width: 32,
    alignItems: 'center',
  },
  timelineIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginVertical: spacing.xs,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },

  // Settings
  settingsCardBlock: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  settingsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  settingsCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  revokeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    marginTop: spacing.md,
  },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    marginTop: spacing.md,
  },

  // Photos
  photoSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  photoFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  photoFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  photoGridTwoCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  photoGridCard: {
    width: '47%',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  photoGridImageWrap: {
    width: '100%',
    aspectRatio: 0.95,
    position: 'relative',
  },
  photoGridImage: {
    width: '100%',
    height: '100%',
  },
  photoTypePill: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  photoVisibilityPill: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  photoGridInfo: {
    padding: spacing.sm,
    gap: 2,
  },
  photoUploaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  photoTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },

  // Photo review modal
  modalOverlay: {
    flex: 1,
    backgroundColor: blackAlpha(0.5),
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  modalClose: {
    padding: spacing.xs,
  },
  modalBody: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  reviewImage: {
    width: '100%',
    height: 220,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  reviewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  descInput: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: typeScale.bodySmall.fontSize,
  },

  // Photo Details modal
  dragHandleWrap: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
  },
  detailPhotoWrap: {
    width: '100%',
    height: 280,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    position: 'relative',
    overflow: 'hidden',
  },
  detailPhoto: {
    width: '100%',
    height: '100%',
  },
  expandIcon: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: blackAlpha(0.55),
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: blackAlpha(0.08),
  },
  detailMetaCol: {
    flexShrink: 1,
  },
  detailMetaColRight: {
    alignItems: 'flex-end',
    maxWidth: '45%',
  },
  noteCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  noteCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  descCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  descCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  descBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  descEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  descEditBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  visibilityCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  visibilityCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unshareBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    paddingVertical: spacing.sm,
  },

  // Update composer
  composerInput: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    fontSize: typeScale.bodySmall.fontSize,
    marginBottom: spacing.sm,
  },
  composerBody: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  visibilityToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },

  // Customer tab
  customerCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  customerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customerContactList: {
    marginTop: spacing.md,
    gap: 6,
  },
  customerContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customerActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  customerActionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  accessCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  accessCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  accessDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  manageAccessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  manageAccessPillFull: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  settingsCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  customerSettingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  customerContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  customerContentIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  manageAccessRow: {
    marginTop: spacing.lg,
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  previewPhotoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  previewPhotoThumb: {
    width: 100,
    height: 100,
    borderRadius: radius.sm,
  },
  previewUpdateCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },

  // People
  teamHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  addTeamMemberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  teamListCard: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  aboutTeamCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },

  // Activity Log
  activityToolbarRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.md,
  },
  expandAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  activityDayCard: {
    borderRadius: radius.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  activityDayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  activityDayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  activityThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    marginLeft: spacing.sm,
  },
});
