import React from 'react';
import { useRouter, useSegments } from 'expo-router';
import { ListSection, ListRow } from '@/components/ui';
import { legalHubPath } from '@/lib/legalPaths';
import { useT } from '@/i18n';

/**
 * The single "Legal & Support" row for any Settings screen. It opens the Legal & Support page that belongs to the area the person is in
 * (owner, worker, customer or Snow), so Settings stays underneath and Back returns to it.
 */
export function LegalSection() {
  const t = useT();
  const router = useRouter();
  const segments = useSegments() as string[];
  return (
    <ListSection>
      <ListRow
        icon="shield"
        title={t('Legal & Support')}
        subtitle={t('Privacy Policy, Terms of Use and Help')}
        showChevron
        onPress={() => router.push(legalHubPath(segments[0]) as any)}
      />
    </ListSection>
  );
}
