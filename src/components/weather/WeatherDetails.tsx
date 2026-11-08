import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { BottomSheetModal, useSheetPanRef } from '@/components/ui/BottomSheetModal';
import { ScrubArea } from '@/components/weather/ScrubArea';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage, useT } from '@/i18n';
import { axisStep, hourParts, hoursOnDate, hourLabel, orDash, tempColor, uvColor, viewTz, weekdayShort, todayInTowns, type WeatherPayload, type WxHour } from '@/lib/weatherView';
import { Panel, WX, WeatherBackground, WxPicture } from '@/components/weather/WeatherUI';

export type MetricKey = 'temp' | 'feels' | 'uv' | 'pop' | 'rain' | 'wind' | 'gust' | 'humidity' | 'dew' | 'cloud';
type Icon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
interface Metric { key: MetricKey; label: string; icon: Icon; kind: 'line' | 'bars'; get: (h: WxHour) => number | null; fmt: (v: number | null, h?: WxHour) => string; max?: number }

const METRICS: Metric[] = [
  { key: 'temp', label: 'Temperature', icon: 'thermometer', kind: 'line', get: (h) => h.tempF, fmt: (v) => orDash(v, '°') },
  { key: 'feels', label: 'Feels like', icon: 'thermometer-lines', kind: 'line', get: (h) => h.feelsF, fmt: (v) => orDash(v, '°') },
  { key: 'uv', label: 'UV index', icon: 'white-balance-sunny', kind: 'bars', max: 11, get: (h) => h.uvIndex, fmt: (v) => orDash(v) },
  { key: 'pop', label: 'Rain chance', icon: 'weather-pouring', kind: 'bars', max: 100, get: (h) => h.popPct, fmt: (v) => orDash(v, '%') },
  { key: 'rain', label: 'Rain amount', icon: 'water-outline', kind: 'bars', get: (h) => h.precipIn, fmt: (v) => orDash(v, ' in', 2) },
  { key: 'wind', label: 'Wind', icon: 'weather-windy', kind: 'line', get: (h) => h.windMph, fmt: (v, h) => (v === null ? '–' : `${Math.round(v)} mph ${h?.windDir ?? ''}`.trim()) },
  { key: 'gust', label: 'Wind gusts', icon: 'weather-windy-variant', kind: 'line', get: (h) => h.gustMph, fmt: (v) => orDash(v, ' mph') },
  { key: 'humidity', label: 'Humidity', icon: 'water-percent', kind: 'line', get: (h) => h.humidityPct, fmt: (v) => orDash(v, '%') },
  { key: 'dew', label: 'Dew point', icon: 'water-thermometer-outline', kind: 'line', get: (h) => h.dewF, fmt: (v) => orDash(v, '°') },
  { key: 'cloud', label: 'Cloud cover', icon: 'cloud-outline', kind: 'bars', max: 100, get: (h) => h.cloudPct, fmt: (v) => orDash(v, '%') },
];

const INK = WX.deep;
const SOFT = WX.soft;
const ON_DARK = '#FFFFFF';
const AXIS_W = 40;
const CHART_H = 190;

const hourOf = (iso: string): number => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: viewTz() }).format(new Date(iso)));
const dayTitle = (date: string, locale: string): string => new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

/** The labels under the chart: every hour that fits (every 2nd when the day is too long to fit them all), centred under its dot. */
function axisLabels(hours: WxHour[], plotW: number, locale: string, xAt: (i: number) => number): Chart['axis'] {
  const step = axisStep(hours.length, plotW);
  const out: Chart['axis'] = [];
  hours.forEach((h, i) => {
    const hr = hourOf(h.time);
    if (hr % step !== 0) return;
    const parts = hourParts(h.time, locale);
    const first = out.length === 0;
    out.push({ key: h.time, left: Math.max(0, Math.min(plotW - 40, xAt(i) - 20)), label: parts.num, sub: parts.period && (first || hr === 0 || hr === 12) ? parts.period : null });
  });
  return out;
}

/** Everything the chart needs, worked out once for a day, a figure and a width. Sliding a finger changes only the cursor, never this. */
interface Chart {
  keys: string[];
  values: Array<number | null>;
  known: number[];
  bars: boolean;
  plotW: number;
  barW: number;
  xs: number[];
  ys: Array<number | null>;
  grid: Array<{ y: number; label: string }>;
  /** One label per hour that fits: the hour's number, and its AM/PM underneath at the first one and at noon and midnight. */
  axis: Array<{ key: string; left: number; label: string; sub: string | null }>;
  stat: string;
  yRange: [number, number];
}

