import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useScrollToTop } from '@/lib/scrollTop';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage, useT } from '@/i18n';
import { useStormHistory } from '@/hooks/useStorm';
import { Panel, WX } from '@/components/weather/WeatherUI';
import { useVersionLabel } from '@/components/weather/StormPage';
import { actualSnow, messageFor, publishedText, snowRange, versionKind, type StormOutlook } from '@/lib/stormView';

const SNOW = '#1D5F9A';

/** Storm History: every storm outlook Brighton has posted, newest first. Tap one to read each update. Nothing posted is ever overwritten. */
export default function WeatherHistory() {
  const pageRef = useRef<ScrollView>(null);
  useScrollToTop('/weather/history', useCallback(() => { pageRef.current?.scrollTo({ y: 0, animated: true }); }, []));
  const t = useT();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es' : 'en-US';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const label = useVersionLabel();
  const { storms, loading, refresh } = useStormHistory();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useMemo(() => storms.find((s) => s.id === openId) ?? null, [storms, openId]);
  const pad = { paddingTop: insets.top + 14, paddingHorizontal: 18, paddingBottom: insets.bottom + 130 };

  const summary = (s: StormOutlook): string => {
    const final = s.versions.find((v) => v.actual_snow !== null) ?? null;
    const first = s.versions[s.versions.length - 1];
    const when = first?.published_at ? publishedText(first.published_at, locale) : '';
    const updates = t('{n} updates', { n: s.version_count });
    const outcome = final ? t('{n} measured', { n: actualSnow(final) as string }) : s.status === 'active' ? t('Active now') : '';
    const est = !final && s.latest ? snowRange(s.latest) : null;
    return [when, updates, outcome || (est ? t('estimate {n}', { n: est }) : '')].filter(Boolean).join(' · ');
  };

  if (open) {
    const measured = open.versions.find((v) => v.actual_snow !== null) ?? null;
    return (
      <ScrollView ref={pageRef} contentContainerStyle={pad} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => setOpenId(null)} accessibilityRole="button" accessibilityLabel={t('Storm History')} style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}>
          <MaterialCommunityIcons name="chevron-left" size={22} color={WX.ink} />
          <Text style={styles.backText}>{t('Storm History')}</Text>
        </Pressable>
        <Text style={[styles.title, { marginTop: 14 }]}>{open.name || open.latest?.headline}</Text>
        <Text style={styles.sub}>{summary(open)}</Text>
        {measured ? (
          <View style={styles.actual} accessible accessibilityLabel={`${t('Measured snowfall')}: ${actualSnow(measured)}`}>
            <Text style={styles.actualLabel}>{t('Measured snowfall')}</Text>
            <Text style={styles.actualValue}>{actualSnow(measured)}</Text>
            {measured.actual_source ? <Text style={styles.actualSrc}>{t('Source: {source}', { source: measured.actual_source })}</Text> : null}
          </View>
        ) : null}
        {open.status === 'active' ? (
          <Pressable onPress={() => router.push('/weather/outlook' as any)} accessibilityRole="button" style={({ pressed }) => [styles.openBtn, pressed && { opacity: 0.8 }]}>
            <Text style={styles.openBtnText}>{t('Open the outlook page')}</Text>
          </Pressable>
        ) : null}
        {open.versions.map((v, i) => {
          const est = snowRange(v);
          const kind = versionKind(v);
          return (
            <Panel key={v.id || v.version_no} style={{ marginTop: 12, borderColor: i === 0 && open.status === 'active' ? WX.leaf : WX.line }}>
              <View style={{ padding: 14 }}>
                <View style={styles.vHead}>
                  <Text style={styles.vTitle}>{label(v)}</Text>
                  <Text style={styles.vWhen}>{publishedText(v.published_at, locale)}</Text>
                </View>
                <Text style={styles.vHeadline}>{v.headline}</Text>
                <Text style={styles.vBody}>{messageFor(v, language).text}</Text>
                {est ? <View style={styles.est}><Text style={styles.estText}>{t('Estimate {n}', { n: est })}</Text></View> : null}
                <Text style={styles.lock}>{kind === 'original' ? t('Published and locked. The original is never changed.') : t('Published and locked.')}</Text>
              </View>
            </Panel>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <ScrollView ref={pageRef} contentContainerStyle={pad} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={WX.deep} />}>
      <Text style={styles.title}>{t('Storm History')}</Text>
      <Text style={styles.sub}>{t('Every storm outlook Brighton has posted. Nothing is ever overwritten.')}</Text>
      {storms.length === 0 ? (
        <Panel style={{ marginTop: 22 }}>
          <View style={{ padding: 18, gap: 6 }}>
            <MaterialCommunityIcons name="weather-snowy-heavy" size={30} color="#6FA8D8" />
            <Text style={styles.emptyTitle}>{loading ? t('Loading…') : t('No storm updates yet')}</Text>
            {!loading ? <Text style={styles.sub}>{t('When Brighton posts a storm outlook, it will appear here.')}</Text> : null}
          </View>
        </Panel>
      ) : (
        storms.map((s) => (
          <Pressable key={s.id} onPress={() => setOpenId(s.id)} accessibilityRole="button" accessibilityLabel={`${s.name || s.latest?.headline}. ${t('Open')}`} style={({ pressed }) => [{ marginTop: 12 }, pressed && { opacity: 0.8 }]}>
            <Panel>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stormName}>{s.name || s.latest?.headline}</Text>
                  <Text style={styles.stormMeta}>{summary(s)}</Text>
                </View>
                {s.status === 'active' ? <View style={styles.activeChip}><Text style={styles.activeText}>{t('Active')}</Text></View> : null}
                <MaterialCommunityIcons name="chevron-right" size={22} color={WX.faint} />
              </View>
            </Panel>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { color: WX.deep, fontSize: 28, fontWeight: '600' },
  sub: { color: WX.soft, fontSize: 14, marginTop: 4, lineHeight: 20 },
  emptyTitle: { color: WX.ink, fontSize: 16, fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, minHeight: 68 },
  stormName: { color: WX.deep, fontSize: 18, fontWeight: '600' },
  stormMeta: { color: WX.soft, fontSize: 13, marginTop: 3, lineHeight: 18 },
  activeChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 99, backgroundColor: WX.leafTint },
  activeText: { color: WX.deep, fontSize: 12, fontWeight: '800' },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 6, paddingRight: 16, borderRadius: 99, backgroundColor: WX.white, borderWidth: 1, borderColor: WX.line },
  backText: { color: WX.ink, fontSize: 16, fontWeight: '700' },
  actual: { marginTop: 14, borderRadius: 18, borderWidth: 2, borderColor: WX.leaf, backgroundColor: WX.white, padding: 14 },
  actualLabel: { color: SNOW, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase' },
  actualValue: { color: WX.deep, fontSize: 30, fontWeight: '600', marginTop: 2 },
  actualSrc: { color: WX.soft, fontSize: 13, marginTop: 2 },
  openBtn: { marginTop: 14, minHeight: 50, borderRadius: 99, backgroundColor: WX.deep, alignItems: 'center', justifyContent: 'center' },
  openBtnText: { color: WX.white, fontSize: 15.5, fontWeight: '700' },
  vHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  vTitle: { color: WX.deep, fontSize: 16, fontWeight: '700' },
  vWhen: { color: WX.faint, fontSize: 12.5 },
  vHeadline: { color: WX.ink, fontSize: 15.5, fontWeight: '700', marginTop: 6 },
  vBody: { color: WX.ink, fontSize: 14.5, lineHeight: 21, marginTop: 4 },
  est: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 99, backgroundColor: '#E6F2FC' },
  estText: { color: SNOW, fontSize: 13, fontWeight: '700' },
  lock: { color: WX.faint, fontSize: 12, marginTop: 10 },
});
