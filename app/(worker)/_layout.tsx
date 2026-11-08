import { Redirect, Stack, useSegments } from 'expo-router';
import { WorkerProvider } from '@/providers/WorkerProvider';
import { useWorkerLanding } from '@/hooks/useWorkerLanding';
import { AdminBackPill } from '@/components/admin/AdminBackPill';

/** Maintenance screens: open to a worker who works Maintenance or was put on a route. */
const MAINTENANCE_ONLY = ['maintenance', 'maintenance-stop'];

/**
 * Stack that sits above the (tabs) navigator. Detail screens (task, job,
 * day, edit profile, notifications) live here rather than inside the tab
 * navigator because native tabs can't navigate to routes that aren't
 * declared as tab triggers — pushing them from a tab silently did nothing.
 *
 * A worker who works Maintenance and nothing else (and has no project job coming up) lands on the Maintenance home
 * (`maintenance/`: Today, Route, Activity, Settings). Everyone else lands on the main home. Nobody is locked out of work they
 * were assigned: project screens are open to every worker, and a worker put on a route can open the route screens.
 */
export default function WorkerLayout() {
  const segments = useSegments() as string[];
  const { landing, maintenanceAccess } = useWorkerLanding();
  // segments[1] is the screen under (worker); undefined means the default (tabs) index.
  const screen = segments[1] ?? '(tabs)';

  if (landing === 'maintenance' && screen === '(tabs)') {
    return <Redirect href={'/(worker)/maintenance' as any} />;
  }
  if (!maintenanceAccess && MAINTENANCE_ONLY.includes(screen)) {
    return <Redirect href={'/(worker)' as any} />;
  }

  return (
    <WorkerProvider>
      <AdminBackPill />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="maintenance" />
        <Stack.Screen name="maintenance-stop/[id]" />
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
