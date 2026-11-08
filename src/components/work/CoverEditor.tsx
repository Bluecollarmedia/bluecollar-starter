/**
 * Choose the cover of a post (the picture people see in the grid): any photo from the post, a frame of one of its videos (slide along the strip of
 * frames to pick the moment), or a picture from your phone. Then zoom and crop it to the square (the app's crop screen: drag to move, pinch or the
 * − / + buttons to zoom). "Use the first picture" puts it back to automatic.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image as RNImage, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, InlineNotice, OptimizedImage } from '@/components/ui';
import { PhotoCropper, type PickedImage } from '@/components/media/PhotoCropper';
import { videoFrameAt, waitUntilReady } from '@/data/portfolioUpload';
import { keepPicked } from '@/lib/keepPickedFile';
import { fractionOf, formatDuration, frameTimes, timeAtFraction } from '@/lib/portfolio';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

export interface CoverSource { key: string; kind: 'photo' | 'video'; uri: string; thumb: string | null; durationS: number | null }

type Step = 'choose' | 'frame' | 'crop';

export function CoverEditor({ visible, sources, onCancel, onDone }: {
  visible: boolean;
  sources: CoverSource[];
  onCancel: () => void;
  /** A cropped square picture on the phone, or null to go back to the automatic cover. */
  onDone: (croppedUri: string | null) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [step, setStep] = useState<Step>('choose');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState<CoverSource | null>(null);
  const [crop, setCrop] = useState<PickedImage | null>(null);

  useEffect(() => { if (visible) { setStep('choose'); setProblem(null); setVideo(null); setCrop(null); } }, [visible]);

  // The crop screen is a sheet inside this sheet. iOS cannot close the outer one while the inner one is still up (it leaves a blank white
  // sheet behind), so the crop sheet is closed first and the result is handed on a moment later.
  function finish(croppedUri: string | null) {
    setCrop(null);
    setStep('choose');
    setTimeout(() => onDone(croppedUri), 450);
  }

  async function openCropFor(uri: string) {
    setBusy(true);
    try {
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => RNImage.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject));
      setCrop({ uri, width: size.width, height: size.height });
      setStep('crop');
    } catch {
      setProblem("Couldn't open that picture.");
    } finally {
      setBusy(false);
    }
  }

  function choose(s: CoverSource) {
    setProblem(null);
    if (s.kind === 'video') { setVideo(s); setStep('frame'); } else void openCropFor(s.uri);
  }

  async function upload() {
    setProblem(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setProblem('Turn on photo access for Brighton Lawn in the Settings app.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (r.canceled || !r.assets[0]) return;
    await openCropFor(await keepPicked(r.assets[0].uri, 'image'));
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg }}>
        <View style={styles.head}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>{step === 'frame' ? 'Pick a frame' : 'Cover and crop'}</Text>
          <Pressable onPress={step === 'frame' ? () => setStep('choose') : onCancel} accessibilityRole="button" hitSlop={10}><Text style={[typeScale.labelLarge, { color: colors.primary, fontWeight: '700' }]}>{step === 'frame' ? 'Back' : 'Cancel'}</Text></Pressable>
        </View>

        {step === 'choose' ? (
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'], gap: spacing.md }}>
            <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>This is the picture people see in the grid. Pick one from your post, a frame of a video, or a picture from your phone.</Text>
            {problem ? <InlineNotice icon="alert-circle" tone="error" text={problem} /> : null}
            <View style={styles.grid}>
              {sources.map((s) => (
                <Pressable key={s.key} onPress={() => choose(s)} accessibilityRole="button" accessibilityLabel={s.kind === 'video' ? 'Pick a frame of this video' : 'Use this photo'} style={[styles.tile, { backgroundColor: colors.backgroundTertiary, width: (width - spacing.lg * 2 - 8 * 2) / 3 }]}>
                  {s.thumb || s.kind === 'photo' ? <OptimizedImage source={s.thumb ?? s.uri} style={StyleSheet.absoluteFill} /> : <Icon name="video" size={22} color={colors.textSecondary} />}
                  {s.kind === 'video' ? <View style={styles.vid}><Icon name="play" size={12} color="#FFFFFF" /><Text style={styles.vidText}>{formatDuration(s.durationS)}</Text></View> : null}
                </Pressable>
              ))}
            </View>
            <Button title="Upload a picture from my phone" variant="secondary" onPress={upload} loading={busy} />
            <Button title="Use the first picture (automatic)" variant="secondary" onPress={() => finish(null)} />
          </ScrollView>
        ) : null}

        {step === 'frame' && video ? <FramePicker video={video} onPicked={(f) => { setCrop(f); setStep('crop'); }} onProblem={setProblem} problem={problem} /> : null}
      </View>

      <PhotoCropper image={step === 'crop' ? crop : null} aspect={1} title="Crop the cover" onCancel={() => setStep(video ? 'frame' : 'choose')} onDone={finish} />
    </Modal>
  );
}

