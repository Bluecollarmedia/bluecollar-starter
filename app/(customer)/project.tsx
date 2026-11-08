import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, Alert, Platform, Keyboard } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { useAuth } from '@/providers/AuthProvider';
import { SectionTabs, Card, EmptyState, StatusBadge, Button, OptimizedImage } from '@/components/ui';
import { useProject } from '@/hooks/useProject';
import { db } from '@/data/store';
import { CustomerBillingCard } from '@/components/financials/CustomerBillingCard';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { meaningfulUpdates } from '@/lib/customerOverview';
import { ReportSheet, type ReportTarget } from '@/components/reports/ReportSheet';
import { PhotoPager, type PagerPhoto } from '@/components/media/PhotoPager';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { semantic, brand } from '@/theme/colors';
import type { ProjectStatus, CustomerTimelineType, RequestCategory } from '@/types/project';

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'photos', label: 'Photos' },
  { key: 'requests', label: 'Requests' },
];

const statusConfig: Record<ProjectStatus, { label: string; type: 'success' | 'warning' | 'info' | 'neutral' }> = {
  prospect: { label: 'Quote', type: 'neutral' },
  active: { label: 'In Progress', type: 'success' },
  on_hold: { label: 'On Hold', type: 'warning' },
  completed: { label: 'Completed', type: 'info' },
  archived: { label: 'Archived', type: 'neutral' },
};

const timelineIcons: Record<CustomerTimelineType, keyof typeof Feather.glyphMap> = {
  update_shared: 'send',
  photo_shared: 'camera',
  progress_updated: 'trending-up',
  project_started: 'play-circle',
  project_completed: 'check-circle',
  request_responded: 'message-square',
};

const timelineColors: Record<CustomerTimelineType, string> = {
  update_shared: semantic.info,
  photo_shared: brand.primary,
  progress_updated: semantic.warning,
  project_started: semantic.success,
  project_completed: semantic.success,
  request_responded: semantic.info,
};

const categoryOptions: { key: RequestCategory; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'question', label: 'Question', icon: 'help-circle' },
  { key: 'change_request', label: 'Change Request', icon: 'edit-3' },
  { key: 'additional_work', label: 'Additional Work', icon: 'plus-circle' },
  { key: 'other', label: 'Other', icon: 'more-horizontal' },
];

