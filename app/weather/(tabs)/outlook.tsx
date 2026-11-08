import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { useCurrentStorm } from '@/hooks/useStorm';
import { StormPage } from '@/components/weather/StormPage';
import { Panel, WX } from '@/components/weather/WeatherUI';

/** Brighton's storm outlook: the page every visitor sees. It shows the latest saved update of the storm that is published right now. */
export default function WeatherOutlook() {
  return <WeatherOutlookScreen />;
}

/** `embedded` is the signed-in version (a sheet over the forecast): its buttons close the sheet instead of using the public routes. */
export function WeatherOutlookScreen({ embedded = false, onBack }: { embedded?: boolean; onBack?: () => void }) {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { storm, ready } = useCurrentStorm();
  const goBack = () => { if (onBack) onBack(); else if (router.canGoBack()) router.back(); else router.replace('/weather' as any); };

  if (!storm?.latest) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top + 14, paddingHorizontal: 18 }}>
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel={t('Back')} style={({ pressed }) => [styles.back, pressed && { opacity: 0.7 }]}>
          <MaterialCommunityIcons name="chevron-left" size={22} color={WX.ink} />
          <Text style={styles.backText}>{t('Back')}</Text>
        </Pressable>
        <Panel style={{ marginTop: 22 }}>
          <View style={{ padding: 18, gap: 6 }}>
            <Text style={styles.title}>{ready ? t('No storm outlook right now') : t('Loading…')}</Text>
            {ready ? <Text style={styles.body}>{t('When Brighton posts a storm outlook, it will appear here and on the weather home.')}</Text> : null}
          </View>
        </Panel>
      </View>
    );
  }
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}>
      <StormPage
        outlook={storm}
        version={storm.latest}
        onBack={goBack}
        onSeeForecast={() => (embedded ? goBack() : router.replace('/weather' as any))}
        onSeeUpdates={embedded ? undefined : () => router.push('/weather/history' as any)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 6, paddingRight: 16, borderRadius: 99, backgroundColor: WX.white, borderWidth: 1, borderColor: WX.line },
  backText: { color: WX.ink, fontSize: 16, fontWeight: '700' },
  title: { color: WX.ink, fontSize: 17, fontWeight: '700' },
  body: { color: WX.soft, fontSize: 14.5, lineHeight: 21 },
});
