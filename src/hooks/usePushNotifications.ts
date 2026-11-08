/**
 * Registers the phone for push once someone is signed in, and opens the
 * right screen when a push is tapped (also when the tap launched the app).
 */

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { registerForPush, type PushData } from '@/lib/push';
import { findRow, updateRow } from '@/data/store';
import { ownerNotificationTarget } from '@/lib/notificationTarget';
import type { UserRole } from '@/types';

const DOC_TYPES = new Set(['quote', 'change_order', 'invoice']);

function targetFor(role: UserRole, d: PushData): string | { pathname: string; params: Record<string, string> } {
  const type = d.linkedEntityType ?? '';
  const id = d.linkedEntityId ?? '';
  if (role === 'owner' || role === 'admin') {
    const target = ownerNotificationTarget({ eventType: d.eventType, linkedEntityType: type, linkedEntityId: id });
    if (target) return target;
    return '/(owner)/notification-center';
  }
  if (role === 'customer') {
    if (DOC_TYPES.has(type) && id) return { pathname: '/(customer)/document', params: { kind: type, id } };
    if (type === 'snow_visit' || type === 'snow_property') return '/(customer)/snow-updates';
    return '/(customer)';
  }
  // A crew notice (update 82: storm dispatched, you were added to a route) opens the snow shell's My Route.
  if (type === 'snow_route') return '/snow/worker';
  return '/(worker)/notifications';
}

function useNativePushNotifications(role: UserRole | undefined, active: boolean) {
  const router = useRouter();
  const segments = useSegments();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef(new Set<string>());
  // The snow shell counts as "the role's screens are showing" too, so a tap isn't ignored in Snow Mode.
  const inRoleGroup = !!role && (segments[0] === `(${role === 'admin' ? 'owner' : role})` || segments[0] === 'snow');

  useEffect(() => {
    if (active) registerForPush();
  }, [active, role]);

  // Clear the app icon's badge whenever the app is opened.
  useEffect(() => {
    Notifications.setBadgeCountAsync(0).catch(() => {});
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') Notifications.setBadgeCountAsync(0).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Wait until the role's screens are showing, so the redirect after
    // sign-in doesn't replace the screen we open.
    if (!response || !role || !active || !inRoleGroup) return;
    const key = response.notification.request.identifier;
    if (handled.current.has(key)) return;
    handled.current.add(key);

    const data = (response.notification.request.content.data ?? {}) as PushData;
    if (data.notificationId && findRow('app_notifications', data.notificationId)?.status === 'unread') {
      updateRow('app_notifications', data.notificationId, { status: 'read', readAt: new Date().toISOString() });
    }
    router.push(targetFor(role, data) as any);
    Notifications.clearLastNotificationResponse();
  }, [response, role, active, inRoleGroup]);
}

/** Push is phone-only; on the web this does nothing. */
export const usePushNotifications: (role: UserRole | undefined, active: boolean) => void =
  Platform.OS === 'web' ? () => {} : useNativePushNotifications;
