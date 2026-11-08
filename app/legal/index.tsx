import { LegalHubScreen } from '@/components/legal/LegalHubScreen';

/** The public Legal & Support page (signed out, and the web address). Signed-in people use their own area's copy. */
export default function PublicLegalHub() {
  return <LegalHubScreen basePath="/legal" />;
}
