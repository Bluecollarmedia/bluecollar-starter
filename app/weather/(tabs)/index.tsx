import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useScrollToTop } from '@/lib/scrollTop';
import { FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useLanguage, useT } from '@/i18n';
import { useWeather } from '@/hooks/useWeather';
import { useCurrentStorm } from '@/hooks/useStorm';
import { StormCard } from '@/components/weather/StormCard';
import { readPlace, savePlace } from '@/data/weather';
import { syncWidgets } from '@/data/widgetSync';
import { DEFAULT_PLACE, type Place } from '@/lib/weatherTowns';
import {
  ageMinutes, barSpan, setViewTz, viewTz, degrees, dewWord, firstWetHour, hoursOnDate, hourLabel, localDay, moonPhase, nextMoons, orDash, snowKind, sunTimes, tempColor, timeLabel, todayInTowns, uvAdvice, uvColor, uvLevel, weekdayShort, windWord,
  type MoonName, type WxAlert, type WxDay, type WxHour,
} from '@/lib/weatherView';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { PlacePicker } from '@/components/weather/PlacePicker';
import { WeatherOutlookScreen } from './outlook';
import { Panel, WX, WxPicture } from '@/components/weather/WeatherUI';
import { ScrubArea } from '@/components/weather/ScrubArea';
import { WeatherDetails, type DetailsStart, type MetricKey } from '@/components/weather/WeatherDetails';

const ON_DARK = '#FFFFFF';
const INK = WX.deep;
const SOFT = WX.soft;
const FAINT = WX.faint;
const HERO_RATIO = 1640 / 1170;
type Icon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const clock = (ms: number, locale: string) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: viewTz() }).format(new Date(ms));
const shortDate = (ms: number, locale: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: viewTz() }).format(new Date(ms));
const MOON_ICON: Record<MoonName, Icon> = {
  'New Moon': 'moon-new', 'Waxing Crescent': 'moon-waxing-crescent', 'First Quarter': 'moon-first-quarter', 'Waxing Gibbous': 'moon-waxing-gibbous',
  'Full Moon': 'moon-full', 'Waning Gibbous': 'moon-waning-gibbous', 'Last Quarter': 'moon-last-quarter', 'Waning Crescent': 'moon-waning-crescent',
};

/** The current time, refreshed every `ms`. */
function useNow(ms: number): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setN(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return n;
}
/** Today's date in the place's time zone. It only changes (and so only re-renders the screen) at midnight, or when the place's zone changes. */
function useToday(tz?: string): string {
  const [d, setD] = useState(() => todayInTowns(Date.now(), tz));
  useEffect(() => {
    const tick = () => setD(todayInTowns(Date.now(), tz));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [tz]);
  return d;
}
/** "N minutes ago" text with its own timer, so the minute ticking over redraws only this text and not the whole screen. */
function Age({ fetchedAt, render }: { fetchedAt: number; render: (minutes: number) => string }) {
  const now = useNow(30_000);
  return <>{render(ageMinutes(fetchedAt, now))}</>;
}

/** Under the summary: how old the forecast on screen is, once it is more than 30 minutes old (a saved forecast shown while offline, for example). */
function OldDataLine({ fetchedAt }: { fetchedAt: number }) {
  const t = useT();
  const now = useNow(60_000);
  const n = ageMinutes(fetchedAt, now);
  if (n < 30) return null;
  return <Text style={styles.old}>{n < 120 ? t('Updated {n} min ago', { n }) : t('Updated {h} hr ago', { h: Math.floor(n / 60) })}</Text>;
}

type HourMetric = 'temp' | 'feels' | 'uv' | 'pop' | 'wind';
const HOUR_METRICS: { key: HourMetric; label: string }[] = [
  { key: 'temp', label: 'Temp' }, { key: 'feels', label: 'Feels like' }, { key: 'uv', label: 'UV' }, { key: 'pop', label: 'Rain' }, { key: 'wind', label: 'Wind' },
];
const HOUR_W = 58;
const DAY_W = 34;
const MORE_W = 66;
const STRIP_DAYS = 5;

/** What the hourly strip shows: first the next 24 hours, then (after the arrow) five days of hours. */
type StripRow = { kind: 'hour'; key: string; h: WxHour; isNow: boolean } | { kind: 'sun'; key: string; at: number; rising: boolean; date: string } | { kind: 'more'; key: string };
function buildStrip(hours: WxHour[], expanded: boolean, at: { lat: number; lon: number }): StripRow[] {
  if (!hours.length) return [];
  const dates: string[] = [];
  for (const h of hours) { const d = localDay(h.time); if (!dates.includes(d)) dates.push(d); }
  const allowed = new Set(dates.slice(0, STRIP_DAYS));
  const shown = expanded ? hours.filter((h) => allowed.has(localDay(h.time))) : hours.slice(0, 24);
  const rows: StripRow[] = [];
  // Sunrise and sunset sit between the hours they fall in, like Apple Weather's strip.
  const suns: { at: number; rising: boolean; date: string }[] = [];
  for (const d of dates.slice(0, STRIP_DAYS)) {
    const st = sunTimes(d, at.lat, at.lon);
    if (st) suns.push({ at: st.rise, rising: true, date: d }, { at: st.set, rising: false, date: d });
  }
  shown.forEach((h, i) => {
    rows.push({ kind: 'hour', key: h.time, h, isNow: i === 0 });
    const from = Date.parse(h.time);
    const to = shown[i + 1] ? Date.parse(shown[i + 1].time) : from + 3_600_000;
    for (const e of suns) if (e.at >= from && e.at < to && (i > 0 || e.at > from)) rows.push({ kind: 'sun', key: `sun${e.at}`, at: e.at, rising: e.rising, date: localDay(h.time) });
  });
  if (!expanded && hours.length > shown.length) rows.push({ kind: 'more', key: 'more' });
  return rows;
}
const rowWidth = (r: StripRow) => (r.kind === 'more' ? MORE_W : HOUR_W);
const STRIP_PAD = DAY_W + 10;   // the width the pinned day label covers at the left

const SunItem = memo(function SunItem({ at, rising, locale, word }: { at: number; rising: boolean; locale: string; word: string }) {
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: viewTz() }).format(new Date(at));
  return (
    <View style={styles.hour} accessible accessibilityLabel={`${word} ${time}`}>
      <Text style={styles.hourText}>{time}</Text>
      <WxPicture icon={rising ? 'sunrise' : 'sunset'} size={40} />
      <Text style={styles.hourValue}>{word}</Text>
      <Text style={styles.hourSub}> </Text>
    </View>
  );
});

