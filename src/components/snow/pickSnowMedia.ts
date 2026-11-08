/**
 * Picking reference photos/videos for a snow property service. Same camera /
 * library choice and limits as task media (60-second videos, 50 MB per file).
 */
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VIDEO_PICK_OPTIONS } from '@/lib/videoPick';
import { keepPicked } from '@/lib/keepPickedFile';
import { formatBytes } from '@/types/storage';
import { tr } from '@/i18n';
import type { SnowMediaDraft } from '@/data/snowProperties';

export const MAX_SNOW_VIDEO_SECONDS = 60;
export const MAX_SNOW_FILE_BYTES = 50 * 1024 * 1024;
/** Most files one pick can add (more can be added afterwards). */
const MAX_PER_PICK = 10;

export function notify(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

function chooseSource(): Promise<'camera' | 'library' | null> {
  if (Platform.OS === 'web') return Promise.resolve('library');
  return new Promise((resolve) => {
    Alert.alert(tr('Add reference photo or video'), undefined, [
      { text: tr('Take Photo or Video'), onPress: () => resolve('camera') },
      { text: tr('Choose from Library'), onPress: () => resolve('library') },
      { text: tr('Cancel'), style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

export async function pickSnowMedia(): Promise<SnowMediaDraft[]> {
  const source = await chooseSource();
  if (!source) return [];

  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    notify(
      source === 'camera' ? tr('Camera access is off') : tr('Photo access is off'),
      tr('Turn it on for Brighton Lawn in the Settings app to add reference photos and videos.'),
    );
    return [];
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images', 'videos'],
    quality: 1,
    videoMaxDuration: MAX_SNOW_VIDEO_SECONDS,
    ...VIDEO_PICK_OPTIONS,
    allowsMultipleSelection: source === 'library',
    selectionLimit: MAX_PER_PICK,
  };
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return [];

  const drafts: SnowMediaDraft[] = [];
  const skipped: string[] = [];
  for (const asset of result.assets.slice(0, MAX_PER_PICK)) {
    const mediaType = asset.type === 'video' ? 'video' : 'image';
    const sizeBytes = asset.fileSize ?? (asset as { file?: File }).file?.size;
    if (mediaType === 'video' && asset.duration && asset.duration / 1000 > MAX_SNOW_VIDEO_SECONDS + 1) {
      skipped.push(tr('A video is longer than {n} seconds. Trim it and try again.', { n: MAX_SNOW_VIDEO_SECONDS }));
      continue;
    }
    if (sizeBytes && sizeBytes > MAX_SNOW_FILE_BYTES) {
      const size = formatBytes(sizeBytes);
      const max = formatBytes(MAX_SNOW_FILE_BYTES);
      skipped.push(mediaType === 'video'
        ? tr('A video is {size}; the most one file can be is {max}.', { size, max })
        : tr('A image is {size}; the most one file can be is {max}.', { size, max }));
      continue;
    }
    drafts.push({ uri: await keepPicked(asset.uri, mediaType), mediaType, mimeType: asset.mimeType ?? undefined, sizeBytes });
  }
  if (skipped.length > 0) notify(tr("Some files weren't added"), skipped.join('\n'));
  return drafts;
}
