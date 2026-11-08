/** A project's vendor and pickup details for its materials. */

import { useKeepDraft } from '@/hooks/useKeepDraft';
import React, { useEffect, useState } from 'react';
import { Button, ListSection } from '@/components/ui';
import { InputRow, NoteField } from '@/components/financials/FormBits';
import { FormSheet, ChipRow, SheetLabel } from './FormSheet';
import { db } from '@/data/store';
import type { MaterialPlan } from '@/types/materials';

export type PickupDraft = Pick<MaterialPlan, 'vendorId' | 'pickupLocation' | 'pickupInstructions' | 'handlingNotes'>;

export function PickupSheet({ visible, plan, onSave, onNewVendor, onClose }: {
  visible: boolean;
  plan: MaterialPlan;
  onSave: (d: PickupDraft) => void;
  onNewVendor: () => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<PickupDraft>({});
  // Swipe the sheet down and open it again: what you typed is still there (until it is saved or you leave the page).
  const markSaved = useKeepDraft(visible, 'pickup', () => setD({ vendorId: plan.vendorId, pickupLocation: plan.pickupLocation, pickupInstructions: plan.pickupInstructions, handlingNotes: plan.handlingNotes }));

  const vendor = db.vendors.find((v) => v.id === d.vendorId);

  return (
    <FormSheet
      visible={visible}
      title="Vendor & Pickup"
      onSave={() => { markSaved(); onSave({
        vendorId: d.vendorId,
        pickupLocation: d.pickupLocation?.trim() || undefined,
        pickupInstructions: d.pickupInstructions?.trim() || undefined,
        handlingNotes: d.handlingNotes?.trim() || undefined,
      }); }}
      onClose={onClose}
    >
      <SheetLabel>PREFERRED VENDOR</SheetLabel>
      {db.vendors.length > 0 && (
        <ChipRow
          options={db.vendors.map((v) => ({ key: v.id, label: v.name }))}
          value={d.vendorId}
          onChange={(id) => {
            const v = db.vendors.find((x) => x.id === id);
            setD((x) => ({
              ...x,
              vendorId: id,
              // Fill in from the saved vendor when these are still empty.
              pickupLocation: x.pickupLocation || v?.address,
              pickupInstructions: x.pickupInstructions || v?.pickupInstructions,
            }));
          }}
        />
      )}
      <Button title="New Vendor" icon="plus" variant="ghost" onPress={onNewVendor} style={{ alignSelf: 'flex-start' }} />

      <SheetLabel>PICKUP</SheetLabel>
      <ListSection>
        <InputRow label="Location" value={d.pickupLocation ?? ''} onChangeText={(t) => setD((x) => ({ ...x, pickupLocation: t }))} placeholder={vendor?.address ?? 'Where to pick up'} />
      </ListSection>
      <ListSection title="PICKUP INSTRUCTIONS">
        <NoteField label="Pickup instructions" placeholder={vendor?.pickupInstructions ?? 'e.g. Call ahead, bring the trailer'} value={d.pickupInstructions ?? ''} onChangeText={(t) => setD((x) => ({ ...x, pickupInstructions: t }))} />
      </ListSection>
      <ListSection title="HANDLING OR DELIVERY NOTES">
        <NoteField label="Handling notes" placeholder="e.g. Keep sod shaded, lay within 24 hours" value={d.handlingNotes ?? ''} onChangeText={(t) => setD((x) => ({ ...x, handlingNotes: t }))} />
      </ListSection>
    </FormSheet>
  );
}