const HourItem = memo(function HourItem({ h, isNow, metric, locale, now, onPress, label }: { h: WxHour; isNow: boolean; metric: HourMetric; locale: string; now: string; onPress: (h: WxHour) => void; label: string }) {
  const value =
    metric === 'temp' ? degrees(h.tempF) : metric === 'feels' ? degrees(h.feelsF) : metric === 'uv' ? orDash(h.uvIndex) : metric === 'pop' ? orDash(h.popPct, '%') : h.windMph === null ? '–' : `${Math.round(h.windMph)}`;
  return (
    <Pressable onPress={() => onPress(h)} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.hour, pressed && { backgroundColor: WX.leafTint }]}>
      <Text style={styles.hourText}>{isNow ? now : hourLabel(h.time, locale)}</Text>
      <WxPicture icon={h.icon} size={40} />
      <Text style={[styles.hourValue, metric === 'pop' && { color: WX.rain }, metric === 'uv' && { color: uvColor(h.uvIndex) }]}>{value}</Text>
      {metric === 'uv' ? <View style={[styles.uvBar, { backgroundColor: h.uvIndex !== null && h.uvIndex > 0 ? uvColor(h.uvIndex) : 'transparent' }]} /> : metric === 'wind' ? <Text style={styles.hourSub}>{h.windDir}</Text> : typeof h.popPct === 'number' && h.popPct >= 20 && metric !== 'pop' ? <Text style={[styles.hourSub, { color: WX.rain }]}>{h.popPct}%</Text> : <Text style={styles.hourSub}> </Text>}
    </Pressable>
  );
});

/**
 * A small row of bars for the next 24 hours (wind, rain chance). Slide a finger along it to read any hour: the bar you touch darkens and a line
 * below says what it is. Hours with no figure are left empty, never drawn as zero.
 */
function MiniBars({ values, max, color, describe, caption }: { values: Array<number | null>; max: number; color: string; describe: (i: number) => string; caption: string }) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const onPick = useCallback((i: number) => { setSel(i); }, []);
  const onEnd = useCallback(() => { setSel(null); }, []);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <ScrubArea width={w} count={values.length} onPick={onPick} onEnd={onEnd} tap={false}>
        <View style={styles.miniBars} accessible={false}>
          {values.map((v, i) => (
            <View key={i} style={styles.miniCol}>
              {v === null
                ? <View style={[styles.miniBar, { height: 2, backgroundColor: '#DDE7D8' }]} />
                : <View style={[styles.miniBar, { height: Math.max(3, (Math.min(v, max) / max) * 44), backgroundColor: color, opacity: sel === null || sel === i ? 1 : 0.35 }]} />}
            </View>
          ))}
        </View>
      </ScrubArea>
      <Text style={[styles.axisNote, sel !== null && { color: INK, fontWeight: '700' }]}>{sel !== null ? describe(sel) : caption}</Text>
    </View>
  );
}

