/**
 * A picture for a video: grabs a frame from the video itself, so a video tile
 * never has to be an empty box with an icon. Shows `fallback` (the old icon)
 * while the frame loads, on web, or if the video cannot be read.
 */
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, type VideoThumbnail } from 'expo-video';

// One frame per video for the whole session, so scrolling back never re-reads it.
const frames = new Map<string, VideoThumbnail>();

interface Props {
  uri: string;
  style?: StyleProp<ViewStyle>;
  fallback?: React.ReactNode;
}

function Frame({ uri, style, fallback }: Props) {
  const [frame, setFrame] = React.useState<VideoThumbnail | null>(frames.get(uri) ?? null);
  const player = useVideoPlayer(frame ? null : uri, (p) => {
    p.muted = true;
    p.pause();
  });

  React.useEffect(() => {
    if (frame) return;
    let live = true;
    const grab = async () => {
      // A frame a second in skips a black first frame; a very short video falls back to the start.
      for (const at of [1, 0]) {
        try {
          const [first] = await player.generateThumbnailsAsync(at, { maxWidth: 480 });
          if (first && live) {
            frames.set(uri, first);
            setFrame(first);
            return;
          }
        } catch {
          // try the next time, then give up and keep the icon
        }
      }
    };
    if (player.status === 'readyToPlay') {
      void grab();
      return () => { live = false; };
    }
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        sub.remove();
        void grab();
      }
    });
    return () => { live = false; sub.remove(); };
  }, [frame, player, uri]);

  if (!frame) return <View style={[styles.center, style]}>{fallback}</View>;
  return <Image source={frame} style={[StyleSheet.absoluteFill, style as object]} contentFit="cover" />;
}

export function VideoThumb(props: Props) {
  // Frames are only made on the phone; the web build keeps the icon.
  if (Platform.OS === 'web' || !props.uri) return <View style={[styles.center, props.style]}>{props.fallback}</View>;
  return <Frame {...props} />;
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
