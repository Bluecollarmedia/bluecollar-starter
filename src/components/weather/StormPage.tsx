import React from 'react';
import { Image, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLanguage, useT } from '@/i18n';
import { Panel, WX } from '@/components/weather/WeatherUI';
import { StormMap } from '@/components/weather/StormMapView';
import { actualSnow, messageFor, publishedText, snowRange, versionKind, whenText, type StormOutlook, type StormVersion } from '@/lib/stormView';

const HERO_RATIO = 1640 / 1170;

const SNOW = '#1D5F9A';

/** The label for an update: "Update 1 · Original", "Update 2", "Update 3 · Final". */
export function useVersionLabel() {
  const t = useT();
  return (v: Pick<StormVersion, 'version_no' | 'is_final'>) => {
    const k = versionKind(v);
    const base = t('Update {n}', { n: v.version_no });
    return k === 'final' ? `${base} · ${t('Final')}` : k === 'original' ? `${base} · ${t('Original')}` : base;
  };
}

/**
 * Brighton's storm outlook page: what every visitor sees when they open the outlook (and what the owner previews before publishing).
 * The words are the owner's own; nothing is translated automatically. Snowfall the owner has no estimate for says "Unavailable", never 0,
 * and measured snowfall appears only when the owner entered it, with its source.
 */
