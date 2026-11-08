import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, DateField, Icon, Input, LoadingSpinner, Switch } from '@/components/ui';
import { confirmAction, showMessage } from '@/components/financials/ActionSheet';
import { StormPage } from '@/components/weather/StormPage';
import { deleteStorm, deleteStormUpdate, endStorm, fetchOwnerStorm, fetchOwnerStormHistory, publishStorm, type StormDraft } from '@/data/stormOutlook';
import { DEFAULT_DISCLAIMER, easternToIso, isoToEastern, snowRange, type StormOutlook, type StormVersion } from '@/lib/stormView';
import { localDateKey } from '@/lib/ids';
import { pickImage } from '@/lib/pickImage';
import { uploadImage } from '@/lib/media';
import { prepareImage } from '@/lib/mediaCompress';
import { db } from '@/data/store';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { radius, spacing } from '@/theme/spacing';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourText = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const num = (s: string): number | null => { const n = parseFloat(s.replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** A day and an hour, in Brighton's (Eastern) time. */
function WhenPicker({ label, day, hour, onDay, onHour }: { label: string; day: string; hour: number; onDay: (d: string) => void; onHour: (h: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: spacing.sm }}>
      <DateField label={label} value={day} onChange={onDay} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }} contentContainerStyle={{ gap: 6 }}>
        {HOURS.map((h) => {
          const on = h === hour;
          return (
            <Pressable key={h} onPress={() => onHour(h)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${label} ${hourText(h)}`}
              style={[styles.hourChip, { backgroundColor: on ? colors.primary : colors.backgroundSecondary, borderColor: on ? colors.primary : colors.border }]}>
              <Text style={[typeScale.bodySmall, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '700' }]}>{hourText(h)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Area({ label, value, onChange, hint, minHeight = 110 }: { label: string; value: string; onChange: (v: string) => void; hint?: string; minHeight?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={[typeScale.bodySmall, { color: colors.textSecondary, fontWeight: '700', marginBottom: spacing.xs }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline
        textAlignVertical="top"
        accessibilityLabel={label}
        style={[styles.area, { minHeight, color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
      />
      {hint ? <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 4 }]}>{hint}</Text> : null}
    </View>
  );
}

/**
 * The owner's storm outlook screen: write a new outlook, or post an update to the one that is published. Every Publish is a new, locked version
 * (the original is never changed). The owner's words are shown exactly as written; a Spanish version is shown only if the owner writes one.
 */
export function StormOutlookEditor() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [active, setActive] = useState<StormOutlook | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [esOn, setEsOn] = useState(false);
  const [messageEs, setMessageEs] = useState('');
  const [unsure, setUnsure] = useState(false);
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [timingOn, setTimingOn] = useState(false);
  const [startDay, setStartDay] = useState(localDateKey(new Date()));
  const [startHour, setStartHour] = useState(18);
  const [endDay, setEndDay] = useState(localDateKey(new Date(Date.now() + 86400000)));
  const [endHour, setEndHour] = useState(6);
  const [disclaimer, setDisclaimer] = useState(DEFAULT_DISCLAIMER);
  const [measuredOn, setMeasuredOn] = useState(false);
  const [measured, setMeasured] = useState('');
  const [source, setSource] = useState('');
  const [final, setFinal] = useState(false);
  // The storm map: the picture already on the update being followed (kept unless changed), or a new one picked on this phone (uploaded at Publish).
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [pickedMap, setPickedMap] = useState<{ uri: string; width: number; height: number; mimeType?: string; size?: number } | null>(null);
  const [mapNote, setMapNote] = useState('');
  // Everything that has been published (for deleting a mistake).
  const [posted, setPosted] = useState<StormOutlook[]>([]);

  const fill = useCallback((s: StormOutlook | null) => {
    setActive(s);
    const v = s?.latest;
    if (!v) return;
    setName(s!.name);
    setHeadline(v.headline);
    setMessage(v.message);
    setEsOn(!!v.message_es);
    setMessageEs(v.message_es ?? '');
    setUnsure(v.snow_low === null);
    setLow(v.snow_low === null ? '' : String(v.snow_low));
    setHigh(v.snow_high === null ? '' : String(v.snow_high));
    setDisclaimer(v.disclaimer || DEFAULT_DISCLAIMER);
    setMapUrl(v.map_url);
    if (v.starts_at || v.ends_at) {
      setTimingOn(true);
      if (v.starts_at) { const e = isoToEastern(v.starts_at); setStartDay(e.dateKey); setStartHour(e.hour); }
      if (v.ends_at) { const e = isoToEastern(v.ends_at); setEndDay(e.dateKey); setEndHour(e.hour); }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetchOwnerStorm().then((r) => {
      if (!alive) return;
      if (!r.ok) { setError(r.message); setState('error'); return; }
      fill(r.storm);
      setState('ready');
    });
    fetchOwnerStormHistory().then((r) => { if (alive && r.ok) setPosted(r.storms); });
    return () => { alive = false; };
  }, [fill]);

  /** After a delete: what is published now, for the form and for the list. */
  const reload = useCallback(async () => {
    const [cur, all] = await Promise.all([fetchOwnerStorm(), fetchOwnerStormHistory()]);
    if (cur.ok) {
      if (!cur.storm) { setActive(null); setMapUrl(null); setPickedMap(null); }
      else fill(cur.storm);
    }
    if (all.ok) setPosted(all.storms);
  }, [fill]);

  const removeUpdate = (storm: StormOutlook, v: StormVersion) => {
    const only = storm.version_count <= 1;
    confirmAction(
      only ? 'Delete this storm?' : `Delete update ${v.version_no}?`,
      only
        ? 'This is the only update, so the whole storm is deleted. It disappears for everyone, including Storm History. This cannot be undone.'
        : `Update ${v.version_no} disappears for everyone, including Storm History${storm.latest?.id === v.id ? ', and the update before it becomes the current one' : ''}. This cannot be undone.`,
      'Delete',
      async () => {
        setBusy(true);
        const r = await deleteStormUpdate(v.id);
        if (!r.ok) { setBusy(false); showMessage("Couldn't delete", r.message); return; }
        await reload();
        setBusy(false);
      },
      true,
    );
  };
  const removeStorm = (storm: StormOutlook) => {
    confirmAction(
      'Delete the whole storm?',
      `“${storm.name || storm.latest?.headline || 'This storm'}” and all of its updates disappear for everyone, including Storm History. This cannot be undone.`,
      'Delete storm',
      async () => {
        setBusy(true);
        const r = await deleteStorm(storm.id);
        if (!r.ok) { setBusy(false); showMessage("Couldn't delete", r.message); return; }
        await reload();
        setBusy(false);
      },
      true,
    );
  };

  /** The draft as the storm page shows it (for Preview) and as it is saved (for Publish). */
  const built = useMemo(() => {
    const lo = unsure ? null : num(low);
    const hi = unsure ? null : num(high);
    let startsAt: string | null = null; let endsAt: string | null = null;
    try { if (timingOn) { startsAt = easternToIso(startDay, startHour); endsAt = easternToIso(endDay, endHour); } } catch { /* a bad date is caught in the checks below */ }
    const actual = measuredOn ? num(measured) : null;
    const draft: StormDraft = {
      outlookId: active?.id ?? null, name: name.trim(), headline: headline.trim(), message: message.trim(), messageEs: esOn ? messageEs.trim() : '',
      snowLow: lo, snowHigh: hi, startsAt, endsAt, disclaimer: disclaimer.trim(), actualSnow: actual, actualSource: source.trim(), final, mapUrl,
    };
    const problems: string[] = [];
    if (!draft.headline) problems.push('Write a headline.');
    if (!draft.message) problems.push('Write your message.');
    if (!draft.disclaimer) problems.push('The disclaimer cannot be empty.');
    if (!unsure && (lo === null || hi === null)) problems.push('Give a low and a high snowfall, or choose "I\'m not sure yet".');
    if (lo !== null && hi !== null && (lo < 0 || hi > 100 || hi < lo)) problems.push('The high snowfall must be at least the low (0 to 100 inches).');
    if (timingOn && startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) problems.push('The end must be after the start.');
    if (measuredOn && actual === null) problems.push('Enter the measured snowfall, or turn it off.');
    if (measuredOn && actual !== null && draft.actualSource.length < 3) problems.push('Say who or what measured the snowfall.');
    const version: StormVersion = {
      id: 'draft', version_no: (active?.version_count ?? 0) + 1, headline: draft.headline || '…', message: draft.message || '…', message_es: draft.messageEs || null,
      snow_low: lo, snow_high: hi, starts_at: startsAt, ends_at: endsAt, disclaimer: draft.disclaimer, actual_snow: actual, actual_source: actual === null ? null : draft.actualSource || null,
      is_final: final, published_at: new Date().toISOString(), map_url: pickedMap?.uri ?? mapUrl,
    };
    return { draft, problems, version };
  }, [active, name, headline, message, esOn, messageEs, unsure, low, high, timingOn, startDay, startHour, endDay, endHour, disclaimer, measuredOn, measured, source, final, mapUrl, pickedMap]);

  const chooseMap = async () => {
    setMapNote('');
    const r = await pickImage('library');
    if (r.status === 'error') { setMapNote(r.message); return; }
    if (r.status === 'picked') setPickedMap({ uri: r.uri, width: r.width, height: r.height, mimeType: r.mimeType, size: r.size });
  };
  const removeMap = () => { setPickedMap(null); setMapUrl(null); setMapNote(''); };

  const publish = () => {
    if (built.problems.length) { showMessage("Can't publish yet", built.problems[0]); return; }
    const what = active ? (final ? 'final update (this also ends the storm)' : 'update') : 'storm outlook';
    confirmAction('Publish to everyone?', `This ${what} will be visible to everyone who opens Brighton Weather. A published update cannot be changed afterward; you can post another update.`, 'Publish', async () => {
      setBusy(true);
      let draft = built.draft;
      if (pickedMap) {
        // The picture goes up first; the outlook is published only once it is stored, so there is never an update pointing at a missing map.
        try {
          const prepared = await prepareImage({ id: 'storm-map', kind: 'image', sourceUri: pickedMap.uri, mimeType: pickedMap.mimeType, width: pickedMap.width, height: pickedMap.height, bytesIn: pickedMap.size, folder: '', target: { type: 'storm_map', payload: {} } } as unknown as Parameters<typeof prepareImage>[0]);
          const up = await uploadImage(prepared.uri, `${db.companyId}/storm-maps`, prepared.mimeType);
          draft = { ...draft, mapUrl: up.url };
        } catch (e) {
          setBusy(false);
          showMessage("Couldn't upload the map", `${e instanceof Error ? e.message : 'Something went wrong.'} Nothing was published. Try again, or remove the map.`);
          return;
        }
      }
      const r = await publishStorm(draft);
      setBusy(false);
      if (!r.ok) { showMessage("Couldn't publish", r.message); return; }
      showMessage('Published', 'Visitors can see it now.');
      router.back();
    });
  };
  const end = () => {
    if (!active) return;
    confirmAction('End this storm?', 'The outlook card goes away from the weather home. It stays in Storm History, and every update stays exactly as it was published.', 'End storm', async () => {
      setBusy(true);
      const r = await endStorm(active.id);
      setBusy(false);
      if (!r.ok) { showMessage("Couldn't end the storm", r.message); return; }
      router.back();
    }, true);
  };

  const pad = { paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + 120 };
  const label = (s: string) => <Text style={[typeScale.bodySmall, { color: colors.textSecondary, fontWeight: '700', marginTop: spacing.lg }]}>{s}</Text>;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[typeScale.headingLarge, { color: colors.textPrimary }]}>{active ? 'Post an update' : 'New storm outlook'}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary, marginTop: 2 }]}>
            {active ? `Update ${active.version_count + 1} of “${active.name || active.latest?.headline}”` : 'Write it in your own words. Visitors see exactly what you type.'}
          </Text>
        </View>
      </View>

      {state === 'loading' ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><LoadingSpinner /></View> : null}
      {state === 'error' ? (
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Text style={[typeScale.headingSmall, { color: colors.textPrimary }]}>Storm outlooks are not ready yet</Text>
          <Text style={[typeScale.bodyMedium, { color: colors.textSecondary }]}>{error}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>If this is the first time, the database update for storm outlooks has not been run yet.</Text>
        </View>
      ) : null}

      {state === 'ready' ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
            {!active ? <Input label="Storm name (optional)" value={name} onChangeText={setName} placeholder="Tuesday night snow" containerStyle={{ marginTop: spacing.md }} maxLength={80} /> : null}
            <Input label="Headline" value={headline} onChangeText={setHeadline} placeholder="Plan for snow Tuesday night" containerStyle={{ marginTop: spacing.md }} maxLength={120} />
            <Area label="Your message" value={message} onChange={setMessage} hint="Shown exactly as written. It is not translated automatically." />
            <View style={styles.switchRow}>
              <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>Add a Spanish version</Text>
              <Switch value={esOn} onValueChange={setEsOn} accessibilityLabel="Add a Spanish version" />
            </View>
            {esOn ? <Area label="Mensaje en español" value={messageEs} onChange={setMessageEs} hint="People using the app in Spanish see this. Without it they see your English message." /> : null}

            {label('Storm map')}
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 4 }]}>Optional. Post a picture, such as a screenshot of the map with the snow amounts for each town. Visitors see it first, and can zoom in. Without one, they see just your words.</Text>
            {pickedMap || mapUrl ? (
              <View style={{ marginTop: spacing.sm }}>
                <Image source={{ uri: pickedMap?.uri ?? mapUrl ?? '' }} style={{ width: '100%', aspectRatio: pickedMap ? Math.max(0.5, Math.min(2.5, pickedMap.width / Math.max(1, pickedMap.height))) : 4 / 3, borderRadius: radius.lg, backgroundColor: colors.backgroundSecondary }} resizeMode="contain" accessibilityLabel="Storm map preview" />
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Button title="Choose another" variant="secondary" icon="image" onPress={chooseMap} style={{ flex: 1 }} />
                  <Button title="Remove" variant="secondary" icon="trash-2" onPress={removeMap} style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <Button title="Add a storm map" variant="secondary" icon="image" onPress={chooseMap} fullWidth style={{ marginTop: spacing.sm }} />
            )}
            {mapNote ? <Text style={[typeScale.bodySmall, { color: '#B54708', marginTop: spacing.xs }]}>{mapNote}</Text> : null}

            {label('Snowfall you expect')}
            <View style={styles.switchRow}>
              <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>I’m not sure yet</Text>
              <Switch value={unsure} onValueChange={setUnsure} accessibilityLabel="I'm not sure yet" />
            </View>
            {!unsure ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Input label="Low (inches)" value={low} onChangeText={setLow} keyboardType="decimal-pad" placeholder="3" containerStyle={{ flex: 1 }} />
                <Input label="High (inches)" value={high} onChangeText={setHigh} keyboardType="decimal-pad" placeholder="6" containerStyle={{ flex: 1 }} />
              </View>
            ) : null}
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 4 }]}>If you are not sure yet, visitors see “Unavailable”, never 0.</Text>

            {label('Timing')}
            <View style={styles.switchRow}>
              <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>Add start and end times (Eastern time)</Text>
              <Switch value={timingOn} onValueChange={setTimingOn} accessibilityLabel="Add start and end times" />
            </View>
            {timingOn ? (
              <>
                <WhenPicker label="Starts" day={startDay} hour={startHour} onDay={setStartDay} onHour={setStartHour} />
                <WhenPicker label="Ends" day={endDay} hour={endHour} onDay={setEndDay} onHour={setEndHour} />
              </>
            ) : null}

            {active ? (
              <>
                {label('Measured snowfall')}
                <View style={styles.switchRow}>
                  <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>Add how much snow actually fell</Text>
                  <Switch value={measuredOn} onValueChange={setMeasuredOn} accessibilityLabel="Add measured snowfall" />
                </View>
                {measuredOn ? (
                  <>
                    <Input label="Measured (inches)" value={measured} onChangeText={setMeasured} keyboardType="decimal-pad" placeholder="8.5" containerStyle={{ marginTop: spacing.sm }} />
                    <Input label="Who or what measured it" value={source} onChangeText={setSource} placeholder="Brighton crews, Lakewood yard, 7 AM" containerStyle={{ marginTop: spacing.sm }} maxLength={160} />
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 4 }]}>Measured snowfall is only ever shown with its source.</Text>
                  </>
                ) : null}
                <View style={[styles.switchRow, { marginTop: spacing.lg }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typeScale.bodyMedium, { color: colors.textPrimary }]}>This is the final update</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Publishing it also ends the storm.</Text>
                  </View>
                  <Switch value={final} onValueChange={setFinal} accessibilityLabel="This is the final update" />
                </View>
              </>
            ) : null}

            <Area label="Disclaimer" value={disclaimer} onChange={setDisclaimer} minHeight={90} hint="Each update keeps the wording it was published with." />
            <Pressable onPress={() => setDisclaimer(DEFAULT_DISCLAIMER)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={[typeScale.bodyMedium, { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' }]}>Reset to the standard wording</Text>
            </Pressable>

            {posted.length ? (
              <View style={{ marginTop: spacing.xl }}>
                {label('Posted storms')}
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 4 }]}>Published something by mistake? Delete it here. It disappears for everyone, Storm History included.</Text>
                {posted.map((s) => (
                  <View key={s.id} style={[styles.postedCard, { backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}>
                    <Text style={[typeScale.bodyMedium, { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={2}>{s.name || s.latest?.headline || 'Storm outlook'}</Text>
                    <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: 2 }]}>{s.status === 'active' ? 'Published now' : 'Ended'} · {s.version_count} {s.version_count === 1 ? 'update' : 'updates'}</Text>
                    {s.versions.map((v) => (
                      <View key={v.id} style={styles.postedRow}>
                        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>Update {v.version_no}{v.is_final ? ' · Final' : ''}{v.map_url ? ' · picture' : ''} — {v.headline}</Text>
                        <Pressable onPress={() => removeUpdate(s, v)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Delete update ${v.version_no}`} hitSlop={6} style={styles.deleteBtn}>
                          <Text style={styles.deleteText}>Delete</Text>
                        </Pressable>
                      </View>
                    ))}
                    {s.version_count > 1 ? (
                      <Pressable onPress={() => removeStorm(s)} disabled={busy} accessibilityRole="button" accessibilityLabel="Delete the whole storm" style={[styles.deleteBtn, { alignSelf: 'flex-start', marginTop: spacing.xs }]}>
                        <Text style={styles.deleteText}>Delete the whole storm</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {built.problems.length ? <Text style={[typeScale.bodySmall, { color: '#B54708', marginTop: spacing.md }]}>{built.problems[0]}</Text> : null}
            <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.md }]}>
              {snowRange(built.version) ? `Visitors will see “${snowRange(built.version)}”.` : 'Visitors will see “Unavailable” for snowfall.'}
            </Text>

            <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
              <Button title="See what visitors see" variant="secondary" icon="eye" onPress={() => setPreviewing(true)} fullWidth />
              <Button title={active ? (final ? 'Publish final update' : 'Publish update') : 'Publish outlook'} icon="send" onPress={publish} loading={busy} fullWidth />
              {active ? <Button title="End storm without an update" variant="secondary" icon="x-circle" onPress={end} fullWidth /> : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}

      <Modal visible={previewing} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPreviewing(false)}>
        <View style={{ flex: 1, backgroundColor: '#F7FAF4' }}>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}>
            <StormPage outlook={{ name: active?.name ?? name.trim(), status: 'active', version_count: (active?.version_count ?? 0) + 1 }} version={built.version} preview />
          </ScrollView>
          <View style={[styles.previewBar, { paddingBottom: insets.bottom + spacing.sm }]}>
            <Button title="Close preview" onPress={() => setPreviewing(false)} fullWidth />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, marginTop: spacing.xs },
  area: { borderWidth: 1.5, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingTop: spacing.sm + 2, paddingBottom: spacing.sm, fontSize: 16, lineHeight: 22 },
  hourChip: { minHeight: 44, minWidth: 62, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  postedCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  postedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  deleteBtn: { minHeight: 44, minWidth: 64, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5B4B0', alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#B42318', fontWeight: '700', fontSize: 14 },
  previewBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: '#F7FAF4' },
});
