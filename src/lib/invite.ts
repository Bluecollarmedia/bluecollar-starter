/**
 * Private invite links (supabase/updates/078_invite_links.sql), sent by text message (no email service needed).
 *
 * The owner types a name and a phone number, then either copies the link or opens the phone's Messages app with the text and
 * link filled in. The link works once and expires after 7 days; tapping it opens the sign-up page for that one person.
 */

import { Linking, Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { config } from '@/lib/config';

/** The link people tap. On the web the page is /invite/<token>; without a web address the app's own link scheme is used. */
export function inviteLinkUrl(token: string): string {
  return config.webUrl ? `${config.webUrl}/invite/${token}` : `brighton-lawn://invite/${token}`;
}

export function inviteMessage(url: string, companyName?: string, personName?: string, kind: 'worker' | 'customer' = 'worker'): string {
  const hi = personName?.trim() ? `Hi ${personName.trim().split(' ')[0]}! ` : '';
  const company = companyName?.trim() || 'our company';
  return kind === 'customer'
    ? `${hi}${company} invited you to see your project on the Brighton Lawn + Landscape app. This private link works once: ${url}`
    : `${hi}You're invited to join ${company} on the Brighton Lawn + Landscape app. Tap this private link to set up your login (it works once): ${url}`;
}

/** Opens Messages with the invite filled in (to `phone` if given). Falls back to the share sheet. */
export async function textInvite(message: string, phone?: string): Promise<void> {
  const to = (phone ?? '').replace(/[^\d+]/g, '');
  if (Platform.OS === 'web') {
    await copyText(message);
    return;
  }
  // iOS uses "&body=", Android uses "?body=".
  const url = `sms:${to}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`;
  try {
    await Linking.openURL(url);
  } catch {
    await Share.share({ message });
  }
}

export async function copyText(text: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      await (globalThis as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }).navigator?.clipboard?.writeText(text);
    } catch {}
    return;
  }
  await Clipboard.setStringAsync(text);
}