export function StormPage({ outlook, version, onBack, onSeeForecast, onSeeUpdates, preview = false }: {
  outlook: Pick<StormOutlook, 'name' | 'status' | 'version_count'>;
  version: StormVersion;
  onBack?: () => void;
  onSeeForecast?: () => void;
  onSeeUpdates?: () => void;
  preview?: boolean;
}) {
  const t = useT();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es' : 'en-US';
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const label = useVersionLabel();
  const snow = snowRange(version);
  const actual = actualSnow(version);
  const msg = messageFor(version, language);
  const start = whenText(version.starts_at, locale);
  const end = whenText(version.ends_at, locale);
  const timing = start && end ? `${start} – ${end}` : start ? t('From {time}', { time: start }) : end ? t('Until {time}', { time: end }) : '';
  const stamp = version.published_at ? publishedText(version.published_at, locale) : t('Just now');

  const share = async () => {
    const lines = [version.headline, snow ? `${t('Snowfall')}: ${snow}` : '', timing ? `${t('Timing')}: ${timing}` : '', '', msg.text, '', version.disclaimer].filter((l, i, a) => l !== '' || a[i - 1] !== '');
    try { await Share.share({ message: lines.join('\n') }); } catch { /* the person closed the share sheet */ }
  };

  return (
    <View>
      <Image source={require('../../../assets/images/weather-hero.jpg')} style={{ position: 'absolute', top: 0, left: 0, width, height: width * HERO_RATIO }} resizeMode="cover" accessible={false} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 18 }}>
        <View style={styles.brandRow}>
          <Image source={require('../../../assets/images/logo-leaf.png')} style={styles.leaf} />
          <View>
            <Text style={styles.brandName}>BRIGHTON</Text>
            <Text style={styles.brandSub}>FORECAST</Text>
          </View>
        </View>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('Back')} style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={WX.ink} />
            <Text style={styles.backText}>{t('Back')}</Text>
          </Pressable>
        ) : null}
        <View style={styles.chipRow}>
          <View style={styles.chip}><Text style={styles.chipText}>{label(version)} · {stamp}</Text></View>
          {outlook.status === 'ended' ? <View style={[styles.chip, { backgroundColor: WX.leafTint }]}><Text style={[styles.chipText, { color: WX.deep }]}>{t('Ended')}</Text></View> : null}
        </View>
        <Text style={styles.tag}>{t("Brighton's Storm Outlook")}</Text>
        <Text style={styles.headline} accessibilityRole="header">{version.headline}</Text>
        {outlook.name ? <Text style={styles.name}>{outlook.name}</Text> : null}

        <View style={styles.facts}>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>{t('Snowfall')}</Text>
            <Text style={[styles.factValue, !snow && styles.factOff]}>{snow ?? t('Unavailable')}</Text>
            <Text style={styles.factSub}>{t("Brighton's estimate")}</Text>
          </View>
          {timing ? (
            <View style={styles.fact}>
              <Text style={styles.factLabel}>{t('Timing')}</Text>
              <Text style={[styles.factValue, { fontSize: 18 }]}>{timing}</Text>
              <Text style={styles.factSub}>{t('Eastern time')}</Text>
            </View>
          ) : null}
        </View>

        {actual ? (
          <View style={styles.actual} accessible accessibilityLabel={`${t('Measured snowfall')}: ${actual}`}>
            <Text style={styles.factLabel}>{t('Measured snowfall')}</Text>
            <Text style={styles.actualValue}>{actual}</Text>
            {version.actual_source ? <Text style={styles.factSub}>{t('Source: {source}', { source: version.actual_source })}</Text> : null}
          </View>
        ) : null}

        {version.map_url ? <StormMap uri={version.map_url} label={t('Storm map')} /> : null}

        <Panel style={{ marginTop: 14 }}>
          <View style={{ padding: 16 }}>
            <Text style={styles.message} selectable>{msg.text}</Text>
            {language === 'es' && !msg.spanish ? <Text style={styles.langNote}>{t("Brighton's message is shown in English.")}</Text> : null}
          </View>
        </Panel>

        <View style={styles.disclaimer}><Text style={styles.disclaimerText}>{version.disclaimer}</Text></View>

        {!preview ? (
          <>
            <View style={styles.buttons}>
              <Pressable onPress={share} accessibilityRole="button" accessibilityLabel={t('Share')} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}>
                <MaterialCommunityIcons name="share-variant-outline" size={20} color={WX.ink} />
                <Text style={styles.btnText}>{t('Share')}</Text>
              </Pressable>
              {onSeeForecast ? (
                <Pressable onPress={onSeeForecast} accessibilityRole="button" accessibilityLabel={t('See the forecast')} style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.btnText, { color: WX.white }]}>{t('See the forecast')}</Text>
                </Pressable>
              ) : null}
            </View>
            {onSeeUpdates && outlook.version_count > 1 ? (
              <Pressable onPress={onSeeUpdates} accessibilityRole="button" style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.link}>{t('See all {n} updates', { n: outlook.version_count })}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={WX.deep} />
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  leaf: { width: 34, height: 34, tintColor: WX.leaf },
  brandName: { color: WX.deep, fontSize: 16, fontWeight: '600', letterSpacing: 2.6 },
  brandSub: { color: WX.soft, fontSize: 10, fontWeight: '600', letterSpacing: 5.6, marginTop: 2 },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 6, paddingRight: 16, marginTop: 10, borderRadius: 99, backgroundColor: WX.white, borderWidth: 1, borderColor: WX.line },
  backText: { color: WX.ink, fontSize: 16, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: '#E6F2FC' },
  chipText: { color: SNOW, fontSize: 12.5, fontWeight: '700' },
  tag: { color: SNOW, fontSize: 12, fontWeight: '800', letterSpacing: 1.6, textTransform: 'uppercase', marginTop: 16 },
  headline: { color: WX.deep, fontSize: 30, fontWeight: '600', lineHeight: 36, marginTop: 4 },
  name: { color: WX.soft, fontSize: 15, marginTop: 4 },
  facts: { flexDirection: 'row', gap: 10, marginTop: 14 },
  fact: { flex: 1, backgroundColor: '#E6F2FC', borderRadius: 18, padding: 14 },
  factLabel: { color: SNOW, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase' },
  factValue: { color: WX.deep, fontSize: 26, fontWeight: '600', marginTop: 4 },
  factOff: { fontSize: 16, fontWeight: '500', color: WX.faint, marginTop: 8 },
  factSub: { color: WX.soft, fontSize: 12.5, marginTop: 2 },
  actual: { marginTop: 12, borderRadius: 18, borderWidth: 2, borderColor: WX.leaf, backgroundColor: WX.white, padding: 14 },
  actualValue: { color: WX.deep, fontSize: 28, fontWeight: '600', marginTop: 2 },
  message: { color: WX.ink, fontSize: 16.5, lineHeight: 25 },
  langNote: { color: WX.faint, fontSize: 12.5, marginTop: 10 },
  disclaimer: { marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: '#FFF4DC', borderWidth: 1, borderColor: '#F0D9A4' },
  disclaimerText: { color: '#5A4310', fontSize: 13.5, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, minHeight: 50, borderRadius: 99, borderWidth: 1, borderColor: WX.line, backgroundColor: WX.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnPrimary: { backgroundColor: WX.deep, borderColor: WX.deep },
  btnText: { color: WX.ink, fontSize: 15.5, fontWeight: '700' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: 6 },
  link: { color: WX.deep, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
});
