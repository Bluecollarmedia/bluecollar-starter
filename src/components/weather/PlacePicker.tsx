import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { InteractionManager, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { BottomSheetModal } from '@/components/ui/BottomSheetModal';
import { WX } from '@/components/weather/WeatherUI';
import { pushRecent, readRecents } from '@/data/weather';
import { parsePlaces, searchPlaces, type FoundPlace } from '@/lib/placeSearch';
import { DEFAULT_PLACE, WEATHER_TOWNS, placeKey, type Place } from '@/lib/weatherTowns';

let loaded: FoundPlace[] | null = null;
/** The list of US places, read the first time someone searches (it has about 43,000 entries). */
function allPlaces(): FoundPlace[] {
  if (!loaded) loaded = parsePlaces(require('../../../assets/data/us-places.json') as string[]);
  return loaded;
}

const builtIn = (name: string, state: string): Place | undefined => WEATHER_TOWNS.find((t) => t.state === state && t.name.toLowerCase() === name.toLowerCase());
export const toPlace = (f: FoundPlace): Place => {
  const b = builtIn(f.name, f.state);
  return b ? { ...b } : { key: placeKey(f.lat, f.lon), name: f.name, state: f.state, lat: f.lat, lon: f.lon };
};

/** Choose where to show the weather: type any US town or city, or tap one of the recent or nearby towns. */
export function PlacePicker({ visible, current, onClose, onPick }: { visible: boolean; current: Place; onClose: () => void; onPick: (p: Place) => void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<Place[]>([]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    void readRecents().then(setRecents);
    // Build the town list while the sheet slides up, so the first letter typed never waits for it.
    const warm = InteractionManager.runAfterInteractions(() => { allPlaces(); });
    return () => warm.cancel();
  }, [visible]);
  // The list follows what is typed one step behind, so typing itself is never held up by a search.
  const typed = useDeferredValue(query);
  const results = useMemo(() => (visible && typed.trim().length >= 2 ? searchPlaces(allPlaces(), typed, DEFAULT_PLACE, 8) : []), [visible, typed]);
  const searching = typed.trim().length >= 2;

  const choose = (p: Place) => { void pushRecent(p); onPick(p); };
  const row = (p: Place, key: string) => (
    <Pressable key={key} onPress={() => choose(p)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.state}`} style={({ pressed }) => [styles.item, pressed && { backgroundColor: WX.leafTint }]}>
      <Text style={styles.itemText}>{p.name}{p.state ? <Text style={styles.itemState}>, {p.state}</Text> : null}</Text>
      {p.key === current.key ? <MaterialCommunityIcons name="check" size={20} color={WX.deep} /> : null}
    </Pressable>
  );

  return (
    <BottomSheetModal visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('Close')} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.grip} />
            <View style={styles.head}>
              <Text style={styles.title}>{t('Choose your place')}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" style={styles.cancelBtn}><Text style={styles.cancel}>{t('Cancel')}</Text></Pressable>
            </View>
            <View style={styles.search}>
              <MaterialCommunityIcons name="magnify" size={22} color={WX.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('Search any US town or city')}
                placeholderTextColor={WX.faint}
                style={styles.input}
                autoCorrect={false}
                autoCapitalize="words"
                returnKeyType="search"
                clearButtonMode="while-editing"
                accessibilityLabel={t('Search any US town or city')}
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {searching ? (
                results.length ? results.map((f) => { const p = toPlace(f); return row(p, `${f.name}|${f.state}|${f.lat}`); }) : <Text style={styles.empty}>{t('No match. Try the town name and state, like Toms River NJ.')}</Text>
              ) : (
                <>
                  {recents.length ? <Text style={styles.section}>{t('Recent')}</Text> : null}
                  {recents.map((p) => row(p, `r-${p.key}`))}
                  <Text style={styles.section}>{t('Near Brighton')}</Text>
                  {WEATHER_TOWNS.map((x) => row({ ...x }, x.key))}
                </>
              )}
            </ScrollView>
            <Text style={styles.note}>{t('Weather is shown for the place you pick. No location access is needed.')}</Text>
          </View>
        </KeyboardAvoidingView>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10 },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#D9D7CE', marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: WX.ink, fontSize: 18, fontWeight: '700' },
  cancelBtn: { minHeight: 44, justifyContent: 'center' },
  cancel: { color: WX.soft, fontSize: 15, fontWeight: '600' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, marginTop: 4, marginBottom: 6, borderRadius: 14, backgroundColor: WX.page, borderWidth: 1, borderColor: WX.line },
  input: { flex: 1, minHeight: 46, fontSize: 16, color: WX.ink },
  section: { color: WX.soft, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 12, marginBottom: 2 },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: WX.line },
  itemText: { color: WX.ink, fontSize: 16, fontWeight: '600' },
  itemState: { color: WX.soft, fontWeight: '400' },
  empty: { color: WX.soft, fontSize: 14, lineHeight: 20, paddingVertical: 18 },
  note: { color: WX.faint, fontSize: 12, marginTop: 10 },
});
