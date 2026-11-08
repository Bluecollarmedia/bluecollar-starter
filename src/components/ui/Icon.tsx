/**
 * Icon — drop-in replacement for <Feather name="..." size={} color={} />
 * that renders the REAL system SF Symbol on iOS (via expo-symbols'
 * SymbolView) instead of drawing a vector glyph, and falls back to
 * Feather everywhere else (Android, web) and for any Feather name that
 * has no confirmed SF Symbol counterpart in FEATHER_TO_SF below.
 *
 * We only map names we're confident exist in Apple's SF Symbols
 * catalog — an unmapped name silently uses the Feather fallback on
 * every platform rather than risk rendering a blank/invalid symbol.
 */
import React from 'react';
import { Platform, StyleProp, TextStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

let SymbolView: any = null;
try {
  SymbolView = require('expo-symbols').SymbolView;
} catch {}

type FeatherName = ComponentProps<typeof Feather>['name'];

const FEATHER_TO_SF: Partial<Record<string, string>> = {
  'activity': 'chart.xyaxis.line',
  'slash': 'nosign',
  'edit-2': 'pencil',
  'file-plus': 'doc.badge.plus',
  'printer': 'printer',
  'trash-2': 'trash',
  'copy': 'doc.on.doc',
  'arrow-down': 'arrow.down',
  'arrow-up': 'arrow.up',
  'alert-circle': 'exclamationmark.circle',
  'alert-triangle': 'exclamationmark.triangle',
  'arrow-left': 'arrow.left',
  'arrow-right': 'arrow.right',
  'arrow-right-circle': 'arrow.right.circle',
  'bell': 'bell',
  'bell-off': 'bell.slash',
  'briefcase': 'briefcase',
  'calendar': 'calendar',
  'camera': 'camera',
  'check': 'checkmark',
  'check-circle': 'checkmark.circle',
  'check-square': 'checkmark.square',
  'chevron-left': 'chevron.left',
  'chevron-right': 'chevron.right',
  'chevron-up': 'chevron.up',
  'chevron-down': 'chevron.down',
  'circle': 'circle',
  'clipboard': 'list.clipboard',
  'clock': 'clock',
  'cloud': 'cloud',
  'compass': 'location.circle',
  'credit-card': 'creditcard',
  'dollar-sign': 'dollarsign.circle',
  'edit': 'pencil',
  'edit-3': 'pencil',
  'external-link': 'arrow.up.right.square',
  'eye': 'eye',
  'eye-off': 'eye.slash',
  'file': 'doc.text',
  'file-text': 'doc.text',
  'folder': 'folder',
  'hard-drive': 'internaldrive',
  'hash': 'number',
  'help-circle': 'questionmark.circle',
  'home': 'house',
  'image': 'photo',
  'inbox': 'tray',
  'info': 'info.circle',
  'key': 'key',
  'layers': 'square.stack',
  'link': 'link',
  'lock': 'lock',
  'log-in': 'arrow.right.to.line',
  'log-out': 'rectangle.portrait.and.arrow.right',
  'mail': 'envelope',
  'map-pin': 'mappin',
  'menu': 'line.3.horizontal',
  'message-circle': 'bubble.left',
  'message-square': 'text.bubble',
  'minus': 'minus',
  'more-horizontal': 'ellipsis',
  'phone': 'phone',
  'play': 'play.fill',
  'play-circle': 'play.circle',
  'plus': 'plus',
  'plus-circle': 'plus.circle',
  'plus-square': 'plus.square',
  'refresh-cw': 'arrow.clockwise',
  'repeat': 'repeat',
  'flag': 'flag',
  'search': 'magnifyingglass',
  'send': 'paperplane',
  'settings': 'gearshape',
  'share-2': 'square.and.arrow.up',
  'shield': 'shield',
  'sliders': 'slider.horizontal.3',
  'smartphone': 'iphone',
  'sun': 'sun.max',
  'tool': 'wrench',
  'trending-up': 'chart.line.uptrend.xyaxis',
  'truck': 'box.truck',
  'user': 'person',
  'user-check': 'person.fill.checkmark',
  'user-minus': 'person.fill.badge.minus',
  'user-plus': 'person.badge.plus',
  'user-x': 'person.fill.xmark',
  'users': 'person.2',
  'volume-2': 'speaker.wave.2',
  'x': 'xmark',
  'x-circle': 'xmark.circle',
};

interface IconProps {
  name: FeatherName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export function Icon({ name, size = 20, color = '#000000', style }: IconProps) {
  const sfName = FEATHER_TO_SF[name as string];

  if (Platform.OS === 'ios' && SymbolView && sfName) {
    return (
      <SymbolView
        name={sfName}
        size={size}
        tintColor={color}
        style={[{ width: size, height: size }, style as any]}
      />
    );
  }

  return <Feather name={name} size={size} color={color} style={style} />;
}
