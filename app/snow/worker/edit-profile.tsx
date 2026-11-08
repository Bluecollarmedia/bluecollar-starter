import { EditProfileScreen } from '@/components/account/EditProfileScreen';

/**
 * Snow worker: edit your own name, phone and profile photo. Same screen the
 * landscaping workers use. A new photo is uploaded to the app's photo storage
 * before it is saved, and the save stops with a message if the upload fails,
 * so a picture is never shown as saved when it only exists on this phone.
 * Only a name is required here (a photo and phone are encouraged, not forced).
 */
export default function SnowWorkerEditProfileScreen() {
  return <EditProfileScreen requireAll={false} backLabel="Settings" />;
}