/** A large picture of the chosen moment, and a strip of small frames along the video: slide your finger along it to choose. */
function FramePicker({ video, onPicked, onProblem, problem }: { video: CoverSource; onPicked: (f: PickedImage) => void; onProblem: (m: string | null) => void; problem: string | null }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const duration = video.durationS ?? 0;
  const stripW = width - spacing.lg * 2;
  const times = useMemo(() => frameTimes(duration, 8), [duration]);
  const [thumbs, setThumbs] = useState<unknown[]>([]);
  const [t, setT] = useState(Math.min(duration / 2, 1));
  const [big, setBig] = useState<unknown | null>(null);
  const [busy, setBusy] = useState(false);
  const player = useRef<import('expo-video').VideoPlayer | null>(null);
  const live = useRef({ duration, stripW });
  live.current = { duration, stripW };

  // a player used only to read frames from
  useEffect(() => {
    let alive = true;
    try {
      const { createVideoPlayer } = require('expo-video') as typeof import('expo-video');
      const p = createVideoPlayer(video.uri);
      player.current = p;
      // The frames can only be read once the video has loaded; wait for that first (a frame asked for too early fails on iOS).
      void waitUntilReady(p).then((ok) => {
        if (!alive) return;
        if (!ok) { onProblem("Couldn't read frames from this video."); return; }
        return p.generateThumbnailsAsync(times, { maxWidth: 200 }).then((r) => { if (alive) setThumbs(r); });
      }).catch(() => { if (alive) onProblem("Couldn't read frames from this video."); });
    } catch { onProblem("Couldn't read frames from this video."); }
    return () => { alive = false; try { player.current?.release(); } catch { /* gone */ } player.current = null; };
  }, [video.uri, times, onProblem]);

  // the big picture follows the finger, a moment after it stops moving
  useEffect(() => {
    const timer = setTimeout(() => {
      void player.current?.generateThumbnailsAsync(t, { maxWidth: 720 }).then((r) => setBig(r[0] ?? null)).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [t]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => setT(timeAtFraction(e.nativeEvent.locationX / live.current.stripW, live.current.duration)),
    onPanResponderMove: (e) => setT(timeAtFraction(e.nativeEvent.locationX / live.current.stripW, live.current.duration)),
  }), []);

  async function next() {
    setBusy(true);
    onProblem(null);
    const f = await videoFrameAt(video.uri, t);
    setBusy(false);
    if (!f) { onProblem("Couldn't take that frame. Try another moment."); return; }
    onPicked({ uri: f.uri, width: f.width, height: f.height });
  }

  const f = fractionOf(t, duration);
  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'], gap: spacing.md }} scrollEnabled={false}>
      {problem ? <InlineNotice icon="alert-circle" tone="error" text={problem} /> : null}
      <View style={[styles.bigFrame, { backgroundColor: colors.backgroundTertiary, width: stripW, height: stripW * 0.75 }]}>
        {big ? <Image source={big as never} style={StyleSheet.absoluteFill} contentFit="contain" /> : <ActivityIndicator />}
      </View>
      <View style={{ width: stripW, height: 64 }} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Slide to choose the moment">
        <View style={styles.strip}>
          {thumbs.length ? thumbs.map((th, i) => <Image key={i} source={th as never} style={{ flex: 1, height: '100%' }} contentFit="cover" />) : <View style={{ flex: 1, backgroundColor: colors.backgroundTertiary }} />}
        </View>
        <View pointerEvents="none" style={[styles.marker, { left: Math.min(stripW - 6, Math.max(0, f * stripW - 3)) }]} />
      </View>
      <View style={styles.times}><Text style={[typeScale.caption, { color: colors.textSecondary }]}>0:00</Text><Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Frame at {formatDuration(t)}</Text><Text style={[typeScale.caption, { color: colors.textSecondary }]}>{formatDuration(duration)}</Text></View>
      <Button title="Next: zoom and crop" onPress={next} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  vid: { position: 'absolute', left: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 99, backgroundColor: 'rgba(8,16,12,0.65)' },
  vidText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '700' },
  bigFrame: { borderRadius: radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  strip: { flex: 1, flexDirection: 'row', borderRadius: 10, overflow: 'hidden' },
  marker: { position: 'absolute', top: -4, bottom: -4, width: 6, borderRadius: 3, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#2E5E34' },
  times: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
