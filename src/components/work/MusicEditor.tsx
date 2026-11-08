/**
 * Choose the music for a post: import your own track, then pick the part of it that plays. A timeline shows the whole track; drag the two handles
 * (or the middle) to choose the part, hear it with "Play the selected part", and see exactly where it starts and ends. While a post is open, that
 * part plays on a loop. The track is saved once, with the start and end; nothing is cut or re-encoded.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer } from 'expo-video';
import { Button, Icon, InlineNotice, Input } from '@/components/ui';
import { pickTrack, pickTrackFromVideo, readTrackDuration, type PickedTrack } from '@/data/portfolioMusic';
import {
  MIN_CLIP_S, clipFractions, clipLengthS, defaultClip, dragClipEnd, dragClipStart, formatDuration, moveClip, normalizeClip, rulerMarks, trackTitleFromFile, type Clip,
} from '@/lib/portfolio';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';

/** What the editor hands back. `track` is set while the file is still on the phone (it is uploaded when the post is saved); `url` is a saved track. */
export interface MusicDraft {
  track: PickedTrack | null;
  url: string | null;
  title: string;
  /** The whole track's length in seconds. */
  durationS: number;
  startS: number;
  endS: number;
  fade: boolean;
  keepVideoSound: boolean;
}

const HANDLE = 26;