function buildChart(hours: WxHour[], metric: Metric, plotW: number, locale: string, t: (k: string, p?: Record<string, string | number>) => string): Chart {
  const values = hours.map((h) => metric.get(h));
  const known = values.filter((v): v is number => v !== null);
  const bars = metric.kind === 'bars';
  let lo = 0; let hi = 1;
  if (known.length) {
    if (bars) { lo = 0; hi = metric.max ?? Math.max(0.1, Math.max(...known)); }
    else {
      lo = Math.floor(Math.min(...known) - 1); hi = Math.ceil(Math.max(...known) + 1);
      if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = Math.floor(mid - 3); hi = Math.ceil(mid + 3); }
    }
  }
  const xAt = (i: number) => (hours.length <= 1 ? plotW / 2 : (i / (hours.length - 1)) * plotW);
  const yAt = (v: number) => CHART_H - ((v - lo) / (hi - lo || 1)) * CHART_H;
  let stat: string;
  if (!known.length) stat = t('Unavailable');
  else if (metric.key === 'rain') stat = t('{n} in for the day', { n: known.reduce((a, b) => a + b, 0).toFixed(2) });
  else {
    const hiV = Math.max(...known); const loV = Math.min(...known);
    const hiH = hours[values.indexOf(hiV)]; const loH = hours[values.indexOf(loV)];
    stat = bars
      ? t('Highest {v} around {time}', { v: metric.fmt(hiV, hiH), time: hourLabel(hiH.time, locale) })
      : t('High {high} at {hi} · Low {low} at {lo}', { high: metric.fmt(hiV, hiH), hi: hourLabel(hiH.time, locale), low: metric.fmt(loV, loH), lo: hourLabel(loH.time, locale) });
  }
  return {
    keys: hours.map((h) => h.time),
    values, known, bars, plotW,
    barW: Math.max(3, plotW / Math.max(1, hours.length) - 2),
    xs: hours.map((_, i) => xAt(i)),
    ys: values.map((v) => (v === null ? null : yAt(v))),
    grid: [0, 1, 2, 3].map((k) => { const g = lo + ((hi - lo) * k) / 3; return { y: yAt(g), label: metric.fmt(g, undefined).replace(/ mph.*/, '') }; }),
    axis: axisLabels(hours, plotW, locale, xAt),
    stat,
    yRange: [lo, hi],
  };
}

/** The lines, dots, bars and grid. Memoised on the chart object, so a finger sliding across the chart never rebuilds them. */
const ChartMarks = memo(function ChartMarks({ chart, metricKey }: { chart: Chart; metricKey: MetricKey }) {
  const { xs, ys, values, keys, bars, barW } = chart;
  const nodes: React.ReactNode[] = [];
  chart.grid.forEach((g, k) => nodes.push(<View key={`g${k}`} style={{ position: 'absolute', left: 0, right: 0, top: g.y - 0.5, height: StyleSheet.hairlineWidth, backgroundColor: WX.line }} />));
  if (bars) {
    keys.forEach((key, i) => {
      const y = ys[i]; if (y === null) return;
      const top = Math.min(CHART_H - 2, y);
      nodes.push(<View key={`b${key}`} style={{ position: 'absolute', left: xs[i] - barW / 2, width: barW, top, height: CHART_H - top, borderRadius: 3, backgroundColor: metricKey === 'uv' ? uvColor(values[i]) : '#8EC3F0', opacity: 0.85 }} />);
    });
  } else {
    for (let i = 0; i < keys.length - 1; i++) {
      const ya = ys[i]; const yb = ys[i + 1]; const b = values[i + 1];
      if (ya === null || yb === null) continue;
      const x1 = xs[i]; const x2 = xs[i + 1];
      const len = Math.hypot(x2 - x1, yb - ya);
      nodes.push(<View key={`s${i}`} style={{ position: 'absolute', left: (x1 + x2) / 2 - len / 2, top: (ya + yb) / 2 - 1.5, width: len, height: 3, borderRadius: 2, backgroundColor: metricKey === 'temp' ? tempColor(b) : WX.rain, transform: [{ rotate: `${Math.atan2(yb - ya, x2 - x1)}rad` }] }} />);
    }
    keys.forEach((key, i) => {
      const y = ys[i]; const v = values[i]; if (y === null || v === null) return;
      nodes.push(<View key={`d${key}`} style={{ position: 'absolute', left: xs[i] - 3, top: y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: metricKey === 'temp' ? tempColor(v) : WX.rain, borderWidth: 1.5, borderColor: '#FFFFFF' }} />);
    });
  }
  return <>{nodes}</>;
});

