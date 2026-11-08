import { Stack } from 'expo-router';
import { ScheduleProvider } from '@/providers/ScheduleProvider';
import { useMaterialReminders } from '@/hooks/useMaterialReminders';
import { useTruckReminders } from '@/hooks/useTruckReminders';

/**
 * Stack that sits above the (tabs) navigator. Screens declared here with
 * presentation: 'modal' are reachable from ANY tab (Dashboard quick actions,
 * a detail screen's own actions, etc.) without switching the selected bottom
 * tab, because they live outside the tab navigator's own route tree —
 * dismissing one always returns to whatever tab/screen was underneath.
 */
export default function OwnerLayout() {
  // Materials prep reminders on this phone (see lib/materialReminders.ts).
  useMaterialReminders(true);
  // Truck maintenance due-date reminders on this phone (see lib/truckReminders.ts).
  useTruckReminders(true);
  return (
    <ScheduleProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="worker-new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="project-new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="schedule" />
        <Stack.Screen name="schedule-create" options={{ presentation: 'modal' }} />
        <Stack.Screen name="search" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notification-center" options={{ presentation: 'modal' }} />
        <Stack.Screen name="service-requests" />
        <Stack.Screen name="our-work" />
        <Stack.Screen name="our-work-post" />
        <Stack.Screen name="our-work-highlights" />
        <Stack.Screen name="our-work-stories" />
        {/* The little weather button on the dashboard opens the full forecast over whatever is showing. */}
        <Stack.Screen name="weather" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
        {/* Company Resources: opened from More and from Workers, so it sits
            above the tabs (a normal push) and its forms are modals. */}
        <Stack.Screen name="resources" />
        <Stack.Screen name="resource-edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="resource-access" options={{ presentation: 'modal' }} />
        <Stack.Screen name="worker-access" options={{ presentation: 'modal' }} />
        {/* Crews: opened from Workers and from a worker's profile. */}
        <Stack.Screen name="crews" />
        <Stack.Screen name="crew-edit" options={{ presentation: 'modal' }} />
        {/* Customers: reached from More, and from project and maintenance
            property records, so it sits above the tabs like Resources. */}
        <Stack.Screen name="customers" />
        {/* Maintenance: New Route opens from the Maintenance tab and a property. */}
        <Stack.Screen name="route-new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="snow-property" />
        <Stack.Screen name="document" />
        <Stack.Screen name="document-new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="document-edit" options={{ presentation: 'modal' }} />
        {/* Maintenance property + contract form: opened from Maintenance and from a route. */}
        <Stack.Screen name="maintenance-property-edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="maintenance-service-add" options={{ presentation: 'modal' }} />
        {/* Snow Mode activity log: opened from the snow dashboard and settings. */}
        <Stack.Screen name="snow-activity" />
        {/* Reported problems: opened from the dashboard card, More, and a notification. */}
        {/* Brighton Weather storm outlook: opened from Settings (the owner writes it). */}
        <Stack.Screen name="storm-outlook" />
        <Stack.Screen name="issues" />
        <Stack.Screen name="issue-detail" />
        <Stack.Screen name="setup" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack>
    </ScheduleProvider>
  );
}
