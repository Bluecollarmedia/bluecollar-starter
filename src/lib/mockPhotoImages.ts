import type { ProjectPhoto } from '@/types/project';

/**
 * The current mock ProjectPhoto records use plain placehold.co rectangles
 * for fileUrl, which don't demonstrate the gallery's visual design. This
 * picks a realistic stock landscaping photo deterministically per photo id
 * so the UI can be evaluated properly. Once real job-site photos exist
 * (Supabase/R2), callers should go back to rendering photo.fileUrl directly
 * — this helper is a mock-mode-only stand-in, not a new photo source.
 */
const MOCK_PHOTO_IDS = [
  'photo-1613977257363-707ba9348227',
  'photo-1558904541-efa843a96f01',
  'photo-1600607687939-ce8a6c25118c',
  'photo-1571939228382-b2f2b585ce15',
  'photo-1600585154340-be6161a56a0c',
];

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export function getMockPhotoImageUri(photo: ProjectPhoto, width = 600): string {
  // Real photos (uploaded, or just picked on this device) show themselves.
  if (photo.fileUrl && !photo.fileUrl.includes('placehold.co')) return photo.fileUrl;
  const id = MOCK_PHOTO_IDS[hashCode(photo.id) % MOCK_PHOTO_IDS.length];
  return `https://images.unsplash.com/${id}?w=${width}&q=80`;
}
