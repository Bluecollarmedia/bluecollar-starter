import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { Panel, WX } from '@/components/weather/WeatherUI';
import { snowRange, type StormOutlook } from '@/lib/stormView';
import { useVersionLabel } from '@/components/weather/StormPage';
import { StormMap } from '@/components/weather/StormMapView';

/** The card on the Weather home while a storm outlook is published. It is the same saved update the outlook page shows. */
export function StormCard({ storm, onPress }: { storm: StormOutlook; onPress: () => void }) {
  const t = useT();
  const label = useVersionLabel();
  const v = storm.latest;
  if (!v) return null;
  const snow = snowRange(v);
  const sub = `${snow ? t('{range} expected', { range: snow }) : t('Snowfall not estimated yet')} · ${label(v)}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${t("Brighton's Storm Outlook")}. ${v.headline}. ${t('Open')}`} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      <Panel bg="#FFFFFF" style={{ borderColor: '#B8D8F4' }}>
        <View style={styles.row}>
          <View style={styles.icon}><MaterialCommunityIcons name="weather-snowy" size={28} color="#4A9CE0" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tag}>{t("Brighton's Storm Outlook")}</Text>
            <Text style={styles.headline} numberOfLines={2}>{v.headline}</Text>
            <Text style={styles.sub} numberOfLines={2}>{sub}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={WX.faint} />
        </View>
        {v.map_url ? <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}><StormMap uri={v.map_url} label={t('Storm map')} onOpenCard /></View> : null}
      </Panel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 78 },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E6F2FC', alignItems: 'center', justifyContent: 'center' },
  tag: { color: '#1D5F9A', fontSize: 11.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  headline: { color: WX.deep, fontSize: 17, fontWeight: '600', marginTop: 2, lineHeight: 22 },
  sub: { color: WX.soft, fontSize: 13, marginTop: 2 },
});
