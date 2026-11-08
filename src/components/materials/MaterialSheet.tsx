/**
 * Add / edit one material on a project's checklist: name, quantity (may be
 * left empty when unknown), unit, status, where it comes from, and internal
 * notes (never shown to the customer).
 */

import { useKeepDraft } from '@/hooks/useKeepDraft';
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Button, ListSection } from '@/components/ui';
import { InputRow, NoteField } from '@/components/financials/FormBits';
import { showMessage } from '@/components/financials/ActionSheet';
import { FormSheet, ChipRow, SheetLabel } from './FormSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { db } from '@/data/store';
import { MATERIAL_STATUS_ORDER, MATERIAL_STATUS_LABEL } from '@/data/materials';
import { formatQuantity, parseAmount } from '@/lib/money';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import type { MaterialStatus, ProjectMaterial } from '@/types/materials';

const UNITS = ['ea', 'ton', 'yd', 'bag', 'pallet', 'plant', 'sq ft', 'ln ft', 'gal', 'roll'];

export interface MaterialDraft {
  name: string;
  quantity?: number;
  unit?: string;
  status: MaterialStatus;
  vendorId?: string;
  notes?: string;
}

export function MaterialSheet({ visible, item, onSave, onDelete, onClose }: {
  visible: boolean;
  /** null = new item */
  item: ProjectMaterial | null;
  onSave: (draft: MaterialDraft) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState<MaterialStatus>('to_order');
  const [vendorId, setVendorId] = useState<string | undefined>();
  const [notes, setNotes] = useState('');

  // Swipe the sheet down and open it again: what you typed is still there (until it is saved or you leave the page).
  const markSaved = useKeepDraft(visible, item?.id ?? 'new', () => {
    setName(item?.name ?? '');
    setQty(item?.quantity != null ? String(item.quantity) : '');
    setUnit(item?.unit ?? '');
    setStatus(item?.status ?? 'to_order');
    setVendorId(item?.vendorId);
    setNotes(item?.notes ?? '');
  });

  const save = () => {
    if (!name.trim()) {
      showMessage('Name needed', 'Enter what the material is, e.g. Topsoil.');
      return;
    }
    let quantity: number | undefined;
    if (qty.trim()) {
      quantity = parseAmount(qty);
      if (!(quantity > 0)) {
        showMessage('Check the quantity', 'Enter a number above 0, or leave it empty if you don’t know it yet.');
        return;
      }
    }
    markSaved();
    onSave({ name: name.trim(), quantity, unit: unit.trim() || undefined, status, vendorId, notes: notes.trim() || undefined });
  };

  const src = item?.source;

  return (
    <FormSheet visible={visible} title={item ? 'Edit Material' : 'Add Material'} saveLabel={item ? 'Done' : 'Add'} onSave={save} onClose={onClose}>
      <ListSection>
        <InputRow label="Material" value={name} onChangeText={setName} placeholder="e.g. Topsoil" autoCapitalize="sentences" />
        <InputRow label="Quantity" value={qty} onChangeText={setQty} placeholder="Unknown" keyboardType="decimal-pad" selectTextOnFocus />
        <InputRow label="Unit" value={unit} onChangeText={setUnit} placeholder="ea" autoCapitalize="none" />
      </ListSection>
      <ChipRow options={UNITS.map((u) => ({ key: u, label: u }))} value={unit || undefined} onChange={(u) => setUnit(u ?? '')} wrap={false} />
      {!!src && (
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: spacing.sm, marginLeft: spacing.xs }]}>
          Suggested from {src.number}{src.quantity ? ` (${formatQuantity(src.quantity)}${src.unit ? ` ${src.unit}` : ''} on the ${src.type === 'quote' ? 'quote' : 'change order'})` : ''}. Check the amount you actually need.
        </Text>
      )}

      <SheetLabel>STATUS</SheetLabel>
      <ChipRow options={MATERIAL_STATUS_ORDER.map((s) => ({ key: s, label: MATERIAL_STATUS_LABEL[s] }))} value={status} onChange={(s) => s && setStatus(s)} />

      {db.vendors.length > 0 && (
        <>
          <SheetLabel>FROM (OPTIONAL)</SheetLabel>
          <ChipRow options={db.vendors.map((v) => ({ key: v.id, label: v.name }))} value={vendorId} onChange={setVendorId} wrap={false} />
          <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 4, marginLeft: spacing.xs }]}>Leave empty to use the project’s vendor.</Text>
        </>
      )}

      <SheetLabel>INTERNAL NOTES</SheetLabel>
      <ListSection footer="Only you see these. They aren’t on quotes, invoices or the shared list.">
        <NoteField label="Internal notes" placeholder="e.g. Ask for the screened topsoil" value={notes} onChangeText={setNotes} />
      </ListSection>

      {item && <Button title="Remove Material" variant="ghost" onPress={onDelete} fullWidth />}
    </FormSheet>
  );
}