export default function CustomerProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeSection, setActiveSection] = useState('overview');
  const [viewing, setViewing] = useState<{ photos: PagerPhoto[]; startId: string } | null>(null);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [reqTitle, setReqTitle] = useState('');
  const [reqDescription, setReqDescription] = useState('');
  const [reqCategory, setReqCategory] = useState<RequestCategory>('question');

  const { project, photos, tasks, customerTimeline, updates, requests, submitRequest, settings, taskStats } = useProject(id);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);

  const sharedPhotos = useMemo(
    () => photos.filter(p => p.isCustomerVisible),
    [photos],
  );

  // Finished tasks (the database only lets a customer read these), newest first, each with the photos the owner shared for it.
  const doneTasks = useMemo(
    () => tasks.filter(tk => tk.status === 'completed').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [tasks],
  );

  const visibleUpdates = useMemo(
    () => updates.filter(u => u.isCustomerVisible),
    [updates],
  );

  const customerRequests = useMemo(
    () => requests.filter(r => r.requestedBy === user?.id),
    [requests, user?.id],
  );

  const isCompleted = project?.status === 'completed';
  const canSubmitRequests = !isCompleted && (settings?.customerInteractionEnabled ?? false);

  function handleSubmitRequest() {
    if (!reqTitle.trim()) return;
    Keyboard.dismiss();
    submitRequest({ title: reqTitle.trim(), description: reqDescription.trim() || undefined, category: reqCategory });
    const companyName = db.company?.name ?? 'Brighton Lawn + Landscape';
    const sentMsg = t("Your {category} has been sent to {company}. They'll review it shortly.", { category: t(categoryOptions.find(c => c.key === reqCategory)?.label ?? reqCategory), company: companyName });
    if (Platform.OS === 'web') alert(sentMsg);
    else Alert.alert(t('Request Submitted'), sentMsg);
    setReqTitle('');
    setReqDescription('');
    setReqCategory('question');
    setShowRequestForm(false);
  }

  if (!project) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <EmptyState icon="alert-circle" title={t('Project not found')} />
      </View>
    );
  }

  // Narrowed copy: nested render functions below lose the `if (!project)` narrowing.
  const p = project;
  const config = statusConfig[p.status];

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateTime(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function renderOverview() {
    const recent = meaningfulUpdates(customerTimeline, 3);
    const statusTitle = isCompleted ? t('Complete') : t(config.label);
    const statusLine = isCompleted && p.completedAt
      ? t('Project finished on {date}', { date: formatDate(p.completedAt) })
      : p.estimatedEndDate ? t('Estimated completion {date}', { date: formatDate(p.estimatedEndDate) }) : undefined;
    const ringColor = isCompleted ? semantic.success : colors.primary;
    const cardStyle = [styles.ovCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }];

    return (
      <View style={styles.sectionContent}>
        {/* 1. Completion */}
        <View style={[cardStyle, styles.ringCard]}>
          <ProgressRing progress={p.progress} color={ringColor} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.headingLarge, { color: isCompleted ? semantic.success : colors.textPrimary }]}>{statusTitle}</Text>
            {statusLine && <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>{statusLine}</Text>}
          </View>
        </View>

        {/* 2. Project Activity: a few meaningful updates only */}
        <View style={cardStyle}>
          <View style={styles.ovHead}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>{t('Project Activity')}</Text>
            {customerTimeline.length > 0 && (
              <Pressable onPress={() => setActiveSection('timeline')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('View all project activity')} style={styles.viewAll}>
                <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('View all')}</Text>
                <Icon name="chevron-right" size={16} color={colors.primary} />
              </Pressable>
            )}
          </View>
          {recent.length === 0 ? (
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, paddingBottom: spacing.xs }]}>
              {t('No updates yet. Completed work will show up here.')}
            </Text>
          ) : (
            recent.map((e, i) => (
              <View key={e.id} style={[styles.actRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <View style={[styles.actCheck, { backgroundColor: semantic.successLight }]}>
                  <Icon name="check" size={14} color={semantic.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={2}>{e.title}</Text>
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{formatDateTime(e.timestamp)}</Text>
                </View>
                {e.photoUrl ? (
                  <Pressable onPress={() => setViewing({ photos: [{ id: e.photoUrl!, url: e.photoUrl! }], startId: e.photoUrl! })} accessibilityRole="button" accessibilityLabel={t('View photo')}>
                    <OptimizedImage source={e.photoUrl} style={[styles.actThumb, { backgroundColor: colors.backgroundTertiary }]} />
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </View>

        {/* 2b. Work completed: finished tasks with the photos shared for each */}
        {doneTasks.length > 0 ? (
          <View style={cardStyle}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.xs }]}>{t('Work completed')}</Text>
            {doneTasks.map((tk, i) => {
              const pics = sharedPhotos.filter(ph => ph.taskId === tk.id);
              return (
                <View key={tk.id} style={[{ paddingVertical: spacing.sm }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[styles.actCheck, { backgroundColor: semantic.successLight, marginRight: spacing.sm }]}>
                      <Icon name="check" size={14} color={semantic.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={2}>{tk.title}</Text>
                      {tk.completedAt ? <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{formatDateTime(tk.completedAt)}</Text> : null}
                    </View>
                  </View>
                  {pics.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}>
                      {pics.map(ph => (
                        <Pressable key={ph.id} onPress={() => setViewing({ photos: pics.map(x => ({ id: x.id, url: x.fileUrl })), startId: ph.id })} accessibilityRole="button" accessibilityLabel={t('View photo')}>
                          <OptimizedImage source={ph.fileUrl} style={[styles.actThumb, { backgroundColor: colors.backgroundTertiary }]} />
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* 3. Project Details */}
        <View style={cardStyle}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.xs }]}>{t('Project Details')}</Text>
          {p.address && (
            <View style={styles.detailRow}>
              <Icon name="map-pin" size={16} color={colors.textTertiary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginLeft: spacing.sm, flex: 1 }]}>
                {p.address}{p.city ? `, ${p.city}` : ''}{p.state ? ` ${p.state}` : ''} {p.zip ?? ''}
              </Text>
            </View>
          )}
          {p.startDate && (
            <View style={styles.detailRow}>
              <Icon name="calendar" size={16} color={colors.textTertiary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginLeft: spacing.sm }]}>{t('Started {date}', { date: formatDate(p.startDate) })}</Text>
            </View>
          )}
          {!isCompleted && p.estimatedEndDate && (
            <View style={styles.detailRow}>
              <Icon name="clock" size={16} color={colors.textTertiary} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginLeft: spacing.sm }]}>{t('Est. completion: {date}', { date: formatDate(p.estimatedEndDate) })}</Text>
            </View>
          )}
          {p.completedAt && (
            <View style={styles.detailRow}>
              <Icon name="check-circle" size={16} color={semantic.success} />
              <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginLeft: spacing.sm }]}>{t('Completed {date}', { date: formatDate(p.completedAt) })}</Text>
            </View>
          )}
        </View>

        {/* 4. Billing, always last */}
        <CustomerBillingCard projectId={p.id} />
      </View>
    );
  }

  function renderTimeline() {
    return (
      <View style={styles.sectionContent}>
        {customerTimeline.length === 0 ? (
          <EmptyState icon="activity" title={t('No updates yet')} description={t('Project updates and milestones will appear here.')} />
        ) : (
          <View style={styles.timeline}>
            {customerTimeline.map((event, i) => (
              <View key={event.id} style={styles.timelineItem}>
                <View style={styles.timelineIconCol}>
                  <View style={[styles.timelineIcon, { backgroundColor: (timelineColors[event.eventType] ?? colors.primary) + '20' }]}>
                    <Icon
                      name={timelineIcons[event.eventType] ?? 'activity'}
                      size={14}
                      color={timelineColors[event.eventType] ?? colors.primary}
                    />
                  </View>
                  {i < customerTimeline.length - 1 && <View style={[styles.timelineLine, { backgroundColor: colors.borderLight }]} />}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary, fontWeight: '600' }]}>
                    {event.title}
                  </Text>
                  {event.description && (
                    <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
                      {event.description}
                    </Text>
                  )}
                  {event.photoUrl && (
                    <Pressable onPress={() => setViewing({ photos: [{ id: event.photoUrl!, url: event.photoUrl! }], startId: event.photoUrl! })} accessibilityRole="button" accessibilityLabel={t('View photo')}>
                      <OptimizedImage
                        source={event.photoUrl}
                        style={[styles.timelinePhoto, { backgroundColor: colors.backgroundTertiary }]}
                      />
                    </Pressable>
                  )}
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>
                    {formatDateTime(event.timestamp)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  function renderPhotos() {
    return (
      <View style={styles.sectionContent}>
        {sharedPhotos.length === 0 ? (
          <EmptyState icon="camera" title={t('No photos shared yet')} description={t('Photos of your project will appear here as work progresses.')} />
        ) : (
          <View style={styles.photoGrid}>
            {sharedPhotos.map(photo => (
              <Card key={photo.id} style={styles.photoCard}>
                <Pressable onPress={() => setViewing({ photos: sharedPhotos.map(p => ({ id: p.id, url: p.fileUrl })), startId: photo.id })} accessibilityRole="button" accessibilityLabel={t('View photo')}>
                  <OptimizedImage
                    source={photo.fileUrl}
                    style={[styles.photoImage, { backgroundColor: colors.backgroundTertiary }]}
                  />
                </Pressable>
                <View style={{ padding: spacing.md }}>
                  <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>
                    {photo.customerDescription ?? photo.caption ?? t('Project photo')}
                  </Text>
                  {photo.taskTitle && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}>
                      <Icon name="check-square" size={12} color={colors.textTertiary} />
                      <Text style={[typeScale.caption, { color: colors.textTertiary, marginLeft: 4 }]}>
                        {photo.taskTitle}
                      </Text>
                    </View>
                  )}
                  <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>
                    {formatDateTime(photo.sharedAt ?? photo.createdAt)}
                  </Text>
                  <Pressable
                    onPress={() => setReporting({ projectId: id, type: 'photo', contentId: photo.id, where: project?.name })}
                    hitSlop={8}
                    style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}
                    accessibilityRole="button"
                    accessibilityLabel={t('Report this photo')}
                  >
                    <Text style={[typeScale.caption, { color: colors.textSecondary, textDecorationLine: 'underline' }]}>{t('Report')}</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        )}
        <ReportSheet target={reporting} onClose={() => setReporting(null)} />
      </View>
    );
  }

  function renderRequests() {
    const statusLabel: Record<string, { label: string; type: 'success' | 'warning' | 'info' | 'neutral' | 'error' }> = {
      pending: { label: 'Pending', type: 'warning' },
      acknowledged: { label: 'Acknowledged', type: 'info' },
      completed: { label: 'Completed', type: 'success' },
      declined: { label: 'Declined', type: 'error' },
      converted: { label: 'In Progress', type: 'success' },
    };

    return (
      <View style={styles.sectionContent}>
        {canSubmitRequests && !showRequestForm && (
          <Button
            title={t('New Request')}
            onPress={() => setShowRequestForm(true)}
            variant="primary"
            fullWidth
            icon="plus"
            style={{ marginBottom: spacing.lg }}
          />
        )}

        {canSubmitRequests && showRequestForm && (
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={[typeScale.headingSmall, { color: colors.textPrimary, marginBottom: spacing.md }]}>
              {t('Submit a Request')}
            </Text>

            <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              {t('Category')}
            </Text>
            <View style={styles.categoryGrid}>
              {categoryOptions.map(cat => {
                const selected = reqCategory === cat.key;
                return (
                  <Pressable
                    key={cat.key}
                    onPress={() => setReqCategory(cat.key)}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: selected ? colors.primary + '15' : colors.backgroundTertiary,
                        borderColor: selected ? colors.primary : colors.borderLight,
                      },
                    ]}
                  >
                    <Icon name={cat.icon} size={14} color={selected ? colors.primary : colors.textTertiary} />
                    <Text style={[typeScale.caption, { color: selected ? colors.primary : colors.textSecondary, fontWeight: selected ? '600' : '400' }]}>
                      {t(cat.label)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.md }]}>
              {t('Title')}
            </Text>
            <TextInput
              value={reqTitle}
              onChangeText={setReqTitle}
              placeholder={t('Brief summary of your request')}
              placeholderTextColor={colors.textTertiary}
              style={[styles.formInput, { color: colors.textPrimary, backgroundColor: colors.backgroundTertiary, borderColor: colors.borderLight }]}
            />

            <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.md }]}>
              {t('Details (optional)')}
            </Text>
            <TextInput
              value={reqDescription}
              onChangeText={setReqDescription}
              placeholder={t('Add any details or context...')}
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={3}
              style={[styles.formInput, styles.formTextarea, { color: colors.textPrimary, backgroundColor: colors.backgroundTertiary, borderColor: colors.borderLight }]}
            />

            <View style={styles.formActions}>
              <Button title={t('Cancel')} onPress={() => { setShowRequestForm(false); setReqTitle(''); setReqDescription(''); }} variant="secondary" style={{ flex: 1 }} />
              <Button title={t('Submit')} onPress={handleSubmitRequest} variant="primary" style={{ flex: 1 }} icon="send" />
            </View>
          </Card>
        )}

        {customerRequests.length === 0 && !showRequestForm ? (
          <EmptyState icon="message-circle" title={t('No requests yet')} description={canSubmitRequests ? t('Tap "New Request" to submit a question or change request.') : t('Requests you submit will appear here.')} />
        ) : (
          customerRequests.map(req => {
            const badge = statusLabel[req.status] ?? { label: req.status, type: 'neutral' as const };
            return (
              <Card key={req.id} style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1 }]}>{req.title}</Text>
                  <StatusBadge label={t(badge.label)} status={badge.type} />
                </View>
                {req.description && (
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                    {req.description}
                  </Text>
                )}
                {req.responseNote && (
                  <View style={[styles.responseBox, { backgroundColor: colors.primarySurface }]}>
                    <Text style={[typeScale.caption, { color: colors.primary, fontWeight: '600' }]}>{t('Response from Brighton Lawn')}</Text>
                    <Text style={[typeScale.bodySmall, { color: colors.textPrimary, marginTop: spacing.xs }]}>
                      {req.responseNote}
                    </Text>
                  </View>
                )}
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.md }]}>
                  {t('Submitted {date}', { date: formatDateTime(req.createdAt) })}
                </Text>
              </Card>
            );
          })
        )}
      </View>
    );
  }

  const activeSections = (isCompleted
    ? SECTIONS.filter(s => s.key !== 'requests')
    : (settings?.customerInteractionEnabled ? SECTIONS : SECTIONS.filter(s => s.key !== 'requests'))
  ).map(s => ({ ...s, label: t(s.label) }));

  const sectionRenderers: Record<string, () => React.ReactNode> = {
    overview: renderOverview,
    timeline: renderTimeline,
    photos: renderPhotos,
    requests: renderRequests,
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel={t('Go back')}>
            <Icon name="arrow-left" size={24} color={colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]} numberOfLines={1}>
              {p.name}
            </Text>
          </View>
        </View>
      </View>

      <SectionTabs tabs={activeSections} activeTab={activeSection} onTabChange={setActiveSection} />

      <KeyboardAwareScrollView bounces={false} bottomOffset={KEYBOARD_GAP} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {sectionRenderers[activeSection]?.()}
      </KeyboardAwareScrollView>
      <PhotoPager photos={viewing?.photos ?? []} startId={viewing?.startId ?? null} onClose={() => setViewing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  scrollContent: {
    paddingBottom: spacing['5xl'],
  },
  sectionContent: {
    padding: spacing.lg,
  },

  // Overview
  ovCard: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md },
  ringCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  ovHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  actCheck: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actThumb: { width: 44, height: 44, borderRadius: radius.sm },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs + 2 },

  // Timeline
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
  },
  timelinePhoto: {
    width: '100%',
    height: 140,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },

  // Photos
  photoGrid: {
    gap: spacing.md,
  },
  photoCard: {
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: 180,
  },

  // Requests
  responseBox: {
    padding: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.md,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  formInput: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typeScale.bodySmall.fontSize,
  },
  formTextarea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
});
