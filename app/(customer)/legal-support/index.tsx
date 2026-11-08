import { LegalHubScreen } from '@/components/legal/LegalHubScreen';

/** Legal & Support, inside this area so Back returns to Settings. */
export default function LegalSupportHub() {
  return <LegalHubScreen basePath="/(customer)/legal-support" />;
}
