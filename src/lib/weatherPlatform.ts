import { Platform } from 'react-native';
import { WEATHER_EXPERIENCE_BUILT } from '@/lib/launchRoute';

/** The public Weather is for the phone app only. On the website nobody is ever sent to it, whatever the owner's switch says. */
export const WEATHER_ON_THIS_DEVICE = WEATHER_EXPERIENCE_BUILT && Platform.OS !== 'web';
