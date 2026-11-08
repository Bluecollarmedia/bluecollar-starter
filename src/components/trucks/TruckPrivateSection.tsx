/**
 * On a truck's page, for the company owner only: the truck's Insurance (PDFs or photos, with expiry warnings) and its Maintenance log
 * (title, date serviced, when it is next due, and what was done; the owner is reminded on the due date). Nobody else sees this section,
 * and the database refuses to give the data to anyone else either (supabase/updates/056 and 077).
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking, Alert, Platform } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Button, Card } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { TruckDocumentSheet } from './TruckDocumentSheet';
import { TruckMaintenanceSheet } from './TruckMaintenanceSheet';
import {
  addTruckDocument, addTruckMaintenance, deleteTruckMaintenance, removeTruckDocument, updateTruckMaintenance, useTruckDocuments, useTruckMaintenance,
} from '@/data/truckFiles';
import { expiryStatus, formatSize, isPdf } from '@/lib/truckDocs';
import { dueInfo, servicedLabel } from '@/lib/truckMaintenance';
import { localDateKey } from '@/lib/ids';
import { semantic } from '@/theme/colors';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import type { TruckDocument, TruckMaintenance } from '@/types/truck';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function confirm(title: string, message: string, action: string, run: () => void) {
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: run }]);
}

export function TruckPrivateSection({ truckId }: { truckId: string }) {
  const { colors } = useTheme();
  // Only insurance papers here; anything saved earlier as another kind of document stays in the database but is not listed.
  const docs = useTruckDocuments(truckId).filter((d) => d.kind === 'insurance');
  const log = useTruckMaintenance(truckId);
  const [insuranceSheet, setInsuranceSheet] = useState(false);
  const [maintSheet, setMaintSheet] = useState(false);
  const [editing, setEditing] = useState<TruckMaintenance | null>(null);
  const today = localDateKey(new Date());

  function open(d: TruckDocument) {
    Linking.openURL(d.fileUrl).catch(() => Alert.alert("Couldn't open the file", 'Try again in a moment.'));
  }

  return (
    <>
      <Card title="Insurance" style={styles.card}>
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
          Insurance papers as a PDF or photo. Only you can see these.
        </Text>
        {docs.length === 0 ? (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.sm }]}>No insurance added yet.</Text>
        ) : (
          docs.map((d, i) => {
            const exp = expiryStatus(d.expiresOn);
            const tone = exp.state === 'expired' ? semantic.error : exp.state === 'soon' ? semantic.warning : colors.textTertiary;
            return (
              <View key={d.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <Pressable onPress={() => open(d)} style={styles.rowMain} accessibilityRole="button" accessibilityLabel={`Open ${d.title}`}>
                  <View style={[styles.icon, { backgroundColor: colors.primarySurface }]}>
                    <Icon name={isPdf(d.contentType, d.title) ? 'file-text' : 'image'} size={18} color={colors.primaryDark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{d.title}</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]} numberOfLines={1}>
                      {[isPdf(d.contentType) ? 'PDF' : 'Photo', formatSize(d.sizeBytes), `Added ${when(d.createdAt)}`].filter(Boolean).join(' · ')}
                    </Text>
                    {exp.label ? <Text style={[typeScale.caption, { color: tone, fontWeight: exp.state === 'ok' || exp.state === 'none' ? '400' : '700' }]}>{exp.label}</Text> : null}
                  </View>
                </Pressable>
                <Pressable onPress={() => confirm('Delete this insurance?', `${d.title} will be removed from this truck.`, 'Delete', () => removeTruckDocument(d))} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${d.title}`}>
                  <Icon name="trash-2" size={18} color={colors.textTertiary} />
                </Pressable>
              </View>
            );
          })
        )}
        <Button title="Add Insurance" icon="plus" variant="secondary" onPress={() => setInsuranceSheet(true)} fullWidth />
      </Card>

      <Card title="Maintenance" style={styles.card}>
        <Text style={[typeScale.caption, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
          Services done on this truck. Set when the next one is due and you get a reminder that morning. Only you can see this.
        </Text>
        {log.length === 0 ? (
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginBottom: spacing.sm }]}>No maintenance recorded yet.</Text>
        ) : (
          log.map((m, i) => {
            const due = dueInfo(m.dueOn, today);
            const tone = due.state === 'overdue' ? semantic.error : due.state === 'today' || due.state === 'soon' ? semantic.warning : colors.textTertiary;
            return (
              <View key={m.id} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <Pressable onPress={() => { setEditing(m); setMaintSheet(true); }} style={styles.rowMain} accessibilityRole="button" accessibilityLabel={`Change ${m.title}`}>
                  <View style={[styles.icon, { backgroundColor: colors.primarySurface }]}>
                    <Icon name="tool" size={18} color={colors.primaryDark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>{m.title}</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>{servicedLabel(m.servicedOn)}</Text>
                    {due.label ? <Text style={[typeScale.caption, { color: tone, fontWeight: due.state === 'ok' ? '400' : '700' }]}>{due.label}</Text> : null}
                    {m.notes ? <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={3}>{m.notes}</Text> : null}
                  </View>
                </Pressable>
                <Pressable onPress={() => confirm('Delete this record?', `${m.title} will be removed from this truck's maintenance.`, 'Delete', () => deleteTruckMaintenance(m.id))} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${m.title}`}>
                  <Icon name="trash-2" size={18} color={colors.textTertiary} />
                </Pressable>
              </View>
            );
          })
        )}
        <Button title="Add Maintenance" icon="plus" variant="secondary" onPress={() => { setEditing(null); setMaintSheet(true); }} fullWidth />
      </Card>

      <TruckDocumentSheet
        visible={insuranceSheet}
        onClose={() => setInsuranceSheet(false)}
        onSubmit={async (input) => { const r = await addTruckDocument(truckId, input); return r.ok ? null : r.error; }}
      />
      <TruckMaintenanceSheet
        visible={maintSheet}
        editing={editing}
        onClose={() => { setMaintSheet(false); setEditing(null); }}
        onSubmit={(input) => { const r = editing ? updateTruckMaintenance(editing.id, input) : addTruckMaintenance(truckId, input); return r.ok ? null : r.error; }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
