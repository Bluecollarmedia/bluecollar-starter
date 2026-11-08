/**
 * Picking a photo (camera or library) with NO system crop screen: the phone's own crop screen crashed on iOS 27. Opened a moment
 * after the sheet that asked for it has closed (iOS can't show the picker while another modal is still leaving), the library
 * choice never asks for photo-library permission (the system picker doesn't need it), and every failure comes back as a sentence.
 */
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { keepPicked } from '@/lib/keepPickedFile';
import { tr } from '@/i18n';

export type PickedImage = { status: 'picked'; uri: string; width: number; height: number; mimeType?: string; fileName?: string; size?: number }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function pickImage(source: 'camera' | 'library', opts: { afterSheetMs?: number } = {}): Promise<PickedImage> {
  try {
    if (opts.afterSheetMs) await sleep(opts.afterSheetMs);
    if (source === 'camera' && Platform.OS !== 'web') {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return { status: 'error', message: tr("Camera access is needed to take a photo. You can turn it on in your phone's Settings app.") };
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 1 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };
    const a = result.assets[0];
    return { status: 'picked', uri: await keepPicked(a.uri), width: a.width, height: a.height, mimeType: a.mimeType, fileName: a.fileName ?? undefined, size: a.fileSize };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err ?? '');
    return { status: 'error', message: `${source === 'camera' ? tr("Couldn't open the camera. Please try again.") : tr("Couldn't open your photos. Please try again.")}${raw ? ` (${raw})` : ''}` };
  }
}
