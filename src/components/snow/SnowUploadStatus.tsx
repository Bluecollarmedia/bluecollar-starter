/**
 * The small status under a Snow "add photos" button: each photo or video that is still going up (what it is doing, and the last reason if it
 * is retrying) with Remove, and each one that failed (why) with Retry and Remove. Nothing here blocks the screen.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useT } from '@/i18n';
import { useTheme } from '@/providers/ThemeProvider';
import { mediaQueue } from '@/lib/mediaQueueRuntime';
import type { MediaJob } from '@/lib/mediaQueue';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

type T = (text: string, vars?: Record<string, string | number>) => string;
const NOUN = (j: MediaJob, t: T) => (j.kind === 'video' ? t('Video') : t('Photo'));

/** The sentences uploadErrors.ts puts in front of the original text: "<sentence> (<original text>)". */
const EXPLAINED = [
  "Photo storage isn't set up on the server yet (the storage bucket is missing).",
  'Your sign-in has expired. Sign out and sign in again, then retry.',
  "The server refused this upload. You may be signed out, not on this company's team, or the stop/job is already closed.",
  'This file is bigger than the server allows. Try a smaller photo or a shorter video.',
  "The server doesn't accept this kind of file.",
  "Cloud photo storage (R2) isn't fully set up yet.",
  "The photo service function isn't reachable. It may not be deployed yet.",
  "Couldn't reach the server. Check the phone's connection and try again.",
  'The phone could not read that photo file. Pick it again.',
];

/**
 * Why an upload failed is worded in several places (snowMedia, uploadFile, uploadErrors, the queue) and kept in English there, because the
 * retry rules read those words. Here, only for showing, the sentence parts get the chosen language; codes and status numbers stay as they are.
 */
export function localizeUploadError(raw: string, t: T): string {
  const whole = t(raw);
  if (whole !== raw) return whole;
  const again = (s: string) => localizeUploadError(s, t);
  let m = raw.match(/^(Reserving the file|Asking for the upload link|Sending the file) timed out after (\d+) seconds$/);
  if (m) return t('{what} timed out after {n} seconds', { what: t(m[1]), n: m[2] });
  m = raw.match(/^The upload timed out after (\d+) minutes$/);
  if (m) return t('The upload timed out after {n} minutes', { n: m[1] });
  m = raw.match(/^Upload failed\. Cloud storage: ([\s\S]*)\. Backup: ([\s\S]*)$/);
  if (m) return t('Upload failed. Cloud storage: {cloud}. Backup: {backup}', { cloud: again(m[1]), backup: again(m[2]) });
  m = raw.match(/^Upload failed:\s*([\s\S]*)$/);
  if (m) return t('Upload failed: {reason}', { reason: again(m[1]) });
  m = raw.match(/^Couldn't reserve the file: ([\s\S]*)$/);
  if (m) return t("Couldn't reserve the file: {reason}", { reason: again(m[1]) });
  m = raw.match(/^Sending the file failed \(([\s\S]*)\)$/);
  if (m) return t('Sending the file failed ({reason})', { reason: again(m[1]) });
  m = raw.match(/^The phone could not read the file \(([\s\S]*)\)$/);
  if (m) return t('The phone could not read the file ({reason})', { reason: again(m[1]) });
  m = raw.match(/^The upload link was refused \(([\s\S]*)\)$/);
  if (m) return t('The upload link was refused ({detail})', { detail: m[1].replace(/no reason given$/, t('no reason given')).replace(/no answer$/, t('no answer')) });
  m = raw.match(/^Cloud storage answered ([\s\S]*)$/);
  if (m) return t('Cloud storage answered {status}', { status: m[1] });
  m = raw.match(/^The storage server answered ([\s\S]*)$/);
  if (m) return t('The storage server answered {status}', { status: m[1] });
  for (const say of EXPLAINED) if (raw.startsWith(`${say} (`)) return `${t(say)} ${raw.slice(say.length + 1)}`;
  return raw;
}

function stageWord(j: MediaJob, t: T): string {
  if (j.attempts > 0 && j.error) return t('Trying again ({n} of 4): {error}', { n: j.attempts, error: localizeUploadError(j.error, t) });
  if (j.status === 'preparing') return t('Getting ready…');
  return j.stage === 'record' ? t('Saving…') : t('Uploading…');
}

export function SnowUploadStatus({ uploading, failed }: { uploading: MediaJob[]; failed: MediaJob[] }) {
  const t = useT();
  const { colors } = useTheme();
  if (!uploading.length && !failed.length) return null;
  return (
    <View style={{ gap: spacing.xs }}>
      {uploading.length ? (
        <Text style={[typeScale.caption, { color: colors.textSecondary }]}>
          {uploading.length === 1 ? t('1 photo is uploading in the background. You can keep going.') : t('{n} photos are uploading in the background. You can keep going.', { n: uploading.length })}
        </Text>
      ) : null}
      {uploading.map((j) => (
        <View key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={[typeScale.caption, { color: j.attempts > 0 ? colors.warning : colors.textSecondary, flex: 1 }]} numberOfLines={3}>{NOUN(j, t)}: {stageWord(j, t)}</Text>
          <Pressable onPress={() => { void mediaQueue.cancel(j.id); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={j.kind === 'video' ? t('Remove this video') : t('Remove this photo')}>
            <Text style={[typeScale.labelLarge, { color: colors.textSecondary }]}>{t('Remove')}</Text>
          </Pressable>
        </View>
      ))}
      {failed.map((j) => (
        <View key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={[typeScale.caption, { color: colors.warning, flex: 1 }]} numberOfLines={4}>
            {j.kind === 'video'
              ? (j.error ? t("Video didn't upload: {error}", { error: localizeUploadError(j.error, t) }) : t("Video didn't upload."))
              : (j.error ? t("Photo didn't upload: {error}", { error: localizeUploadError(j.error, t) }) : t("Photo didn't upload."))}
          </Text>
          <Pressable onPress={() => mediaQueue.retry(j.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Retry the upload')}>
            <Text style={[typeScale.labelLarge, { color: colors.primary }]}>{t('Retry')}</Text>
          </Pressable>
          <Pressable onPress={() => { void mediaQueue.cancel(j.id); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={j.kind === 'video' ? t('Remove this video') : t('Remove this photo')}>
            <Text style={[typeScale.labelLarge, { color: colors.textSecondary }]}>{t('Remove')}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