export function MusicEditor({ visible, initial, hasVideo, onCancel, onDone }: {
  visible: boolean;
  initial: Omit<MusicDraft, 'durationS'> & { durationS: number | null } | null;
  hasVideo: boolean;
  onCancel: () => void;
  onDone: (music: MusicDraft | null) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [track, setTrack] = useState<PickedTrack | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [clip, setClip] = useState<Clip>({ startS: 0, endS: 0 });
  const [fade, setFade] = useState(true);
  const [keepVideo, setKeepVideo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  // Open with what the post already has (or empty).
  useEffect(() => {
    if (!visible) return;
    setProblem(null); setPlaying(false);
    setTrack(initial?.track ?? null); setUrl(initial?.url ?? null); setTitle(initial?.title ?? '');
    setDuration(initial?.durationS ?? null); setFade(initial?.fade ?? true); setKeepVideo(initial?.keepVideoSound ?? false);
    setClip(initial ? { startS: initial.startS, endS: initial.endS } : { startS: 0, endS: 0 });
    // A saved track does not remember how long it is: read it.
    const source = initial?.track?.uri ?? initial?.url ?? null;
    if (source && initial?.durationS == null) {
      setLoading(true);
      void readTrackDuration(source).then((d) => {
        setLoading(false);
        if (!d) { setProblem("Couldn't read that track. Try choosing it again."); return; }
        setDuration(d);
        setClip((c) => (c.endS > c.startS ? normalizeClip(c.startS, c.endS, d) : defaultClip(d)));
      });
    }
  }, [visible, initial]);

  const source = track?.uri ?? url;
  const total = duration ?? 0;

  // ── hearing the selected part ──
  const player = useVideoPlayer(source, (p) => { p.loop = false; p.timeUpdateEventInterval = 0.2; });
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (playing && currentTime >= clip.endS) { player.pause(); setPlaying(false); }
    });
    return () => sub.remove();
  }, [player, playing, clip.endS]);
  useEffect(() => { if (!visible) { player.pause(); setPlaying(false); } }, [visible, player]);
  function togglePlay() {
    if (playing) { player.pause(); setPlaying(false); return; }
    player.currentTime = clip.startS;
    player.volume = 1;
    player.play();
    setPlaying(true);
  }

  /** A track from the phone's files, or the sound taken out of one of its videos: either way the same timeline follows. */
  async function choose(from: 'file' | 'video' = 'file') {
    setProblem(null);
    setLoading(from === 'video');
    const r = from === 'video' ? await pickTrackFromVideo() : await pickTrack();
    if (!r) { setLoading(false); return; }
    if (!r.ok) { setLoading(false); setProblem(r.error); return; }
    setLoading(true);
    const d = await readTrackDuration(r.track.uri);
    setLoading(false);
    if (!d) { setProblem("Couldn't read that track. Try another file."); return; }
    setTrack(r.track); setUrl(null); setDuration(d); setTitle(trackTitleFromFile(r.track.fileName)); setClip(defaultClip(d)); setPlaying(false);
  }

  // ── the timeline: drag the left handle, the right handle, or the middle ──
  const trackW = width - spacing.lg * 2 - spacing.lg * 2;
  const live = useRef({ clip, total, trackW });
  live.current = { clip, total, trackW };
  const startClip = useRef<Clip>(clip);
  const make = (kind: 'start' | 'end' | 'move') => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { startClip.current = live.current.clip; },
    onPanResponderMove: (_e, g) => {
      const { total: tot, trackW: w } = live.current;
      if (!(tot > 0)) return;
      const dS = (g.dx / w) * tot;
      const c0 = startClip.current;
      setClip(kind === 'move' ? moveClip(c0, tot, c0.startS + dS) : kind === 'start' ? dragClipStart(c0, tot, c0.startS + dS) : dragClipEnd(c0, tot, c0.endS + dS));
    },
  });
  const pans = useMemo(() => ({ start: make('start'), end: make('end'), move: make('move') }), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const f = clipFractions(clip, total);
  const left = f.start * trackW;
  const selW = Math.max(HANDLE, (f.end - f.start) * trackW);

  function done() {
    if (!source || !(total > 0)) { onDone(null); return; }
    if (clipLengthS(clip) < Math.min(MIN_CLIP_S, total)) { setProblem('Choose the part that plays.'); return; }
    onDone({ track, url, title: title.trim() || 'My track', durationS: total, startS: clip.startS, endS: clip.endS, fade, keepVideoSound: hasVideo ? keepVideo : false });
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg }}>
        <View style={styles.head}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>Music</Text>
          <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={10}><Text style={[typeScale.labelLarge, { color: colors.primary, fontWeight: '700' }]}>Cancel</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing['3xl'], gap: spacing.md }} keyboardShouldPersistTaps="handled" scrollEnabled>
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>Import your own track, then choose the part that plays with this post.</Text>
          {problem ? <InlineNotice icon="alert-circle" tone="error" text={problem} /> : null}

          {!source ? (
            <View style={{ gap: spacing.md }}>
              <Button title="Choose a track from your phone" onPress={() => choose('file')} loading={loading} />
              <Button title="Use the sound from a video" variant="secondary" onPress={() => choose('video')} loading={loading} />
              <RightsNote />
            </View>
          ) : (
            <>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View style={[styles.noteIcon, { backgroundColor: colors.primarySurface }]}><Icon name="music" size={22} color={colors.primary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{track?.fileName ?? 'Saved track'}{total ? ` · ${formatDuration(total)}` : ''}</Text>
                  </View>
                  <Button title="Change" size="sm" variant="secondary" onPress={() => choose('file')} />
                  <Button title="From a video" size="sm" variant="secondary" onPress={() => choose('video')} />
                </View>
                <Input label="Name shown on the music chip" value={title} onChangeText={setTitle} maxLength={60} containerStyle={{ marginTop: spacing.md }} />
              </View>

              {loading || !(total > 0) ? <ActivityIndicator /> : (
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[typeScale.labelLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Choose the part that plays</Text>
                  <View style={{ width: trackW, height: 84, marginTop: spacing.lg }}>
                    <View style={[styles.rail, { backgroundColor: colors.backgroundTertiary }]} />
                    {rulerMarks(total).map((t) => <View key={t} style={[styles.tick, { left: (t / total) * trackW, backgroundColor: colors.border }]} />)}
                    <View {...pans.move.panHandlers} style={[styles.selection, { left, width: selW }]} accessibilityLabel="Selected part. Drag to move it" />
                    <View {...pans.start.panHandlers} style={[styles.handle, { left: left - HANDLE / 2 }]} accessibilityRole="adjustable" accessibilityLabel="Start of the part"><View style={styles.grip} /></View>
                    <View {...pans.end.panHandlers} style={[styles.handle, { left: left + selW - HANDLE / 2 }]} accessibilityRole="adjustable" accessibilityLabel="End of the part"><View style={styles.grip} /></View>
                  </View>
                  <View style={[styles.rulerRow, { width: trackW }]}>
                    {rulerMarks(total).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 6)) === 0).map((t) => <Text key={t} style={[typeScale.caption, { color: colors.textSecondary }]}>{formatDuration(t)}</Text>)}
                  </View>

                  <View style={[styles.readout, { backgroundColor: colors.primarySurface }]}>
                    <Readout label="Starts at" value={formatDuration(clip.startS)} />
                    <Readout label="Length" value={`${Math.round(clipLengthS(clip))} sec`} center />
                    <Readout label="Ends at" value={formatDuration(clip.endS)} right />
                  </View>
                  <Button title={playing ? 'Stop' : 'Play the selected part'} onPress={togglePlay} style={{ marginTop: spacing.md }} />
                </View>
              )}

              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, gap: spacing.md }]}>
                <View style={styles.switchRow}>
                  <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flex: 1 }]}>Fade out at the end</Text>
                  <Switch value={fade} onValueChange={setFade} trackColor={{ true: '#2E5E34' }} accessibilityLabel="Fade out at the end" />
                </View>
                {hasVideo ? (
                  <View style={styles.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700' }]}>Keep the video's own sound</Text>
                      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>Off: the music replaces it.</Text>
                    </View>
                    <Switch value={keepVideo} onValueChange={setKeepVideo} trackColor={{ true: '#2E5E34' }} accessibilityLabel="Keep the video's own sound" />
                  </View>
                ) : null}
              </View>
              <RightsNote />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button title="Remove music" variant="secondary" onPress={() => onDone(null)} style={{ flex: 1 }} />
                <Button title="Use this part" onPress={done} style={{ flex: 1 }} />
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Readout({ label, value, center, right }: { label: string; value: string; center?: boolean; right?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: center ? 'center' : right ? 'flex-end' : 'flex-start' }}>
      <Text style={[typeScale.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typeScale.headingLarge, { color: colors.textPrimary, fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

function RightsNote() {
  return (
    <View style={styles.rights}>
      <Text style={styles.rightsText}>Use music you made, or have the right to use in public. Popular songs are usually not allowed in a business post.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  card: { padding: spacing.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth },
  noteIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, right: 0, top: 22, bottom: 22, borderRadius: 10 },
  tick: { position: 'absolute', top: 14, bottom: 14, width: 1 },
  selection: { position: 'absolute', top: 6, bottom: 6, borderWidth: 3, borderColor: '#2E5E34', borderRadius: 12, backgroundColor: 'rgba(46,94,52,0.18)' },
  handle: { position: 'absolute', top: 20, width: HANDLE, height: 44, borderRadius: 13, backgroundColor: '#2E5E34', alignItems: 'center', justifyContent: 'center' },
  grip: { width: 3, height: 16, borderRadius: 2, backgroundColor: '#FFFFFF' },
  rulerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  readout: { flexDirection: 'row', padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rights: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: '#FFF0D6' },
  rightsText: { color: '#5A3B00', fontSize: 13, lineHeight: 19 },
});
