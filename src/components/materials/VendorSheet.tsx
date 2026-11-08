/** Add / edit a saved vendor or pickup place (reused across projects). */

import { useKeepDraft } from '@/hooks/useKeepDraft';
import React, { useEffect, useState } from 'react';
import { Button, ListSection } from '@/components/ui';
import { InputRow, NoteField } from '@/components/financials/FormBits';
import { showMessage } from '@/components/financials/ActionSheet';
import { FormSheet, SheetLabel } from './FormSheet';
import type { VendorInput } from '@/data/materials';
import type { MaterialVendor } from '@/types/materials';

export function VendorSheet({ visible, vendor, onSave, onDelete, onClose }: {
  visible: boolean;
  vendor: MaterialVendor | null;
  onSave: (v: VendorInput) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [f, setF] = useState<VendorInput>({ name: '' });
  // Swipe the sheet down and open it again: what you typed is still there (until it is saved or you leave the page).
  const markSaved = useKeepDraft(visible, vendor?.id ?? 'new', () => setF(vendor ? { ...vendor } : { name: '' }));
  const set = (k: keyof VendorInput) => (t: string) => setF((x) => ({ ...x, [k]: t }));

  const save = () => {
    if (!f.name.trim()) {
      showMessage('Name needed', 'Enter the vendor or supply yard’s name.');
      return;
    }
    markSaved();
    onSave(f);
  };

  return (
    <FormSheet visible={visible} title={vendor ? 'Edit Vendor' : 'New Vendor'} onSave={save} onClose={onClose}>
      <ListSection>
        <InputRow label="Name" value={f.name} onChangeText={set('name')} placeholder="e.g. Greenway Supply" autoCapitalize="words" />
        <InputRow label="Contact" value={f.contactName ?? ''} onChangeText={set('contactName')} placeholder="Optional" autoCapitalize="words" />
        <InputRow label="Phone" value={f.phone ?? ''} onChangeText={set('phone')} placeholder="Optional" keyboardType="phone-pad" />
        <InputRow label="Email" value={f.email ?? ''} onChangeText={set('email')} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" />
        <InputRow label="Address" value={f.address ?? ''} onChangeText={set('address')} placeholder="Optional" autoCapitalize="words" />
      </ListSection>
      <SheetLabel>PICKUP INSTRUCTIONS</SheetLabel>
      <ListSection>
        <NoteField label="Pickup instructions" placeholder="e.g. Main entrance, bring the trailer" value={f.pickupInstructions ?? ''} onChangeText={set('pickupInstructions')} />
      </ListSection>
      {vendor && onDelete && <Button title="Delete Vendor" variant="ghost" onPress={onDelete} fullWidth />}
    </FormSheet>
  );
}
