import React, { useCallback, useRef, useState } from 'react';
import { useScrollToTop } from '@/lib/scrollTop';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useT } from '@/i18n';
import { Panel, WX } from '@/components/weather/WeatherUI';
import { submitServiceRequest } from '@/data/serviceRequests';
import {
  COMPANY_PHONE_DISPLAY, COMPANY_PHONE_LINK, DETAILS_MAX, SERVICE_CHOICES, requestProblem, toggleService,
  type PropertyType,
} from '@/lib/serviceRequest';

/** Contact details to start the form with (a signed-in customer's own name, phone and email). */
export interface RequestPrefill { name?: string; phone?: string; email?: string }

/**
 * Request tab: anyone who is not signed in can ask the company for work. Property type, what they want, a description, where the property
 * is and how to reach them. It goes to the owner's phone as a notification and lands in the owner's Service Requests list (update 114).
 * No account is needed. A signed-in customer gets the same form from their Home (app/(customer)/request.tsx), with their details filled in.
 */
export default function WeatherRequest() {
  return <RequestForm />;
}

export function RequestForm({ prefill, signedIn = false, scrollPath = '/weather/request' }: { prefill?: RequestPrefill; signedIn?: boolean; scrollPath?: string }) {
  const pageRef = useRef<React.ElementRef<typeof KeyboardAwareScrollView>>(null);
  useScrollToTop(scrollPath, useCallback(() => { pageRef.current?.scrollTo({ y: 0, animated: true }); }, []));
  const t = useT();
  const insets = useSafeAreaInsets();
  const [propertyType, setPropertyType] = useState<PropertyType>('residential');
  const [services, setServices] = useState<string[]>([]);
  const [details, setDetails] = useState('');
  const [town, setTown] = useState('');
  const [name, setName] = useState(prefill?.name ?? '');
  const [phone, setPhone] = useState(prefill?.phone ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<{ type: PropertyType; services: string[]; town: string } | null>(null);

  async function send() {
    if (busy) return;
    const input = { propertyType, services, details, town, name, phone, email };
    const bad = requestProblem(input);
    if (bad) return setProblem(bad);
    setProblem(null);
    setBusy(true);
    const r = await submitServiceRequest(input);
    setBusy(false);
    if (!r.ok) return setProblem(r.error);
    setSent({ type: propertyType, services, town: town.trim() });
    setServices([]); setDetails(''); setTown('');
    // A signed-in customer keeps their own details for the next request; a visitor's are cleared.
    setName(prefill?.name ?? ''); setPhone(prefill?.phone ?? ''); setEmail(prefill?.email ?? '');
  }

  const pad = { paddingTop: insets.top + 14, paddingHorizontal: 18, paddingBottom: insets.bottom + 130 };

  if (sent) {
    return (
      <KeyboardAwareScrollView ref={pageRef} contentContainerStyle={[pad, { alignItems: 'center' }]} keyboardShouldPersistTaps="handled">
        <View style={styles.doneBadge}>
          <View style={styles.doneDot}><MaterialCommunityIcons name="check" size={30} color={WX.white} /></View>
        </View>
        <Text style={[styles.title, { marginTop: 22, textAlign: 'center' }]}>{t('Request sent')}</Text>
        <Text style={[styles.sub, { textAlign: 'center', marginTop: 8 }]}>{t("Thanks. We'll reach out to you by phone or email.")}</Text>
        <Panel style={{ alignSelf: 'stretch', marginTop: 26, padding: 16, gap: 12 }}>
          <SummaryRow label={t('Property')} value={t(sent.type === 'commercial' ? 'Commercial' : 'Residential')} />
          <View style={styles.rule} />
          <SummaryRow label={t('You asked for')} value={sent.services.map((s) => t(s)).join(', ')} />
          <View style={styles.rule} />
          <SummaryRow label={t('Where')} value={sent.town} />
        </Panel>
        <Pressable onPress={() => setSent(null)} accessibilityRole="button" style={({ pressed }) => [styles.primary, { alignSelf: 'stretch', marginTop: 22 }, pressed && { opacity: 0.85 }]}>
          <Text style={styles.primaryText}>{t('Send another request')}</Text>
        </Pressable>
        <Pressable onPress={() => { void Linking.openURL(COMPANY_PHONE_LINK); }} accessibilityRole="button" style={({ pressed }) => [styles.secondary, { alignSelf: 'stretch', marginTop: 10 }, pressed && { opacity: 0.85 }]}>
          <MaterialCommunityIcons name="phone-outline" size={19} color={WX.deep} />
          <Text style={styles.secondaryText}>{t('Call {phone}', { phone: COMPANY_PHONE_DISPLAY })}</Text>
        </Pressable>
      </KeyboardAwareScrollView>
    );
  }

  return (
    <KeyboardAwareScrollView ref={pageRef} contentContainerStyle={pad} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>YOUR COMPANY</Text>
      <Text style={styles.title}>{t('Request a service')}</Text>
      <Text style={styles.sub}>{signedIn ? t("Tell us what you need and we'll reach out.") : t("Tell us what you need and we'll reach out. No account needed.")}</Text>

      <Text style={styles.label}>{t('Property type')}</Text>
      <View style={styles.segment}>
        {(['residential', 'commercial'] as PropertyType[]).map((p) => {
          const on = propertyType === p;
          return (
            <Pressable key={p} onPress={() => setPropertyType(p)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.segItem, on && styles.segOn]}>
              <Text style={[styles.segText, on && styles.segTextOn]}>{t(p === 'residential' ? 'Residential' : 'Commercial')}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.labelRow}>
        <Text style={styles.label}>{t('What do you need?')}</Text>
        <Text style={styles.hint}>{t('Pick all that apply')}</Text>
      </View>
      <View style={styles.grid}>
        {SERVICE_CHOICES.map((s) => {
          const on = services.includes(s);
          return (
            <Pressable key={s} onPress={() => setServices((cur) => toggleService(cur, s))} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
              <View style={[styles.dot, on && styles.dotOn]}>{on ? <MaterialCommunityIcons name="check" size={13} color={WX.deep} /> : null}</View>
              <Text style={[styles.chipText, on && { color: WX.white }]}>{t(s)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>{t('Tell us about it')}</Text>
      <TextInput
        value={details}
        onChangeText={setDetails}
        placeholder={t("Describe your property, what you'd like done, and your timeline.")}
        placeholderTextColor={WX.faint}
        multiline
        maxLength={DETAILS_MAX}
        accessibilityLabel={t('Tell us about it')}
        style={[styles.input, { height: 104, paddingTop: 12, textAlignVertical: 'top' }]}
      />

      <Text style={styles.label}>{t('Where is the property?')}</Text>
      <TextInput value={town} onChangeText={setTown} placeholder={t('Town or ZIP code')} placeholderTextColor={WX.faint} maxLength={80} accessibilityLabel={t('Where is the property?')} style={styles.input} />

      <Text style={styles.label}>{t('How should we reach you?')}</Text>
      <View style={{ gap: 10 }}>
        <TextInput value={name} onChangeText={setName} placeholder={t('Full name')} placeholderTextColor={WX.faint} maxLength={80} autoComplete="name" textContentType="name" accessibilityLabel={t('Full name')} style={styles.input} />
        <TextInput value={phone} onChangeText={setPhone} placeholder={t('Phone (000) 000-0000')} placeholderTextColor={WX.faint} maxLength={25} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" accessibilityLabel={t('Phone')} style={styles.input} />
        <TextInput value={email} onChangeText={setEmail} placeholder={t('Email (optional)')} placeholderTextColor={WX.faint} maxLength={120} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" accessibilityLabel={t('Email')} style={styles.input} />
      </View>

      {problem ? <Text style={styles.problem} accessibilityRole="alert">{t(problem)}</Text> : null}

      <Pressable onPress={send} disabled={busy} accessibilityRole="button" accessibilityLabel={t('Send request')} style={({ pressed }) => [styles.primary, { marginTop: 22 }, (pressed || busy) && { opacity: 0.8 }]}>
        <Text style={styles.primaryText}>{busy ? t('Sending…') : t('Send request')}</Text>
      </Pressable>
      <Text style={styles.fine}>{t("We'll only use your details to answer this request.")}</Text>
    </KeyboardAwareScrollView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={styles.sumValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { color: '#2E5E34', fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: WX.deep, fontSize: 30, fontWeight: '700', letterSpacing: -0.4, marginTop: 8 },
  sub: { color: WX.soft, fontSize: 15, lineHeight: 22, marginTop: 8 },
  label: { color: WX.ink, fontSize: 13, fontWeight: '700', marginTop: 22, marginBottom: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  hint: { color: WX.soft, fontSize: 12.5 },
  segment: { flexDirection: 'row', gap: 6, padding: 4, backgroundColor: WX.leafTint, borderRadius: 14 },
  segItem: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: WX.white, shadowColor: '#17301F', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { color: WX.soft, fontSize: 15, fontWeight: '600' },
  segTextOn: { color: WX.ink, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { width: '48.4%', minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: WX.line, backgroundColor: WX.white },
  chipOn: { backgroundColor: '#2E5E34', borderColor: '#2E5E34' },
  chipText: { flex: 1, color: WX.ink, fontSize: 14, fontWeight: '600', lineHeight: 17 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#9DB0A2', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: WX.white, borderColor: WX.white },
  input: { minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: WX.line, backgroundColor: WX.white, paddingHorizontal: 14, fontSize: 15, color: WX.ink },
  problem: { color: '#B3261E', fontSize: 14, fontWeight: '600', marginTop: 14 },
  primary: { height: 56, borderRadius: 16, backgroundColor: '#2E5E34', alignItems: 'center', justifyContent: 'center', shadowColor: '#2E5E34', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  primaryText: { color: WX.white, fontSize: 17, fontWeight: '700' },
  secondary: { height: 54, borderRadius: 16, backgroundColor: WX.white, borderWidth: 1.5, borderColor: WX.line, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: WX.ink, fontSize: 16, fontWeight: '700' },
  fine: { color: WX.soft, fontSize: 12.5, textAlign: 'center', marginTop: 12, lineHeight: 18 },
  doneBadge: { marginTop: 70, width: 76, height: 76, borderRadius: 38, backgroundColor: WX.leafTint, alignItems: 'center', justifyContent: 'center' },
  doneDot: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#2E5E34', alignItems: 'center', justifyContent: 'center' },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: WX.line },
  sumLabel: { color: WX.soft, fontSize: 14 },
  sumValue: { flex: 1, color: WX.ink, fontSize: 14, fontWeight: '600', textAlign: 'right' },
});
