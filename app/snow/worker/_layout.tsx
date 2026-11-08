import { Stack } from 'expo-router';
import { AdminBackPill } from '@/components/admin/AdminBackPill';
import { setAdminWorksSnow } from '@/lib/adminSnowWork';

/** Stack over the worker Snow Mode tabs. Detail screens go beside (tabs) as they're built. */
export default function SnowWorkerLayout() {
  return (
    <>
      {/* An admin working their Snow route gets a way back to the admin view. */}
      <AdminBackPill to="/snow/owner" onBack={() => setAdminWorksSnow(false)} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="edit-profile" />
        <Stack.Screen name="past-storms" />
        <Stack.Screen name="weather" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}
