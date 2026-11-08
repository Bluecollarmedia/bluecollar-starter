import { Stack } from 'expo-router';

/**
 * Stack that sits above the (tabs) navigator so the project detail screen
 * can be pushed — native tabs can't navigate to routes that aren't
 * declared as tab triggers.
 */
export default function CustomerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="project" />
      <Stack.Screen name="document" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="weather" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="request" />
    </Stack>
  );
}
