/**
 * The building blocks of the Brighton Weather screens: the light palette (white air and tints of the logo's leaf green, text in the logo's deep
 * green), the flat white cards, the weather pictures and a small helper for the page behind everything. Flat and solid on purpose: no blur, no
 * see-through panels. Used only by the Weather screens.
 */
import React from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import type { WxIcon } from '@/lib/weatherView';

/** The brand greens come from the logo file (deep #0B4736, fresh #53A246); the rest are tints and neutrals chosen to sit with them. */
export const WX = {
  page: '#F7FAF4',
  card: '#FFFFFF',
  ink: '#12392B',
  deep: '#0B4736',
  soft: '#4B6B5D',
  faint: '#5E7A6F',
  leaf: '#53A246',
  leafTint: '#E3F1DC',
  line: '#E1EADC',
  amber: '#A86300',
  rain: '#2A72B5',
  white: '#FFFFFF',
} as const;

/** A flat white card with a soft shadow. Pass `bg` for a coloured card (alerts). */
export function Panel({ children, style, bg }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; bg?: string }) {
  return <View style={[styles.panel, bg ? { backgroundColor: bg } : null, style]}>{children}</View>;
}

type Pic = WxIcon | 'sunrise' | 'sunset';
/** The weather pictures are Meteocons by Bas Milius (MIT licence), drawn still: assets/images/wx. Sunrise and sunset are our own drawings. */
const PICTURES: Record<Pic, ImageSourcePropType> = {
  sun: require('../../../assets/images/wx/sun.png'),
  moon: require('../../../assets/images/wx/moon.png'),
  partly: require('../../../assets/images/wx/partly.png'),
  partlynight: require('../../../assets/images/wx/partlynight.png'),
  cloud: require('../../../assets/images/wx/cloud.png'),
  drizzle: require('../../../assets/images/wx/drizzle.png'),
  rain: require('../../../assets/images/wx/rain.png'),
  heavyrain: require('../../../assets/images/wx/heavyrain.png'),
  storm: require('../../../assets/images/wx/storm.png'),
  snow: require('../../../assets/images/wx/snow.png'),
  heavysnow: require('../../../assets/images/wx/heavysnow.png'),
  sleet: require('../../../assets/images/wx/sleet.png'),
  hail: require('../../../assets/images/wx/hail.png'),
  fog: require('../../../assets/images/wx/fog.png'),
  haze: require('../../../assets/images/wx/haze.png'),
  smoke: require('../../../assets/images/wx/smoke.png'),
  dust: require('../../../assets/images/wx/dust.png'),
  wind: require('../../../assets/images/wx/wind.png'),
  sunrise: require('../../../assets/images/wx/sunrise.png'),
  sunset: require('../../../assets/images/wx/sunset.png'),
};

/** The Meteocons clouds are pale, so each picture sits on a round colour: sky blue by day, deep blue at night, slate for storms. */
const CHIP_DAY = '#A9C9EA';
const CHIP_NIGHT = '#27375F';
const CHIP_STORM = '#8EA3C4';
const CHIP: Partial<Record<WxIcon, string>> = { moon: CHIP_NIGHT, partlynight: CHIP_NIGHT, storm: CHIP_STORM, heavyrain: CHIP_STORM, hail: CHIP_STORM, heavysnow: CHIP_STORM, sleet: CHIP_STORM, smoke: '#B8BEC6', dust: '#D6C7A6' };

export function WxPicture({ icon, size = 24, bare = false }: { icon: Pic; size?: number; bare?: boolean }) {
  const source = PICTURES[icon] ?? PICTURES.cloud;
  if (bare || icon === 'sunrise' || icon === 'sunset') {
    return <Image source={source} style={{ width: size, height: size }} resizeMode="contain" accessible={false} />;
  }
  const inner = Math.round(size * 0.92);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: CHIP[icon as WxIcon] ?? CHIP_DAY, alignItems: 'center', justifyContent: 'center' }}>
      <Image source={source} style={{ width: inner, height: inner }} resizeMode="contain" accessible={false} />
    </View>
  );
}

/** The page behind every Weather screen: the soft off-white the hero artwork dissolves into. */
export function WeatherBackground() {
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: WX.page }]} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: WX.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: WX.line,
    shadowColor: '#14803C',
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
});
