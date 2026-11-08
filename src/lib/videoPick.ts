import * as ImagePicker from 'expo-image-picker';

/**
 * How a video is taken from the phone, everywhere a video can be picked or recorded (tasks, maintenance, Snow, Our Work, stories).
 * iOS hands the video over already encoded at 1280 x 720 with its own encoder (one pass, the quality Apple uses for its presets).
 * The app then sends it as it is: a file that is already 720p or smaller is never encoded a second time (see mediaCompress.ts).
 * Picked on 2026-10-28 after the in-app compressor's output looked blurry; the "medium" picker setting (480 x 360) is never used.
 */
export const VIDEO_PICK_OPTIONS: Pick<ImagePicker.ImagePickerOptions, 'videoExportPreset' | 'videoQuality'> = {
  videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
  videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
};
