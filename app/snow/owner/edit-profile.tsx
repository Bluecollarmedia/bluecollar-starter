import { EditProfileScreen } from '@/components/account/EditProfileScreen';

/** Snow Mode owner: edit your own name, phone and photo without leaving Snow Mode (the landscaping route sent you to the Dashboard). */
export default function SnowOwnerEditProfileScreen() {
  return <EditProfileScreen requireAll={false} backLabel="Settings" />;
}