/** The moving part: the vertical line, the big dot (or the highlighted bar) at the chosen hour. A few views, so it is cheap to redraw on every move. */
function Cursor({ chart, idx, metricKey }: { chart: Chart; idx: number; metricKey: MetricKey }) {
  const x = chart.xs[idx]; const y = chart.ys[idx]; const v = chart.values[idx];
  if (x === undefined) return null;
  return (
    <>
      {chart.bars && y !== null ? <View style={{ position: 'absolute', left: x - chart.barW / 2, width: chart.barW, top: Math.min(CHART_H - 2, y), height: CHART_H - Math.min(CHART_H - 2, y), borderRadius: 3, backgroundColor: WX.deep }} /> : null}
      <View style={{ position: 'absolute', left: x - 1, top: 0, width: 2, height: CHART_H, backgroundColor: WX.deep }} />
      {!chart.bars && y !== null && v !== null ? <View style={{ position: 'absolute', left: x - 7, top: y - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: metricKey === 'temp' ? tempColor(v) : WX.rain }} /> : null}
    </>
  );
}

/** One "choose what to see" tile. Memoised: it redraws only when its own text or state changes. */
const MetricTile = memo(function MetricTile({ metric, on, valueText, off, label, a11y, onPress }: { metric: Metric; on: boolean; valueText: string; off: boolean; label: string; a11y: string; onPress: (k: MetricKey) => void }) {
  return (
    <Pressable onPress={() => onPress(metric.key)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={a11y} style={({ pressed }) => [styles.tile, on && styles.tileOn, pressed && { opacity: 0.75 }]}>
      <View style={styles.tileHead}>
        <MaterialCommunityIcons name={metric.icon} size={16} color={on ? ON_DARK : SOFT} />
        <Text style={[styles.tileLabel, on && { color: ON_DARK }]} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={[styles.tileValue, on && { color: ON_DARK }, off && styles.tileOff, off && on && { color: '#D7E8DD' }]} numberOfLines={1}>{valueText}</Text>
    </Pressable>
  );
});

const DayChip = memo(function DayChip({ date, label, a11y, on, empty, onSelect }: { date: string; label: string; a11y: string; on: boolean; empty: boolean; onSelect: (date: string) => void }) {
  return (
    <Pressable
      disabled={empty}
      onPress={() => onSelect(date)}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: empty }}
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.day, on && styles.dayOn, empty && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.dayText, on && { fontWeight: '700', color: ON_DARK }]}>{label}</Text>
    </Pressable>
  );
});

export interface DetailsStart { date: string; time?: string; metric?: MetricKey }

/**
 * The details screen: pick a day, pick a figure, then drag across the chart (or tap, or use the arrows) to read it hour by hour.
 * It opens as a sheet over the weather home, so closing it brings the person back to exactly where they were.
 */
// The page's scroll view is a gesture-handler one, so it can be told to run together with the sheet's swipe-down (see BottomSheetModal).
const AnimatedSheetScrollView = Animated.createAnimatedComponent(GHScrollView);
/** How far past the top the page must be pulled (and let go) to close the sheet. */
const PULL_TO_CLOSE = 60;

