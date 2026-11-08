import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, type ViewStyle } from 'react-native';
import { Input } from './Input';
import { Icon } from './Icon';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { semantic } from '@/theme/colors';
import { applyStreetInput, type AddressParts } from '@/lib/address';
import type { PickedPlace } from '@/lib/placesAutocomplete';
import { verifyAddress, previewOnMap } from '@/lib/maps';
import { StreetSuggestions } from './StreetSuggestions';

/** Map check state for an address: exact spot found, or the owner chose to keep it as typed. */
export interface AddressCheck {
  latitude?: number;
  longitude?: number;
  /** Saved without a map match, on purpose. */
  overridden?: boolean;
}

interface AddressFieldsProps {
  value: AddressParts;
  onChange: (next: AddressParts) => void;
  /** Adds " *" to the labels. */
  required?: boolean;
  streetLabel?: string;
  style?: ViewStyle;
  /** Turns on the "Check on map" row. */
  check?: AddressCheck;
  onCheckChange?: (next: AddressCheck) => void;
}

/**
 * Street / City / State / ZIP. When autofill or a paste drops a whole address
 * into the street field, it's split across all four. With a Google Places key set, suggestions appear under the street
 * as you type and one tap fills everything (and the map spot).
 */
export function AddressFields({ value, onChange, required, streetLabel = 'Street Address', style, check, onCheckChange }: AddressFieldsProps) {
  const star = required ? ' *' : '';

  // Any edit means the old map spot no longer applies.
  function change(next: AddressParts) {
    onChange(next);
    if (onCheckChange && (check?.latitude != null || check?.overridden)) onCheckChange({});
  }

  function handleStreet(text: string) {
    change(applyStreetInput(text, value));
  }

  /** A suggestion was picked: all four fields at once, and the exact map spot is already known. */
  function handlePicked(place: PickedPlace) {
    onChange({ address: place.address, city: place.city, state: place.state, zip: place.zip });
    if (onCheckChange) onCheckChange(place.latitude != null && place.longitude != null ? { latitude: place.latitude, longitude: place.longitude } : {});
  }

  return (
    <View style={[styles.wrap, style]}>
      <Input
        label={`${streetLabel}${star}`}
        placeholder="123 Main St"
        value={value.address}
        onChangeText={handleStreet}
        icon="map-pin"
        textContentType="fullStreetAddress"
        autoComplete="street-address"
      />
      <StreetSuggestions text={value.address} onPick={handlePicked} />
      <View style={styles.row}>
        <Input
          label={`City${star}`}
          placeholder="City"
          value={value.city}
          onChangeText={(city) => change({ ...value, city })}
          textContentType="addressCity"
          containerStyle={styles.flex2}
        />
        <Input
          label={`State${star}`}
          placeholder="NJ"
          value={value.state}
          onChangeText={(state) => change({ ...value, state: state.toUpperCase() })}
          textContentType="addressState"
          autoCapitalize="characters"
          maxLength={2}
          containerStyle={styles.flex1}
        />
        <Input
          label={`ZIP${star}`}
          placeholder="08701"
          value={value.zip}
          onChangeText={(zip) => change({ ...value, zip })}
          textContentType="postalCode"
          autoComplete="postal-code"
          keyboardType="number-pad"
          maxLength={10}
          containerStyle={styles.flex1}
        />
      </View>
      {onCheckChange && <MapCheckRow value={value} check={check ?? {}} onCheckChange={onCheckChange} />}
    </View>
  );
}

function MapCheckRow({ value, check, onCheckChange }: { value: AddressParts; check: AddressCheck; onCheckChange: (c: AddressCheck) => void }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'not_found' | string | null>(null);
  const found = check.latitude != null && check.longitude != null;
  const complete = !missingAddressPart(value);

  async function runCheck() {
    setBusy(true);
    setResult(null);
    const r = await verifyAddress(value);
    setBusy(false);
    if (r.status === 'found') onCheckChange({ latitude: r.latitude, longitude: r.longitude });
    else setResult(r.status === 'not_found' ? 'not_found' : r.reason);
  }

  if (Platform.OS === 'web') return null;

  if (found) {
    return (
      <View style={[styles.checkRow, { backgroundColor: semantic.successLight }]}>
        <Icon name="check-circle" size={16} color={semantic.success} />
        <Text style={[typeScale.bodySmall, { color: semantic.success, flex: 1, fontWeight: '600' }]}>Address found on the map</Text>
        <Pressable onPress={() => previewOnMap({ ...value, ...check })} hitSlop={8}>
          <Text style={[typeScale.labelSmall, { color: semantic.success, textDecorationLine: 'underline' }]}>Preview</Text>
        </Pressable>
      </View>
    );
  }

  if (check.overridden) {
    return (
      <View style={[styles.checkRow, { backgroundColor: colors.backgroundTertiary }]}>
        <Icon name="edit-3" size={16} color={colors.textSecondary} />
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flex: 1 }]}>Using the address as typed (not found on the map)</Text>
        <Pressable onPress={() => onCheckChange({})} hitSlop={8}>
          <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Undo</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Pressable
        onPress={runCheck}
        disabled={!complete || busy}
        style={[styles.checkRow, { backgroundColor: colors.primarySurface, opacity: complete ? 1 : 0.5 }]}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="map" size={16} color={colors.primary} />}
        <Text style={[typeScale.labelLarge, { color: colors.primary, flex: 1 }]}>
          {complete ? 'Check address on the map' : 'Fill in the address to check it on the map'}
        </Text>
      </Pressable>
      {result && (
        <View style={[styles.checkRow, { backgroundColor: semantic.warningLight }]}>
          <Icon name="alert-triangle" size={16} color={semantic.warning} />
          <Text style={[typeScale.bodySmall, { color: colors.textPrimary, flex: 1 }]}>
            {result === 'not_found' ? 'Couldn\u2019t find this address on the map. Double-check it, or keep it as typed.' : result}
          </Text>
          <Pressable onPress={() => { setResult(null); onCheckChange({ overridden: true }); }} hitSlop={8}>
            <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Use as typed</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Message for the first missing part, or null when all four are filled in. */
export function missingAddressPart(a: AddressParts): string | null {
  if (!a.address.trim()) return 'Please enter the street address.';
  if (!a.city.trim()) return 'Please enter the city.';
  if (!/^[A-Za-z]{2}$/.test(a.state.trim())) return 'Please enter the 2-letter state.';
  if (!/^\d{5}(-\d{4})?$/.test(a.zip.trim())) return 'Please enter a 5-digit ZIP code.';
  return null;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
});
