/**
 * A legal page shown as a pop-up over the current screen instead of navigating to it. Used where leaving the screen would lose something:
 * the Terms / Privacy links inside a sign-up form (a half-filled form must survive reading the Terms) and the links at the foot of the
 * welcome screen. Closing it returns to exactly where the person was.
 */
import React from 'react';
import { Modal } from 'react-native';
import { LegalScreen } from '@/components/legal/LegalScreen';
import type { LegalDoc } from '@/legal/legalContent';

export function LegalModal({ slug, onClose }: { slug: LegalDoc['slug'] | null; onClose: () => void }) {
  return (
    <Modal visible={!!slug} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      {slug ? <LegalScreen slug={slug} onClose={onClose} /> : null}
    </Modal>
  );
}
