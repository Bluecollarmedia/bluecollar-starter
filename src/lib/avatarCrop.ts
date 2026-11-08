// Profile pictures are cut to a centred square by the app itself. The phone's built-in crop screen
// (allowsEditing) is not used: it is where picking a profile photo was crashing on iOS 27.

/** The biggest centred square in a width x height picture. */
export function centerSquare(width: number, height: number): { originX: number; originY: number; size: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  const size = Math.floor(Math.min(width, height));
  return { originX: Math.floor((width - size) / 2), originY: Math.floor((height - size) / 2), size };
}

/** Longest side of the saved profile picture. Plenty for an avatar, small to upload. */
export const AVATAR_PIXELS = 640;

/**
 * Crops a picked picture to a centred square and shrinks it. Never throws: if anything goes wrong the
 * original picture is used (a non-square picture is better than no picture).
 */
export async function squareAvatarUri(uri: string, width?: number, height?: number): Promise<string> {
  try {
    const box = centerSquare(width ?? 0, height ?? 0);
    if (!box) return uri;
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const context = ImageManipulator.manipulate(uri)
      .crop({ originX: box.originX, originY: box.originY, width: box.size, height: box.size })
      .resize({ width: Math.min(box.size, AVATAR_PIXELS) });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    return saved.uri || uri;
  } catch (err) {
    console.warn('[avatar] crop failed, using the original picture', err);
    return uri;
  }
}

/**
 * Crops a picture to the square the person chose on the crop screen and shrinks it. Same safety as squareAvatarUri: if anything
 * goes wrong the caller gets null and uses the automatic centred square instead.
 */
export async function cropAvatarToBox(uri: string, box: { originX: number; originY: number; size: number }): Promise<string | null> {
  try {
    if (!(box.size > 0)) return null;
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const context = ImageManipulator.manipulate(uri)
      .crop({ originX: box.originX, originY: box.originY, width: box.size, height: box.size })
      .resize({ width: Math.min(box.size, AVATAR_PIXELS) });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    return saved.uri || null;
  } catch (err) {
    console.warn('[avatar] crop failed', err);
    return null;
  }
}
