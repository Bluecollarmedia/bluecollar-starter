import { Stack } from 'expo-router';
import { SnowThemeScope } from '@/providers/ThemeProvider';

/**
 * Snow Mode. Its own shells for owner, worker and customer, kept apart from
 * the landscaping groups so neither mode's screens leak into the other's
 * navigation. app/_layout.tsx decides who lands here (see useModeAccess);
 * the database's access rules decide what data they can read.
 */
export default function SnowLayout() {
  return (
    <SnowThemeScope>
      <Stack screenOptions={{ headerShown: false }} />
    </SnowThemeScope>
  );
}
