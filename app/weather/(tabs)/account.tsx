import React, { useCallback, useRef } from 'react';
import { useScrollToTop } from '@/lib/scrollTop';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { LanguageSwitch } from '@/components/ui/LanguageSwitch';
import { Panel, WX } from '@/components/weather/WeatherUI';
import { BRIGHTON_EMAIL, BRIGHTON_PHONE_DISPLAY, BRIGHTON_PHONE_LINK } from '@/lib/serviceRequest';

/** Brighton (this tab used to be called Account). Sign In opens the app's existing welcome and sign-in screens, unchanged; Call and Email reach Brighton directly. */
export default function WeatherAccount() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pageRef = useRef<ScrollView>(null);
  useScrollToTop('/weather/account', useCallback(() => { pageRef.current?.scrollTo({ y: 0, animated: true }); }, []));
  return (
    <ScrollView ref={pageRef} contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: 18, paddingBottom: insets.bottom + 130 }}>
      <Text style={styles.title}>{t('Brighton')}</Text>
      <Text style={styles.sub}>{t('Need work done, or already part of the team?')}</Text>
      <Pressable onPress={() => router.push('/(auth)/welcome' as any)} accessibilityRole="button" accessibilityLabel={t('Sign In')} style={({ pressed }) => [{ marginTop: 22 }, pressed && { opacity: 0.8 }]}>
        <Panel>
          <View style={styles.row}>
            <MaterialCommunityIcons name="account-circle-outline" size={28} color={WX.deep} />
            <Text style={styles.rowText}>{t('Sign In')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={24} color={WX.faint} />
          </View>
        </Panel>
      </Pressable>
      <Pressable onPress={() => { void Linking.openURL(BRIGHTON_PHONE_LINK); }} accessibilityRole="button" accessibilityLabel={`${t('Call us')} ${BRIGHTON_PHONE_DISPLAY}`} style={({ pressed }) => [{ marginTop: 12 }, pressed && { opacity: 0.8 }]}>
        <Panel>
          <View style={styles.row}>
            <MaterialCommunityIcons name="phone-outline" size={26} color={WX.deep} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowText}>{t('Call us')}</Text>
              <Text style={styles.rowSub}>{BRIGHTON_PHONE_DISPLAY}</Text>
            </View>
          </View>
        </Panel>
      </Pressable>
      <Pressable onPress={() => { void Linking.openURL(`mailto:${BRIGHTON_EMAIL}`); }} accessibilityRole="button" accessibilityLabel={`${t('Email us')} ${BRIGHTON_EMAIL}`} style={({ pressed }) => [{ marginTop: 12 }, pressed && { opacity: 0.8 }]}>
        <Panel>
          <View style={styles.row}>
            <MaterialCommunityIcons name="email-outline" size={26} color={WX.deep} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowText}>{t('Email us')}</Text>
              <Text style={styles.rowSub}>{BRIGHTON_EMAIL}</Text>
            </View>
          </View>
        </Panel>
      </Pressable>
      <View style={{ marginTop: 24, alignItems: 'flex-start' }}>
        <LanguageSwitch />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { color: WX.deep, fontSize: 28, fontWeight: '600' },
  sub: { color: WX.soft, fontSize: 14, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, minHeight: 64 },
  rowText: { flex: 1, color: WX.ink, fontSize: 17, fontWeight: '600' },
  rowSub: { color: WX.soft, fontSize: 13, marginTop: 1 },
});
