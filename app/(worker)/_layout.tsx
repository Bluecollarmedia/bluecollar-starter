import { Stack } from 'expo-router';
import { WorkerProvider } from '@/providers/WorkerProvider';
import { AdminBackPill } from '@/components/admin/AdminBackPill';

/**
 * Stack that sits above the (tabs) navigator. Detail screens (task, job,
 * day, edit profile, notifications) live here rather than inside the tab
 * navigator because native tabs can't navigate to routes that aren't
 * declared as tab triggers — pushing them from a tab silently did nothing.
 */
export default function WorkerLayout() {
  return (
    <WorkerProvider>
      <AdminBackPill />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="job/[id]" />
        <Stack.Screen name="day/[date]" />
        <Stack.Screen name="edit-profile" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="my-resources" />
        <Stack.Screen name="resource/[id]" />
        <Stack.Screen name="weather" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      </Stack>
    </WorkerProvider>
  );
}