export function WeatherDetails({ visible, data, start, onClose }: { visible: boolean; data: WeatherPayload | null; start: DetailsStart | null; onClose: () => void }) {
  const t = useT();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es' : 'en-US';
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const sheetPan = useSheetPanRef();
  // Pulling the page down past its top: the WHOLE sheet follows the finger (BottomSheetModal moves by `pull`), while the page's content is held
  // still inside it (contentHold cancels the scroll view's own rubber band), so nothing stretches and no gap opens at the top. Let go far enough
  // and it closes; otherwise the rubber band springs it back. This rides on the scroll view's own gesture, so nothing can beat it to the touch.
  const pull = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => { const y = e.contentOffset.y; scrollY.value = y; pull.value = Math.max(0, -y); },
    onEndDrag: (e) => { if (e.contentOffset.y < -PULL_TO_CLOSE) runOnJS(onClose)(); },
  });
  const contentHold = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, scrollY.value) }] }));
  const [date, setDate] = useState('');
  const [idx, setIdx] = useState(0);
  const [metricKey, setMetricKey] = useState<MetricKey>('temp');
  const [width, setWidth] = useState(0);

  const days = data?.daily ?? [];
  const hours = useMemo(() => (data && date ? hoursOnDate(data.hourly, date) : []), [data, date]);
  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];

  // When the sheet opens, land on the day (and hour) that was tapped.
  useEffect(() => {
    if (!visible || !data || !start) return;
    const hs = hoursOnDate(data.hourly, start.date);
    let i = start.time ? hs.findIndex((h) => h.time === start.time) : -1;
    if (i < 0) i = start.date === todayInTowns(Date.now()) ? 0 : Math.max(0, hs.findIndex((h) => hourOf(h.time) >= 12));
    setDate(start.date);
    setIdx(Math.max(0, i));
    setMetricKey(start.metric ?? 'temp');
  }, [visible, data, start]);

  const selected: WxHour | undefined = hours[Math.min(idx, hours.length - 1)];
  const plotW = Math.max(0, width - AXIS_W);
  const chart = useMemo(() => buildChart(hours, metric, plotW, locale, t), [hours, metric, plotW, locale, t]);
  const bars = chart.bars;

  // Sliding a finger across the chart picks the hour under it, live. A tap does the same, and the arrows below do it too, so sliding is only ever
  // a shortcut. No vibration, and nothing happens at touch-down, so swiping the sheet down is never held up.
  const pickHour = useCallback((i: number) => { setIdx(i); }, []);
  const chooseDay = useCallback((d: string) => {
    setDate(d);
    const hs = data ? hoursOnDate(data.hourly, d) : [];
    setIdx(d === todayInTowns(Date.now()) ? 0 : Math.max(0, hs.findIndex((h) => hourOf(h.time) >= 12)));
  }, [data]);
  // The tiles follow the finger one step behind (React may skip their redraw while the finger is still moving), so the cursor and the readout never wait for them.
  const tileIdx = useDeferredValue(idx);
  const tileSel: WxHour | undefined = hours[Math.min(tileIdx, hours.length - 1)];
  const header = useMemo(() => (
    <View style={styles.head}>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close details')} style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]} hitSlop={6}>
        <View style={styles.backGlass}>
          <View style={styles.backRow}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={INK} />
            <Text style={styles.backText}>{t('Back')}</Text>
          </View>
        </View>
      </Pressable>
      <View style={styles.headTitle} pointerEvents="none">
        <Text style={styles.title}>{t('Details')}</Text>
        <Text style={styles.subtitle}>{data?.townName}</Text>
      </View>
    </View>
  ), [onClose, t, data?.townName]);
  const dayRow = useMemo(() => (
    <View style={styles.days}>
      {days.map((d) => {
        const empty = !data || hoursOnDate(data.hourly, d.date).length === 0;
        return <DayChip key={d.date} date={d.date} label={weekdayShort(d.date, locale)} a11y={dayTitle(d.date, locale)} on={d.date === date} empty={empty} onSelect={chooseDay} />;
      })}
    </View>
  ), [days, data, date, locale, chooseDay]);
  const setMetric = useCallback((k: MetricKey) => setMetricKey(k), []);

  const sel = selected;
  const selVal = sel ? metric.get(sel) : null;
  const stat = chart.stat;
  const go = (d: number) => setIdx((i) => Math.max(0, Math.min(hours.length - 1, i + d)));
  const hasHours = hours.length > 0;

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose} scrollOffset={scrollY} closeDistance={36} closeVelocity={450} pull={pull}>
      <View style={{ flex: 1 }}>
      <View style={{ flex: 1, marginTop: insets.top + 8, backgroundColor: WX.page, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }}>
        <WeatherBackground />
        <AnimatedSheetScrollView simultaneousHandlers={sheetPan} onScroll={onScroll} scrollEventThrottle={16} bounces alwaysBounceVertical contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 18, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Animated.View style={contentHold}>
          {header}

          {dayRow}

          <Panel style={{ marginTop: 14 }}>
            <View style={styles.pad}>
              <Text style={styles.chartTitle}>{t(metric.label)} · {date ? dayTitle(date, locale) : ''}</Text>
              <Text style={styles.chartStat}>{stat}</Text>

              {hasHours && sel ? (
                <View style={styles.readout} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${t(metric.label)}, ${metric.fmt(selVal, sel)}, ${hourLabel(sel.time, locale)}`}>
                  <WxPicture icon={sel.icon} size={46} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.readValue}>{selVal === null ? t('Unavailable') : metric.fmt(selVal, sel)}</Text>
                    <Text style={styles.readTime}>{hourLabel(sel.time, locale)} · {dayTitle(date, locale)}</Text>
                  </View>
                  <Pressable onPress={() => go(-1)} disabled={idx <= 0} accessibilityRole="button" accessibilityLabel={t('Previous hour')} style={({ pressed }) => [styles.step, idx <= 0 && { opacity: 0.35 }, pressed && { opacity: 0.6 }]}>
                    <MaterialCommunityIcons name="chevron-left" size={26} color={INK} />
                  </Pressable>
                  <Pressable onPress={() => go(1)} disabled={idx >= hours.length - 1} accessibilityRole="button" accessibilityLabel={t('Next hour')} style={({ pressed }) => [styles.step, idx >= hours.length - 1 && { opacity: 0.35 }, pressed && { opacity: 0.6 }]}>
                    <MaterialCommunityIcons name="chevron-right" size={26} color={INK} />
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.empty}>{t('No hourly figures for this day yet.')}</Text>
              )}

              {hasHours ? (
                <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ marginTop: 10 }}>
                  {width > 0 ? (
                    <View style={{ height: CHART_H + 40 }}>
                      <View style={{ height: CHART_H, width: plotW }} accessible={false}>
                        <ChartMarks chart={chart} metricKey={metricKey} />
                        {sel ? <Cursor chart={chart} idx={Math.min(idx, hours.length - 1)} metricKey={metricKey} /> : null}
                      </View>
                      <ScrubArea width={plotW} count={hours.length} onPick={pickHour} style={{ position: 'absolute', left: 0, top: 0, width: plotW, height: CHART_H }} />
                      {chart.grid.map((g, k) => <Text key={k} style={[styles.axisY, { top: g.y - 8 }]}>{g.label}</Text>)}
                      {chart.axis.map((a) => (
                        <View key={a.key} style={[styles.axisX, { left: a.left, top: CHART_H + 6 }]}>
                          <Text style={styles.axisXText}>{a.label}</Text>
                          {a.sub ? <Text style={styles.axisSub}>{a.sub}</Text> : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
              <Text style={styles.hint}>{t('Slide your finger across the chart, or use the arrows, to move hour by hour.')}</Text>
            </View>
          </Panel>

          <Text style={styles.section}>{t('Choose what to see')}</Text>
          <View style={styles.grid}>
            {METRICS.map((m) => {
              const v = tileSel ? m.get(tileSel) : null;
              const text = v === null ? t('Unavailable') : m.fmt(v, tileSel);
              return <MetricTile key={m.key} metric={m} on={m.key === metricKey} valueText={text} off={v === null} label={t(m.label)} a11y={`${t(m.label)}, ${text}`} onPress={setMetric} />;
            })}
          </View>
        </Animated.View>
        </AnimatedSheetScrollView>
      </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  head: { height: 52, justifyContent: 'center' },
  back: { alignSelf: 'flex-start', zIndex: 2 },
  backGlass: { borderRadius: 99, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: WX.line, shadowColor: '#14803C', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  backRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 8, paddingRight: 16 },
  backText: { color: INK, fontSize: 16, fontWeight: '700' },
  headTitle: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  title: { color: INK, fontSize: 17, fontWeight: '700' },
  subtitle: { color: SOFT, fontSize: 12.5 },
  days: { flexDirection: 'row', gap: 6, marginTop: 6 },
  day: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: WX.line },
  dayOn: { backgroundColor: WX.deep, borderColor: WX.deep },
  dayText: { color: INK, fontSize: 13 },
  pad: { padding: 16 },
  chartTitle: { color: INK, fontSize: 15, fontWeight: '700' },
  chartStat: { color: SOFT, fontSize: 13, marginTop: 3, lineHeight: 18 },
  readout: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 10, borderRadius: 16, backgroundColor: WX.leafTint },
  readValue: { color: INK, fontSize: 24, fontWeight: '700' },
  readTime: { color: SOFT, fontSize: 12.5, marginTop: 1 },
  step: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: WX.line },
  empty: { color: SOFT, fontSize: 13.5, marginTop: 14 },
  axisY: { position: 'absolute', right: 0, width: AXIS_W - 4, textAlign: 'right', color: SOFT, fontSize: 11 },
  axisX: { position: 'absolute', width: 40, alignItems: 'center' },
  axisXText: { color: SOFT, fontSize: 11 },
  axisSub: { color: SOFT, fontSize: 9, fontWeight: '700', marginTop: 1 },
  hint: { color: WX.faint, fontSize: 12, marginTop: 10 },
  section: { color: INK, fontSize: 14, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', minHeight: 74, borderRadius: 18, padding: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: WX.line, justifyContent: 'space-between' },
  tileOn: { backgroundColor: WX.deep, borderColor: WX.deep },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileLabel: { color: SOFT, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  tileValue: { color: INK, fontSize: 21, fontWeight: '700', marginTop: 6 },
  tileOff: { fontSize: 14, fontWeight: '500', color: WX.faint },
});
