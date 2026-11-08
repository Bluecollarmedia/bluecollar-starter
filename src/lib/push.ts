/**
 * Push notifications.
 *
 * Every in-app notification (app_notifications) is also delivered to the
 * person's phone: after sign-in the phone registers its Expo push token
 * (register_push_token), and the database's send-notification Edge Function
 * pushes each new notification to it. On sign-out the phone is removed so the
 * next person to sign in on it doesn't get the previous person's alerts.
 *
 * Push needs a real device build (not Expo Go, not the web).
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase, isSupabaseConfigured } from './supabase';
import { logger } from './logger';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

if (supported) {
  // Show the banner even while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

let registeredToken: string | null = null;

/** Asks for permission (once) and registers this phone for the signed-in person. */
export async function registerForPush(): Promise<void> {
  if (!supported || !isSupabaseConfigured) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notifications',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (error) throw error;
    registeredToken = token;
  } catch (e) {
    // Simulators and builds without push credentials end up here.
    logger.warn('Push registration skipped', { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Removes this phone before signing out. */
export async function unregisterForPush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  try {
    await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {}
}

/** What a push carries (set by the send-notification Edge Function). */
export interface PushData {
  notificationId?: string;
  eventType?: string;
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
}
