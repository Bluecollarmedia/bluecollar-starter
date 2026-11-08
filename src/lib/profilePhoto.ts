/**
 * Picking a profile photo (camera or library) for every Edit Profile screen and the join-team sign-up.
 *
 * Three things here exist because picking silently failed on iPhones:
 *  - The picker is opened a moment AFTER the "Change Profile Photo" sheet has finished closing. iOS cannot show the picker
 *    while another modal is still on its way out, and it just doesn't appear.
 *  - Choosing from the library does not ask for photo-library permission. The system photo picker never needs it, and a
 *    denied permission used to block a perfectly good choice.
 *  - Nothing throws out of here: every failure comes back as a sentence the screen can show.
 */
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { keepPicked } from '@/lib/keepPickedFile';
import { tr } from '@/i18n';
import { squareAvatarUri } from '@/lib/avatarCrop';

export type ProfilePhotoSource = 'camera' | 'library';
export type ProfilePhotoResult = { status: 'picked'; uri: string; raw: { uri: string; width: number; height: number } } | { status: 'cancelled' } | { status: 'error'; message: string };

/** How long to wait after closing a sheet before opening the picker. */
export const PICKER_AFTER_SHEET_MS = 650;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function chooseProfilePhoto(source: ProfilePhotoSource, opts: { afterSheetMs?: number } = {}): Promise<ProfilePhotoResult> {
  try {
    if (opts.afterSheetMs) await sleep(opts.afterSheetMs);

    if (source === 'camera' && Platform.OS !== 'web') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        return { status: 'error', message: tr('Camera access is needed to take a profile photo. You can turn it on in your phone\'s Settings app.') };
      }
    }

    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.8 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };

    const a = { ...result.assets[0], uri: await keepPicked(result.assets[0].uri) };
    // `uri` is the automatic centred square (the fallback); `raw` is the untouched picture for the crop screen.
    return { status: 'picked', uri: await squareAvatarUri(a.uri, a.width, a.height), raw: { uri: a.uri, width: a.width, height: a.height } };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err ?? '');
    console.warn('[profile photo] could not pick', err);
    return {
      status: 'error',
      message: `${source === 'camera' ? tr("Couldn't open the camera. Please try again.") : tr("Couldn't open your photos. Please try again.")}${raw ? ` (${raw})` : ''}`,
    };
  }
}