function CardHead({ icon, title, tappable, picture }: { icon?: Icon; title: string; tappable?: boolean; picture?: 'sunrise' | 'sunset' }) {
  return (
    <View style={styles.cardHead}>
      {picture ? <WxPicture icon={picture} size={24} /> : <MaterialCommunityIcons name={icon as Icon} size={16} color={SOFT} />}
      <Text style={styles.cardTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{title}</Text>
      {tappable ? <MaterialCommunityIcons name="chevron-right" size={20} color={SOFT} style={{ marginLeft: 'auto' }} /> : null}
    </View>
  );
}

/** The public Weather route. */
export default function WeatherHome() {
  return <WeatherHomeScreen />;
}

/**
 * The forecast screen. `embedded` is the signed-in version, opened from the little weather button on the owner's and the customer's home:
 * it has a Close button instead of Sign In, and the storm outlook opens as a sheet over it (the public routes are not used, so nobody is
 * moved out of their own area).
 */
export function WeatherHomeScreen({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const [outlookOpen, setOutlookOpen] = useState(false);
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es' : 'en-US';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const [place, setPlace] = useState<Place>(DEFAULT_PLACE);
  const [pickTown, setPickTown] = useState(false);
  const [openAlert, setOpenAlert] = useState<WxAlert | null>(null);
  const [hourMetric, setHourMetric] = useState<HourMetric>('temp');
  const [details, setDetails] = useState<DetailsStart | null>(null);
  const [arcW, setArcW] = useState(0);
  const [moreDays, setMoreDays] = useState(false);
  const stripRef = useRef<FlatList<StripRow>>(null);
  const pageRef = useRef<Animated.ScrollView>(null);
  useScrollToTop('/weather', useCallback(() => { pageRef.current?.scrollTo({ y: 0, animated: true }); }, []));
  const [stripDate, setStripDate] = useState<string | null>(null);
  const { view, refresh, busy } = useWeather(place);
  const { storm } = useCurrentStorm();

  useEffect(() => { readPlace().then(setPlace); }, []);
  useEffect(() => { setMoreDays(false); setStripDate(null); }, [place.key]);

  const data = view.data;
  setViewTz(data?.tz);
  const name = place.name;
  const now = useNow(5 * 60_000);   // the sun arc and the moon only need a coarse clock
  const today = useToday(data?.tz);
  const stale = view.status === 'stale' && !busy;
  // The home screen and lock screen widgets follow whatever forecast is on screen.
  useEffect(() => { void syncWidgets(data); }, [data]);


  // Hero fades and drifts slowly as the cards slide up over it.
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { y.value = e.contentOffset.y; });
  const heroStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, 190], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: y.value * 0.4 }, { scale: interpolate(y.value, [0, 220], [1, 0.9], Extrapolation.CLAMP) }],
  }));
  const miniStyle = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [150, 230], [0, 1], Extrapolation.CLAMP) }));

  // Snow is only mentioned on a day when snow is actually expected (a trace or more). A day with none, or with no figure, says nothing about it.
  function snowText(d: WxDay): { text: string; color: string } | null {
    const k = snowKind(d.snowIn);
    if (k === 'trace') return { text: t('Snow: trace'), color: WX.rain };
    if (k === 'amount') return { text: t('Snow: {n} in', { n: d.snowIn as number }), color: WX.rain };
    return null;
  }

  const open = useCallback((s: DetailsStart) => setDetails(s), []);
  const openHour = useCallback((h: WxHour) => open({ date: localDay(h.time), time: h.time, metric: hourMetric }), [open, hourMetric]);

  const hours = data?.hourly ?? [];
  const first = hours[0];
  const next24 = hours.slice(0, 24);
  const wet = useMemo(() => firstWetHour(hours), [hours]);
  const summary = !data ? '' : wet
    ? (wet.index === 0 ? t(wet.snow ? 'Snow likely now.' : 'Rain likely now.') : t(wet.snow ? 'Snow likely around {time}.' : 'Rain likely around {time}.', { time: hourLabel(wet.time, locale) }))
    : t('No rain expected in the next 24 hours.');
  const dewNow = first?.dewF ?? null;
  const uvNow = first?.uvIndex ?? null;
  const uvToday = hoursOnDate(hours, today);
  const uvPeak = uvToday.reduce<WxHour | null>((best, h) => ((h.uvIndex ?? 0) > ((best?.uvIndex) ?? -1) ? h : best), null);
  const gustMax = next24.map((h) => h.gustMph).filter((v): v is number => v !== null);
  const rainKnown = next24.map((h) => h.precipIn).filter((v): v is number => v !== null);
  const sun = data ? sunTimes(today, place.lat, place.lon) : null;
  const moon = moonPhase(now);
  const sunProgress = sun ? (now - sun.rise) / (sun.set - sun.rise) : 0;
  const daylightMin = sun ? Math.round((sun.set - sun.rise) / 60_000) : 0;
  const feelsDiff = first && first.feelsF !== null && first.tempF !== null ? Math.round(first.feelsF - first.tempF) : null;
  const metricOf = (m: MetricKey): DetailsStart => ({ date: today, metric: m });

  const stripRows = useMemo(() => buildStrip(hours, moreDays, place), [hours, moreDays, place.lat, place.lon]);
  const stripOffsets = useMemo(() => { const o: number[] = []; let x = 0; for (const r of stripRows) { o.push(x); x += rowWidth(r); } return o; }, [stripRows]);
  const stripHours = useMemo(() => stripRows.filter((r): r is Extract<StripRow, { kind: 'hour' }> => r.kind === 'hour'), [stripRows]);
  const firstDate = stripHours[0] ? localDay(stripHours[0].h.time) : '';
  const pinnedDate = stripDate ?? firstDate;
  // Today's own hours carry no label. The label appears once the strip reaches the next day, and goes away again when you come back to today.
  const showPinned = !!pinnedDate && pinnedDate !== firstDate;
  const pinnedLabel = pinnedDate ? weekdayShort(pinnedDate, locale).replace('.', '').toUpperCase() : '';
  const onStripScroll = useCallback((e: { nativeEvent: { contentOffset: { x: number } } }) => {
    if (!stripHours.length) return;
    const i = Math.min(stripRows.length - 1, Math.max(0, Math.floor((e.nativeEvent.contentOffset.x + STRIP_PAD) / HOUR_W)));
    const r = stripRows[i];
    const d = r.kind === 'hour' ? localDay(r.h.time) : r.kind === 'sun' ? r.date : localDay(stripHours[stripHours.length - 1].h.time);
    setStripDate((prev) => (prev === d ? prev : d));
  }, [stripHours, stripRows]);
  // The arrow loads everything at once (five days), then glides on to where the first new day begins.
  const showMoreDays = useCallback(() => {
    const at = stripRows.findIndex((r) => r.kind === 'more');
    setMoreDays(true);
    setTimeout(() => { if (at >= 0) stripRef.current?.scrollToIndex({ index: at, animated: true, viewPosition: 0, viewOffset: STRIP_PAD }); }, 80);
  }, [stripRows]);
  const ARC_DOTS = 34;
  const arcR = Math.max(0, Math.min(150, (arcW - 30) / 2));

  return (
    <View style={{ flex: 1 }}>
      <Animated.ScrollView
        ref={pageRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={INK} />}
        contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 18, paddingBottom: insets.bottom + 130 }}
      >
        <Image source={require('../../../assets/images/weather-hero.jpg')} style={{ position: 'absolute', top: 0, left: 0, width: screenW, height: screenW * HERO_RATIO }} resizeMode="cover" accessible={false} />
        <View style={styles.top}>
          <View style={styles.brand}>
            <Image source={require('../../../assets/images/logo-leaf.png')} style={styles.leaf} />
            <View>
              <Text style={styles.brandName}>BRIGHTON</Text>
              <Text style={styles.brandSub}>FORECAST</Text>
            </View>
          </View>
          {embedded ? (
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('Close')} style={({ pressed }) => [styles.signIn, pressed && { opacity: 0.8 }]}>
              <View style={styles.signInRow}>
                <Text style={styles.signInText}>{t('Close')}</Text>
                <MaterialCommunityIcons name="close" size={15} color={ON_DARK} />
              </View>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/(auth)/welcome' as any)} accessibilityRole="button" accessibilityLabel={t('Sign In')} style={({ pressed }) => [styles.signIn, pressed && { opacity: 0.8 }]}>
              <View style={styles.signInRow}>
                <Text style={styles.signInText}>{t('Sign In')}</Text>
                <MaterialCommunityIcons name="arrow-right" size={15} color={ON_DARK} />
              </View>
            </Pressable>
          )}
        </View>

        <Animated.View style={[heroStyle, { minHeight: 290 }]}>
          <Pressable onPress={() => setPickTown(true)} style={({ pressed }) => [styles.townRow, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t('Choose your town')}>
            <MaterialCommunityIcons name="map-marker-outline" size={17} color={INK} />
            <Text style={styles.townText}>{place.state ? `${name}, ${place.state}` : name}</Text>
            <MaterialCommunityIcons name="chevron-down" size={18} color={INK} />
          </Pressable>
          {data?.current ? (
            <View>
              <View style={styles.heroRow}>
                <WxPicture icon={data.current.icon} size={84} />
                <Text style={styles.temp}>{degrees(data.current.tempF)}</Text>
              </View>
              <Text style={styles.cond}>{data.current.text}</Text>
              {first && first.feelsF !== null ? <Text style={styles.hl}>{t('Feels like {n}', { n: degrees(first.feelsF) })}</Text> : null}
              {uvNow !== null && uvNow > 0 ? <Text style={styles.hl}>{t('UV index {n}', { n: uvNow })} · {t(uvLevel(uvNow))}</Text> : null}
              <Text style={styles.hl}>{t('H: {high}  L: {low}', { high: degrees(data.today.highF), low: degrees(data.today.lowF) })}</Text>
              <Text style={styles.summary}>{summary}</Text>
              <OldDataLine fetchedAt={data.fetchedAt} />
            </View>
          ) : view.status === 'loading' ? (
            <Text style={styles.cond}>{t('Loading the forecast…')}</Text>
          ) : (
            <Text style={styles.bigMsg}>{t('Weather is unavailable right now')}</Text>
          )}
        </Animated.View>

        {storm?.latest ? (
          <View style={styles.gap}>
            <StormCard storm={storm} onPress={() => (embedded ? setOutlookOpen(true) : router.push('/weather/outlook' as any))} />
          </View>
        ) : null}

        {stale && data ? (
          <Panel style={styles.gap}>
            <View style={styles.pad}>
              <Text style={styles.cardTitle}><Age fetchedAt={data.fetchedAt} render={(n) => t('Last forecast, {n} minutes ago', { n })} /></Text>
              <Text style={styles.cardBody}>{t("We couldn't reach the National Weather Service. This is the last forecast we have for {town}, so it may be out of date.", { town: name })}</Text>
              <Pressable onPress={refresh} style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]} accessibilityRole="button"><Text style={styles.retryText}>{t('Try again')}</Text></Pressable>
            </View>
          </Panel>
        ) : null}

        {view.status === 'unavailable' ? (
          <Panel style={styles.gap}>
            <View style={styles.pad}>
              <Text style={styles.cardBody}>{t('No forecast is available for {town} right now. Try again in a few minutes.', { town: name })}</Text>
              <Pressable onPress={refresh} style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]} accessibilityRole="button"><Text style={styles.retryText}>{t('Try again')}</Text></Pressable>
            </View>
          </Panel>
        ) : null}

        {data && data.alerts.length > 0 ? (
          <View style={[styles.gap, { gap: 10 }]}>
            {data.alerts.map((a) => (
              <Pressable key={a.id} onPress={() => setOpenAlert(a)} accessibilityRole="button" accessibilityLabel={`${a.event}. ${t('View alert')}`} style={({ pressed }) => pressed && { opacity: 0.75 }}>
                <Panel bg="#FFF4DC" style={{ borderColor: '#F0D9A4' }}>
                  <View style={styles.alertRow}>
                    <MaterialCommunityIcons name="alert-outline" size={24} color="#B86E00" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alertTitle}>{a.event}</Text>
                      <Text style={styles.alertSub}>{a.sender}{a.expires ? ` · ${t('Until {time}', { time: timeLabel(a.expires, locale) })}` : ''}</Text>
                    </View>
                    <Text style={styles.alertView}>{t('View')}</Text>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={INK} />
                  </View>
                </Panel>
              </Pressable>
            ))}
          </View>
        ) : null}

        {data && hours.length > 0 ? (
          <Panel style={styles.gap}>
            <View style={styles.pad}>
              <Pressable onPress={() => open({ date: today, metric: hourMetric })} accessibilityRole="button" accessibilityLabel={`${t('Hourly Forecast')}. ${t('Open details')}`}>
                <CardHead icon="clock-outline" title={t('Hourly Forecast')} tappable />
              </Pressable>
              <View style={{ marginTop: 6 }}>
                <FlatList
                  ref={stripRef}
                  horizontal
                  data={stripRows}
                  keyExtractor={(r) => r.key}
                  showsHorizontalScrollIndicator={false}
                  initialNumToRender={14}
                  windowSize={9}
                  onScroll={onStripScroll}
                  scrollEventThrottle={16}
                  getItemLayout={(_d, i) => ({ length: stripRows[i] ? rowWidth(stripRows[i]) : HOUR_W, offset: stripOffsets[i] ?? 0, index: i })}
                  style={{ marginRight: -6 }}
                  renderItem={({ item }) =>
                    item.kind === 'hour' ? (
                      <HourItem h={item.h} isNow={item.isNow} metric={hourMetric} locale={locale} now={t('Now')} onPress={openHour} label={`${hourLabel(item.h.time, locale)}${hourMetric === 'uv' && item.h.uvIndex !== null ? `. ${t('UV index {n}', { n: item.h.uvIndex })}, ${t(uvLevel(item.h.uvIndex))}` : ''}. ${t('Open details')}`} />
                    ) : item.kind === 'sun' ? (
                      <SunItem at={item.at} rising={item.rising} locale={locale} word={t(item.rising ? 'Sunrise' : 'Sunset')} />
                    ) : (
                      <View style={styles.moreWrap}>
                        <Pressable onPress={showMoreDays} accessibilityRole="button" accessibilityLabel={t('Show the next days')} style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.7 }]}>
                          <MaterialCommunityIcons name="chevron-right" size={28} color={ON_DARK} />
                        </Pressable>
                      </View>
                    )
                  }
                />
                {showPinned && pinnedLabel ? (
                  <View style={styles.dayCol} pointerEvents="none" accessible accessibilityLabel={pinnedLabel}>
                    {pinnedLabel.split('').map((c, k) => <Text key={k} style={styles.dayColText}>{c}</Text>)}
                  </View>
                ) : null}
              </View>
              <View style={styles.pills}>
                {HOUR_METRICS.map((m) => {
                  const on = m.key === hourMetric;
                  return (
                    <Pressable key={m.key} onPress={() => setHourMetric(m.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={({ pressed }) => [styles.pill, on && styles.pillOn, pressed && { opacity: 0.7 }]}>
                      <Text style={[styles.pillText, on && { color: ON_DARK, fontWeight: '700' }]}>{t(m.label)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Panel>
        ) : null}

        {data && data.daily.length > 0 ? (
          <Panel style={styles.gap}>
            <View style={styles.pad}>
              <CardHead icon="calendar-month-outline" title={t('7 Day Forecast')} />
              {data.daily.map((d, i) => {
                const s = snowText(d);
                const span = barSpan(d, data.daily);
                return (
                  <Pressable key={d.date} onPress={() => open({ date: d.date })} accessibilityRole="button" accessibilityLabel={`${d.date === today ? t('Today') : weekdayShort(d.date, locale)}, ${d.text}. ${t('Open details')}`} style={({ pressed }) => [styles.day, i > 0 && styles.dayLine, pressed && { backgroundColor: WX.leafTint }]}>
                    <View style={{ width: 70 }}>
                      <Text style={styles.dayName}>{d.date === today ? t('Today') : weekdayShort(d.date, locale)}</Text>
                      {s ? <Text style={[styles.daySnow, { color: s.color }]} numberOfLines={2}>{s.text}</Text> : null}
                    </View>
                    <View style={styles.dayIcon}>
                      <WxPicture icon={d.icon} size={36} />
                      {typeof d.popPct === 'number' && d.popPct >= 10 ? <Text style={styles.dayPop}>{d.popPct}%</Text> : null}
                    </View>
                    <Text style={styles.dayLow}>{degrees(d.lowF)}</Text>
                    <View style={styles.barTrack}>
                      {span ? (
                        <LinearGradient colors={[tempColor(d.lowF), tempColor(d.highF)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { left: `${span.from * 100}%`, width: `${Math.max(6, (span.to - span.from) * 100)}%` }]} />
                      ) : null}
                    </View>
                    <Text style={styles.dayHigh}>{degrees(d.highF)}</Text>
                    <MaterialCommunityIcons name="chevron-right" size={18} color={FAINT} />
                  </Pressable>
                );
              })}
            </View>
          </Panel>
        ) : null}

        {data && first ? (
          <>
            <Pressable onPress={() => open(metricOf('uv'))} accessibilityRole="button" accessibilityLabel={`${t('UV index')}. ${t('Open details')}`} style={({ pressed }) => [styles.gap, pressed && { opacity: 0.8 }]}>
              <Panel>
                <View style={styles.pad}>
                  <CardHead icon="white-balance-sunny" title={t('UV index')} tappable />
                  <View style={styles.bigRow}>
                    <Text style={styles.big}>{uvNow === null ? t('Unavailable') : `${uvNow}`}</Text>
                    {uvNow !== null ? <Text style={[styles.bigSub, { color: uvColor(uvNow) }]}>{t(uvLevel(uvNow))}</Text> : null}
                  </View>
                  <Text style={styles.cardBody}>
                    {uvNow === null ? '' : t(uvAdvice(uvLevel(uvNow)))}
                    {uvPeak && (uvPeak.uvIndex ?? 0) > 0 ? ` ${t('Peak today: {n} around {time}.', { n: uvPeak.uvIndex as number, time: hourLabel(uvPeak.time, locale) })}` : ''}
                  </Text>
                  {uvNow !== null ? (
                    <View style={styles.uvTrack}>
                      <LinearGradient colors={['#3E9E52', '#E8C23A', '#F08A24', '#E0503A', '#8E3FBF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                      <View style={[styles.humDot, { left: `${Math.max(2, Math.min(98, (Math.min(uvNow, 11) / 11) * 100))}%` }]} />
                    </View>
                  ) : null}
                  <MiniBars
                    values={next24.map((h) => h.uvIndex)}
                    max={11}
                    color="#F0A21A"
                    caption={t('Slide your finger across to read any hour')}
                    describe={(i) => `${hourLabel(next24[i].time, locale)} · ${t('UV index {n}', { n: next24[i].uvIndex ?? 0 })} · ${t(uvLevel(next24[i].uvIndex ?? 0))}`}
                  />
                  <Text style={styles.axisNote}>{t("An estimate worked out from the sun's position and the forecast cloud cover.")}</Text>
                </View>
              </Panel>
            </Pressable>

            <Pressable onPress={() => open(metricOf('wind'))} accessibilityRole="button" accessibilityLabel={`${t('Wind')}. ${t('Open details')}`} style={({ pressed }) => [styles.gap, pressed && { opacity: 0.8 }]}>
              <Panel>
                <View style={styles.pad}>
                  <CardHead icon="weather-windy" title={t('Wind')} tappable />
                  <View style={styles.bigRow}>
                    <Text style={styles.big}>{first.windMph === null ? t('Unavailable') : `${Math.round(first.windMph)} mph`}</Text>
                    {first.windDir ? <Text style={styles.bigSub}>{first.windDir}</Text> : null}
                  </View>
                  <Text style={styles.cardBody}>
                    {windWord(first.windMph) ? t(windWord(first.windMph) as string) : ''}
                    {gustMax.length ? `${windWord(first.windMph) ? '. ' : ''}${t('Gusts up to {n} mph in the next 24 hours', { n: Math.round(Math.max(...gustMax)) })}` : ''}
                  </Text>
                  <MiniBars
                    values={next24.map((h) => h.windMph)}
                    max={Math.max(15, ...next24.map((h) => h.windMph ?? 0))}
                    color={WX.leaf}
                    caption={t('Slide your finger across to read any hour')}
                    describe={(i) => `${hourLabel(next24[i].time, locale)} · ${next24[i].windMph === null ? t('Unavailable') : `${Math.round(next24[i].windMph as number)} mph ${next24[i].windDir}`}`}
                  />
                </View>
              </Panel>
            </Pressable>

            <Pressable onPress={() => open(metricOf('humidity'))} accessibilityRole="button" accessibilityLabel={`${t('Humidity')}. ${t('Open details')}`} style={({ pressed }) => [styles.gap, pressed && { opacity: 0.8 }]}>
              <Panel>
                <View style={styles.pad}>
                  <CardHead icon="water-percent" title={t('Humidity')} tappable />
                  <Text style={styles.big}>{first.humidityPct === null ? t('Unavailable') : `${Math.round(first.humidityPct)}%`}</Text>
                  <Text style={styles.cardBody}>
                    {dewWord(dewNow) ? `${t(dewWord(dewNow) as string)}. ` : ''}
                    {dewNow !== null ? t('The dew point is {n}° right now.', { n: dewNow }) : ''}
                  </Text>
                  {first.humidityPct !== null ? (
                    <View style={styles.humTrack}>
                      <LinearGradient colors={['#4A90E2', '#5CCB7A', '#F2D45C', '#EF6A5A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                      <View style={[styles.humDot, { left: `${Math.max(2, Math.min(98, first.humidityPct))}%` }]} />
                    </View>
                  ) : null}
                </View>
              </Panel>
            </Pressable>

            <Pressable onPress={() => open(metricOf('pop'))} accessibilityRole="button" accessibilityLabel={`${t('Rain')}. ${t('Open details')}`} style={({ pressed }) => [styles.gap, pressed && { opacity: 0.8 }]}>
              <Panel>
                <View style={styles.pad}>
                  <CardHead icon="weather-pouring" title={t('Rain')} tappable />
                  <Text style={styles.big}>{rainKnown.length ? `${rainKnown.reduce((a, b) => a + b, 0).toFixed(2)} in` : t('Unavailable')}</Text>
                  <Text style={styles.cardBody}>{rainKnown.length ? t('expected in the next 24 hours.') : ''} {summary}</Text>
                  <MiniBars
                    values={next24.map((h) => h.popPct)}
                    max={100}
                    color="#6AA9DE"
                    caption={t('Chance of rain, next 24 hours. Slide your finger across to read any hour.')}
                    describe={(i) => `${hourLabel(next24[i].time, locale)} · ${next24[i].popPct === null ? t('Unavailable') : `${next24[i].popPct}% ${t('chance of rain')}`}`}
                  />
                </View>
              </Panel>
            </Pressable>

            <View style={[styles.gap, styles.two]}>
              <Pressable onPress={() => open(metricOf('feels'))} accessibilityRole="button" accessibilityLabel={`${t('Feels like')}. ${t('Open details')}`} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]}>
                <Panel style={{ flex: 1 }}>
                  <View style={styles.pad}>
                    <CardHead icon="thermometer" title={t('Feels like')} tappable />
                    <Text style={styles.big}>{degrees(first.feelsF)}</Text>
                    <Text style={styles.cardBody}>{feelsDiff === null ? t('Unavailable') : feelsDiff === 0 ? t('Same as the actual temperature.') : feelsDiff > 0 ? t('Warmer than the actual temperature.') : t('Colder than the actual temperature.')}</Text>
                  </View>
                </Panel>
              </Pressable>
              <Pressable onPress={() => open(metricOf('cloud'))} accessibilityRole="button" accessibilityLabel={`${t('Cloud cover')}. ${t('Open details')}`} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]}>
                <Panel style={{ flex: 1 }}>
                  <View style={styles.pad}>
                    <CardHead icon="cloud-outline" title={t('Cloud cover')} tappable />
                    <Text style={styles.big}>{orDash(first.cloudPct, '%')}</Text>
                    <Text style={styles.cardBody}>{first.cloudPct === null ? t('Unavailable') : first.cloudPct < 20 ? t('Clear sky.') : first.cloudPct < 60 ? t('Partly cloudy.') : t('Mostly cloudy.')}</Text>
                  </View>
                </Panel>
              </Pressable>
            </View>
          </>
        ) : null}

        {data && sun ? (
          <Panel style={styles.gap}>
            <View style={styles.pad} onLayout={(e) => setArcW(e.nativeEvent.layout.width)}>
              <CardHead picture="sunset" title={t('Sun')} />
              {arcW > 0 ? (
                <View style={{ height: arcR + 26, marginTop: 8 }} accessible accessibilityLabel={t('Sunrise {a}, sunset {b}', { a: clock(sun.rise, locale), b: clock(sun.set, locale) })}>
                  {Array.from({ length: ARC_DOTS + 1 }, (_, k) => {
                    const p = k / ARC_DOTS;
                    const ang = Math.PI * (1 - p);
                    const cx = arcW / 2 - 16 + arcR * Math.cos(ang);
                    const cy = arcR - arcR * Math.sin(ang);
                    const done = sunProgress >= p && sunProgress <= 1;
                    return <View key={k} style={{ position: 'absolute', left: cx + 8 - 2.5, top: cy + 6, width: 5, height: 5, borderRadius: 3, backgroundColor: done ? '#E8A21E' : '#D5E2CF' }} />;
                  })}
                  {sunProgress >= 0 && sunProgress <= 1 ? (() => {
                    const ang = Math.PI * (1 - sunProgress);
                    return <View style={{ position: 'absolute', left: arcW / 2 - 16 + arcR * Math.cos(ang) + 8 - 16, top: arcR - arcR * Math.sin(ang) + 6 - 14 }}><WxPicture icon="sun" size={32} bare /></View>;
                  })() : null}
                  <View style={styles.arcMid}>
                    <Text style={styles.arcMain}>{t('{h} hr {m} min of daylight', { h: Math.floor(daylightMin / 60), m: daylightMin % 60 })}</Text>
                  </View>
                </View>
              ) : null}
              <View style={styles.sunRow}>
                <View style={styles.sunCol}><WxPicture icon="sunrise" size={40} /><View><Text style={styles.sunTime}>{clock(sun.rise, locale)}</Text><Text style={styles.sunLabel}>{t('Sunrise')}</Text></View></View>
                <View style={[styles.sunCol, { flexDirection: 'row-reverse' }]}><WxPicture icon="sunset" size={40} /><View style={{ alignItems: 'flex-end' }}><Text style={styles.sunTime}>{clock(sun.set, locale)}</Text><Text style={styles.sunLabel}>{t('Sunset')}</Text></View></View>
              </View>
            </View>
          </Panel>
        ) : null}

        {data ? (
          <Panel style={styles.gap}>
            <View style={styles.pad}>
              <CardHead icon="moon-waning-crescent" title={t('Moon')} />
              <View style={styles.moonRow}>
                <View style={{ alignItems: 'center', width: 130 }}>
                  <MaterialCommunityIcons name={MOON_ICON[moon.name]} size={84} color="#D9B24A" />
                  <Text style={styles.moonName}>{t(moon.name)}</Text>
                  <Text style={styles.cardBody}>{t('Illumination {n}%', { n: Math.round(moon.illumination * 100) })}</Text>
                </View>
                <View style={{ flex: 1, gap: 10 }}>
                  {nextMoons(now).map((m) => (
                    <View key={m.name} style={styles.moonNext}>
                      <MaterialCommunityIcons name={MOON_ICON[m.name]} size={26} color="#D9B24A" />
                      <View>
                        <Text style={styles.moonNextName}>{t(m.name)}</Text>
                        <Text style={styles.moonNextDate}>{shortDate(m.at, locale)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={styles.axisNote}>{t('Moon dates are estimates, good to about a day.')}</Text>
            </View>
          </Panel>
        ) : null}

        {data ? (
          <View style={styles.footWrap}>
            <Text style={styles.foot}>
              <Age fetchedAt={data.fetchedAt} render={(n) => (n < 1 ? t('Updated just now') : t('Updated {n} min ago', { n }))} />
            </Text>
            <Pressable onPress={refresh} accessibilityRole="button" accessibilityLabel={t('Refresh')} style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.7 }]}>
              <MaterialCommunityIcons name="refresh" size={18} color={INK} />
              <Text style={styles.refreshText}>{busy ? t('Updating…') : t('Refresh')}</Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.ScrollView>

      {data?.current ? (
        <Animated.View style={[styles.mini, { top: insets.top + 6 }, miniStyle]} pointerEvents="none">
          <Panel style={{ borderRadius: 99 }}>
            <View style={styles.miniRow}>
              <WxPicture icon={data.current.icon} size={28} />
              <Text style={styles.miniText}>{name} · {degrees(data.current.tempF)} · {data.current.text}</Text>
            </View>
          </Panel>
        </Animated.View>
      ) : null}

      <WeatherDetails visible={!!details} data={data} start={details} onClose={() => setDetails(null)} />

      {embedded ? (
        <Modal visible={outlookOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOutlookOpen(false)}>
          <View style={{ flex: 1, backgroundColor: WX.page }}>
            <WeatherOutlookScreen embedded onBack={() => setOutlookOpen(false)} />
          </View>
        </Modal>
      ) : null}

      <PlacePicker visible={pickTown} current={place} onClose={() => setPickTown(false)} onPick={(p) => { setPlace(p); void savePlace(p); setPickTown(false); }} />

      <BottomSheetModal visible={!!openAlert} onRequestClose={() => setOpenAlert(null)}>
        <View style={{ flex: 1 }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpenAlert(null)} accessibilityLabel={t('Close')} />
          <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '85%' }]}>
              <View style={styles.grip} />
              <View style={styles.sheetHead}>
                <Text style={[styles.sheetTitle, { flex: 1 }]}>{openAlert?.event}</Text>
                <Pressable onPress={() => setOpenAlert(null)} hitSlop={10}><Text style={styles.sheetCancel}>{t('Close')}</Text></Pressable>
              </View>
              <ScrollView bounces={false}>
                <Text style={styles.alertSender}>{openAlert?.sender}</Text>
                {openAlert?.headline ? <Text style={styles.alertHeadline}>{openAlert.headline}</Text> : null}
                {openAlert?.description ? <Text style={styles.alertBody}>{openAlert.description}</Text> : null}
                {openAlert?.instruction ? <Text style={styles.alertBody}>{openAlert.instruction}</Text> : null}
              </ScrollView>
            </View>
          </View>
        </View>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  leaf: { width: 34, height: 34, tintColor: WX.leaf },
  brandName: { color: INK, fontSize: 16, fontWeight: '600', letterSpacing: 2.6 },
  brandSub: { color: SOFT, fontSize: 10, fontWeight: '600', letterSpacing: 5.6, marginTop: 2 },
  signIn: { borderRadius: 99, backgroundColor: WX.deep, shadowColor: WX.deep, shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  signInRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 17 },
  signInText: { color: ON_DARK, fontSize: 14, fontWeight: '600' },
  townRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, minHeight: 44 },
  townText: { color: INK, fontSize: 15, fontWeight: '500' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  temp: { color: INK, fontSize: 92, fontWeight: '200', letterSpacing: -4, lineHeight: 100 },
  cond: { color: INK, fontSize: 20, marginTop: 2 },
  hl: { color: SOFT, fontSize: 14, marginTop: 3 },
  old: { color: SOFT, fontSize: 12.5, marginTop: 4 },
  summary: { color: INK, fontSize: 15, fontWeight: '600', marginTop: 12, lineHeight: 21 },
  bigMsg: { color: INK, fontSize: 24, fontWeight: '500', marginTop: 12 },
  gap: { marginTop: 14 },
  pad: { padding: 16 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 28 },
  cardTitle: { flexShrink: 1, color: SOFT, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  cardBody: { color: SOFT, fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  retry: { alignSelf: 'flex-start', marginTop: 10, minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: 99, backgroundColor: WX.deep },
  retryText: { color: ON_DARK, fontSize: 14, fontWeight: '600' },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, minHeight: 64 },
  alertTitle: { color: INK, fontSize: 15, fontWeight: '700' },
  alertSub: { color: SOFT, fontSize: 12.5, marginTop: 1 },
  alertView: { color: INK, fontSize: 13.5, fontWeight: '700', textDecorationLine: 'underline' },
  hour: { width: HOUR_W, alignItems: 'center', gap: 5, paddingVertical: 8, borderRadius: 14 },
  dayCol: { position: 'absolute', left: 0, top: 8, bottom: 8, width: DAY_W, borderRadius: 12, backgroundColor: WX.leafTint, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  dayColText: { color: WX.deep, fontSize: 12, fontWeight: '800', lineHeight: 16 },
  moreWrap: { width: MORE_W, alignItems: 'center', justifyContent: 'center' },
  moreBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: WX.deep, alignItems: 'center', justifyContent: 'center', shadowColor: WX.deep, shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  hourText: { color: SOFT, fontSize: 12 },
  hourValue: { color: INK, fontSize: 16, fontWeight: '700' },
  hourSub: { color: SOFT, fontSize: 11, height: 14 },
  pills: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  pill: { minHeight: 44, paddingHorizontal: 16, borderRadius: 99, justifyContent: 'center', backgroundColor: WX.page, borderWidth: 1, borderColor: WX.line },
  pillOn: { backgroundColor: WX.deep, borderColor: WX.deep },
  pillText: { color: INK, fontSize: 14, fontWeight: '600' },
  day: { flexDirection: 'row', alignItems: 'center', minHeight: 54, gap: 8, borderRadius: 12, paddingHorizontal: 4 },
  dayLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: WX.line },
  dayName: { color: INK, fontSize: 15, fontWeight: '600' },
  daySnow: { fontSize: 11, lineHeight: 13 },
  dayIcon: { width: 44, alignItems: 'center' },
  dayPop: { color: WX.rain, fontSize: 10.5, fontWeight: '700' },
  dayLow: { color: SOFT, fontSize: 14, width: 32, textAlign: 'right' },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#E8EFE4', overflow: 'hidden' },
  barFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 3 },
  dayHigh: { color: INK, fontSize: 14, fontWeight: '700', width: 32 },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  big: { color: INK, fontSize: 32, fontWeight: '700', marginTop: 8 },
  bigSub: { color: SOFT, fontSize: 18, fontWeight: '600' },
  miniBars: { flexDirection: 'row', alignItems: 'flex-end', height: 46, marginTop: 12, gap: 2 },
  miniCol: { flex: 1, justifyContent: 'flex-end' },
  miniBar: { borderRadius: 2, width: '100%' },
  axisNote: { color: FAINT, fontSize: 11.5, marginTop: 6 },
  uvBar: { width: 26, height: 5, borderRadius: 3, marginTop: 4 },
  uvTrack: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 14 },
  humTrack: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 14 },
  humDot: { position: 'absolute', top: -2, width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: WX.deep },
  two: { flexDirection: 'row', gap: 14 },
  arcMid: { position: 'absolute', left: 0, right: 0, top: '42%', alignItems: 'center' },
  arcMain: { color: INK, fontSize: 14, fontWeight: '600' },
  sunCol: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sunRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  sunTime: { color: INK, fontSize: 22, fontWeight: '700' },
  sunLabel: { color: SOFT, fontSize: 13, marginTop: 1 },
  moonRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  moonName: { color: INK, fontSize: 16, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  moonNext: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  moonNextName: { color: INK, fontSize: 15, fontWeight: '600' },
  moonNextDate: { color: SOFT, fontSize: 13 },
  footWrap: { alignItems: 'center', marginTop: 18, gap: 10 },
  foot: { color: FAINT, fontSize: 11.5, textAlign: 'center', lineHeight: 16 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 18, borderRadius: 99, backgroundColor: WX.white, borderWidth: 1, borderColor: WX.line },
  refreshText: { color: INK, fontSize: 14, fontWeight: '600' },
  mini: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16 },
  miniText: { color: INK, fontSize: 14, fontWeight: '700' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10 },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#D9D7CE', marginBottom: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: '#26332B', fontSize: 18, fontWeight: '600' },
  sheetCancel: { color: '#5C6A61', fontSize: 14 },
  sheetNote: { color: '#5C6A61', fontSize: 12.5, marginTop: 8, marginBottom: 6 },
  townItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7E5DC' },
  townItemText: { color: '#26332B', fontSize: 16 },
  alertSender: { color: '#5C6A61', fontSize: 13, marginTop: 8 },
  alertHeadline: { color: '#26332B', fontSize: 15, fontWeight: '600', marginTop: 10 },
  alertBody: { color: '#3D4A42', fontSize: 14, lineHeight: 21, marginTop: 10 },
});
