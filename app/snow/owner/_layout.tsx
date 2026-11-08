import { Stack } from 'expo-router';

/** Stack over the owner Snow Mode tabs. Detail screens go beside (tabs) as they're built. */
export default function SnowOwnerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="storm-new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="storm/[id]" />
      <Stack.Screen name="live/[id]" />
      <Stack.Screen name="live-route/[id]" />
      <Stack.Screen name="property" />
      <Stack.Screen name="activity" />
      <Stack.Screen name="hours" />
      <Stack.Screen name="review" />
      <Stack.Screen name="message-customers" />
      <Stack.Screen name="manage-storms" />
      <Stack.Screen name="service-requests" />
      <Stack.Screen name="our-work" />
      <Stack.Screen name="our-work-post" />
      <Stack.Screen name="our-work-highlights" />
      <Stack.Screen name="our-work-stories" />
      <Stack.Screen name="weather" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="storm-outlook" />
      <Stack.Screen name="crews" />
      <Stack.Screen name="crew-edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="edit-profile" />
    </Stack>
  );
}
