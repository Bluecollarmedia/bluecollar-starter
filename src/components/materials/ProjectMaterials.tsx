/**
 * Project Detail → More → Materials: the project's materials checklist,
 * suggestions from its approved quote and change orders, where to get the
 * materials, a prep reminder tied to the job date, and sharing the list.
 * Owner-only; nothing here is shown to the customer.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';
import { Button, ListSection, StatusBadge, InlineNotice, ProgressBar } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { MaterialSheet, type MaterialDraft } from './MaterialSheet';
import { VendorSheet } from './VendorSheet';
import { PickupSheet } from './PickupSheet';
import { ReminderSheet, formatReminder } from './ReminderSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { db, useDb } from '@/data/store';
import {
  materialsFor, planFor, vendorById, nextJobDate, reminderProblem, isDone, pendingSuggestionCount,
  addMaterial, updateMaterial, removeMaterial, moveMaterial, suggestMaterials, savePlan, setReminder,
  clearReminder, defaultReminderDate, addVendor, checklistText,
  MATERIAL_STATUS_LABEL, MATERIAL_STATUS_TONE,
} from '@/data/materials';
import { formatDocDate } from '@/lib/documentHtml';
import { formatQuantity } from '@/lib/money';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import type { ProjectMaterial } from '@/types/materials';

export function ProjectMaterials({ projectId }: { projectId: string }) {
  const { colors } = useTheme();
  const v = useDb();
  const items = useMemo(() => materialsFor(projectId), [projectId, v]);
  const plan = planFor(projectId);
  const vendor = vendorById(plan.vendorId);
  const job = nextJobDate(projectId);
  const problem = reminderProblem(projectId);
  const newSuggestions = pendingSuggestionCount(projectId);
  const hasApproved = db.quotes.some((q) => q.projectId === projectId && q.status === 'approved');
  const done = items.filter(isDone).length;
  const unknownQty = items.filter((m) => m.quantity == null && !isDone(m)).length;

  const [editing, setEditing] = useState<ProjectMaterial | 'new' | null>(null);
  const [sheet, setSheet] = useState<'pickup' | 'vendor' | 'reminder' | null>(null);
  const [afterVendor, setAfterVendor] = useState<'pickup' | null>(null);

  const suggest = () => {
    const r = suggestMaterials(projectId);
    if (r.noApproved) showMessage('No approved work yet', 'Suggestions come from an approved quote or change order.');
    else if (r.added === 0) showMessage('Nothing new to add', r.nothingFound
      ? 'None of the approved lines look like materials. Group a line as Materials on the quote, or add materials here yourself.'
      : 'Everything from the approved quote and change orders is already on the list.');
  };

  const saveItem = (d: MaterialDraft) => {
    if (editing === 'new') addMaterial({ projectId, ...d });
    else if (editing) updateMaterial(editing.id, d);
    setEditing(null);
  };

  const share = () => {
    Share.share({ message: checklistText(projectId) }).catch(() => {});
  };

  const qtyText = (m: ProjectMaterial) =>
    m.quantity != null ? `${formatQuantity(m.quantity)}${m.unit ? ` ${m.unit}` : ''}` : 'Quantity needed';

  return (
    <View style={styles.wrap}>
      {/* Summary */}
      <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
        <View style={styles.cardRow}>
          <View style={[styles.iconTile, { backgroundColor: colors.primarySurface }]}>
            <Icon name="clipboard" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>Materials checklist</Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
              {items.length === 0 ? 'Nothing on the list yet' : `${done} of ${items.length} ready`}
              {job ? `  ·  Job ${formatDocDate(job)}` : '  ·  Not scheduled yet'}
            </Text>
          </View>
        </View>
        {items.length > 0 && <ProgressBar progress={Math.round((done / items.length) * 100)} height={6} style={{ marginTop: spacing.md }} />}
      </View>

      {/* Suggestions */}
      {newSuggestions > 0 ? (
        <View style={[styles.card, { backgroundColor: colors.primarySurface }]}>
          <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>
            {newSuggestions === 1 ? '1 material' : `${newSuggestions} materials`} from approved work
          </Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
            Copied from lines grouped as Materials, or measured in tons, yards, bags, plants and similar. Quantities are what the quote says; each one is marked Needs review.
          </Text>
          <Button title="Add Suggestions" icon="plus" onPress={suggest} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />
        </View>
      ) : !hasApproved && items.length === 0 ? (
        <InlineNotice icon="info" tone="neutral" text="Once a quote is approved, its materials can be added here in one tap. You can add materials yourself anytime." />
      ) : null}

      {/* Checklist */}
      {items.length > 0 && (
        <ListSection title={`CHECKLIST (${items.length})`}>
          {items.map((m, i) => {
            const own = m.vendorId && m.vendorId !== plan.vendorId ? vendorById(m.vendorId) : undefined;
            return (
              <Pressable
                key={m.id}
                onPress={() => setEditing(m)}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.backgroundSecondary }]}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${m.name}`}
              >
                <Icon name={isDone(m) ? 'check-circle' : 'circle'} size={20} color={isDone(m) ? colors.primary : colors.border} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }, isDone(m) && { color: colors.textSecondary }]} numberOfLines={2}>{m.name}</Text>
                  <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={1}>
                    <Text style={m.quantity == null ? { color: colors.textPrimary, fontWeight: '600' } : undefined}>{qtyText(m)}</Text>{own ? `  ·  ${own.name}` : ''}{m.source ? `  ·  from ${m.source.number}` : ''}{m.notes ? '  ·  note' : ''}
                  </Text>
                </View>
                <StatusBadge label={MATERIAL_STATUS_LABEL[m.status]} status={MATERIAL_STATUS_TONE[m.status]} />
                {items.length > 1 && (
                  <View style={styles.reorder}>
                    <Pressable onPress={() => moveMaterial(projectId, m.id, -1)} disabled={i === 0} hitSlop={6} accessibilityLabel="Move up">
                      <Icon name="chevron-up" size={16} color={i === 0 ? colors.border : colors.textTertiary} />
                    </Pressable>
                    <Pressable onPress={() => moveMaterial(projectId, m.id, 1)} disabled={i === items.length - 1} hitSlop={6} accessibilityLabel="Move down">
                      <Icon name="chevron-down" size={16} color={i === items.length - 1 ? colors.border : colors.textTertiary} />
                    </Pressable>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ListSection>
      )}
      {unknownQty > 0 && (
        <InlineNotice icon="alert-triangle" tone="warning" text={`${unknownQty === 1 ? '1 material needs' : `${unknownQty} materials need`} a quantity before ordering.`} />
      )}
      <Button title="Add Material" icon="plus" variant="secondary" onPress={() => setEditing('new')} fullWidth />

      {/* Reminder */}
      <ListSection title="PREP REMINDER">
        <Pressable onPress={() => setSheet('reminder')} style={styles.row} accessibilityRole="button">
          <Icon name="bell" size={18} color={plan.reminderAt ? colors.primary : colors.textTertiary} />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>
              {plan.reminderAt ? formatReminder(plan.reminderAt) : 'Set a reminder'}
            </Text>
            <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={2}>
              {plan.reminderAt
                ? (plan.reminderNote || (plan.reminderJobDate ? `For the job on ${formatDocDate(plan.reminderJobDate)}` : 'No job date yet'))
                : job ? `Get reminded before the job on ${formatDocDate(job)}` : 'Pick a day to order or pick up materials'}
            </Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textTertiary} />
        </Pressable>
      </ListSection>
      {!!problem && <InlineNotice icon="alert-triangle" tone="warning" text={problem} />}

      {/* Vendor & pickup */}
      <ListSection title="VENDOR & PICKUP">
        <Pressable onPress={() => setSheet('pickup')} style={styles.row} accessibilityRole="button">
          <Icon name="truck" size={18} color={vendor || plan.pickupLocation ? colors.primary : colors.textTertiary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]} numberOfLines={1}>{vendor?.name ?? plan.pickupLocation ?? 'Add vendor and pickup'}</Text>
            {(vendor?.phone || plan.pickupLocation || plan.pickupInstructions) && (
              <Text style={[typeScale.caption, { color: colors.textSecondary }]} numberOfLines={2}>
                {[vendor?.phone, vendor ? plan.pickupLocation : undefined, plan.pickupInstructions].filter(Boolean).join('  ·  ')}
              </Text>
            )}
          </View>
          <Icon name="chevron-right" size={18} color={colors.textTertiary} />
        </Pressable>
      </ListSection>

      <Button title="Share Materials List" icon="share-2" variant="secondary" onPress={share} fullWidth disabled={items.length === 0} />
      <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center', marginTop: -spacing.sm }]}>
        Shares items still to prepare, quantities, vendor and pickup details. Internal notes stay private.
      </Text>

      <MaterialSheet
        visible={!!editing}
        item={editing && editing !== 'new' ? editing : null}
        onSave={saveItem}
        onDelete={() => {
          if (!editing || editing === 'new') return;
          const m = editing;
          confirmAction(`Remove ${m.name}?`, m.source ? 'It won’t be suggested again.' : 'It will be removed from the checklist.', 'Remove', () => { removeMaterial(m); setEditing(null); }, true);
        }}
        onClose={() => setEditing(null)}
      />
      <PickupSheet
        visible={sheet === 'pickup'}
        plan={plan}
        onSave={(d) => { savePlan(projectId, d); setSheet(null); }}
        onNewVendor={() => { setAfterVendor('pickup'); setSheet('vendor'); }}
        onClose={() => setSheet(null)}
      />
      <VendorSheet
        visible={sheet === 'vendor'}
        vendor={null}
        onSave={(input) => {
          const created = addVendor(input);
          if (!plan.vendorId) {
            savePlan(projectId, {
              vendorId: created.id,
              pickupLocation: plan.pickupLocation ?? created.address,
              pickupInstructions: plan.pickupInstructions ?? created.pickupInstructions,
            });
          }
          setSheet(afterVendor);
          setAfterVendor(null);
        }}
        onClose={() => { setSheet(afterVendor); setAfterVendor(null); }}
      />
      <ReminderSheet
        visible={sheet === 'reminder'}
        initial={plan.reminderAt ? new Date(plan.reminderAt) : defaultReminderDate(projectId)}
        initialNote={plan.reminderNote}
        jobDate={job}
        hasReminder={!!plan.reminderAt}
        onSave={(at, note) => { setReminder(projectId, at, note); setSheet(null); }}
        onClear={() => { clearReminder(projectId); setSheet(null); }}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg },
  card: { borderRadius: radius.xl, padding: spacing.md },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconTile: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  reorder: { gap: 2 },
});
