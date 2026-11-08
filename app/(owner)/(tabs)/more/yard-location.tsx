import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform, Keyboard } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { Button, Card } from '@/components/ui';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { AddressFields, missingAddressPart, type AddressCheck } from '@/components/ui/AddressFields';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useCompanyYard } from '@/hooks/useCompanyYard';
import { formatAddress, type AddressParts } from '@/lib/address';
import { verifyAddress } from '@/lib/maps';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing } from '@/theme/spacing';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

/** Owner setting: the yard address workers get directions to from their Today screen. */
export default function YardLocationScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const { yard, label, saveYard } = useCompanyYard();

  const [form, setForm] = useState<AddressParts>({
    address: yard?.address ?? '',
    city: yard?.city ?? '',
    state: yard?.state ?? '',
    zip: yard?.zip ?? '',
  });
  const [check, setCheck] = useState<AddressCheck>(
    yard?.latitude != null && yard?.longitude != null ? { latitude: yard.latitude, longitude: yard.longitude } : {},
  );
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const unchanged = !!yard
    && formatAddress(form).toLowerCase() === formatAddress(yard).toLowerCase()
    && check.latitude === yard.latitude;

  function handleChange(next: AddressParts) {
    setForm(next);
    setFeedback(null);
  }

  async function handleSave() {
    // A bad address never reaches the saved setting: the old yard stays as it was.
    const missing = missingAddressPart(form);
    if (missing) {
      haptics.warning();
      setFeedback({ tone: 'error', text: `${missing} The saved yard location wasn’t changed.` });
      return;
    }

    // Look the address up on the map so directions go to the exact spot.
    if (Platform.OS !== 'web' && check.latitude == null && !check.overridden) {
      setChecking(true);
      const r = await verifyAddress(form);
      setChecking(false);
      if (r.status === 'found') {
        const found = { latitude: r.latitude, longitude: r.longitude };
        setCheck(found);
        save(found);
        return;
      }
      if (r.status === 'not_found') {
        Alert.alert(
          'Address not found on the map',
          'Double-check the address. If it’s right, you can save it as typed.',
          [
            { text: 'Fix Address', style: 'cancel' },
            { text: 'Save As Typed', onPress: () => { setCheck({ overridden: true }); save({ overridden: true }); } },
          ],
        );
        return;
      }
    }
    save(check);
  }

  function save(c: AddressCheck) {
    saveYard({ ...form, latitude: c.latitude, longitude: c.longitude });
    haptics.success();
    Keyboard.dismiss();
    setFeedback({ tone: 'success', text: 'Yard location saved. Workers see it on their Today screen.' });
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.headingLarge, { color: colors.textPrimary, flex: 1 }]}>Yard Location</Text>
      </View>

      <KeyboardAwareScrollView bounces={false}
        bottomOffset={KEYBOARD_GAP}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarClearance + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card title="Saved Location">
          <View style={styles.savedRow}>
            <Icon name="map-pin" size={18} color={yard ? colors.primary : colors.textTertiary} />
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{label}</Text>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                {yard ? formatAddress(yard) : 'Not set yet'}
              </Text>
            </View>
          </View>
          <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.sm }]}>
            Workers can tap this on their Today screen for directions to the yard. It is also the spot clock-ins are checked against when you turn on Yard & clock-in alerts in Settings.
          </Text>
        </Card>

        <Card title={yard ? 'Change Address' : 'Yard Address'} style={{ marginTop: spacing.lg }}>
          <AddressFields
            required
            value={form}
            onChange={handleChange}
            check={check}
            onCheckChange={setCheck}
          />
          {feedback && (
            <InlineNotice
              icon={feedback.tone === 'success' ? 'check-circle' : 'alert-circle'}
              tone={feedback.tone}
              text={feedback.text}
              style={{ marginTop: spacing.md }}
            />
          )}
          <Button
            title="Save Location"
            icon="check"
            onPress={handleSave}
            loading={checking}
            disabled={unchanged}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.lg }}
          />
        </Card>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  backButton: { padding: spacing.xs },
  scrollContent: { paddingHorizontal: spacing.lg },
  savedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
});
