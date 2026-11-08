import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyState, Input, InlineNotice, ListRow, ListSection } from '@/components/ui';
import { useTheme } from '@/providers/ThemeProvider';
import { useResources, type ResourceInput } from '@/hooks/useResources';
import { useTrucks } from '@/hooks/useTrucks';
import { ProtectedCode } from '@/components/resources/ResourceParts';
import { db } from '@/data/store';
import { haptics } from '@/lib/haptics';
import { typeScale } from '@/theme/typography';
import { spacing, radius } from '@/theme/spacing';
import { RESOURCE_CATEGORIES, RESOURCE_CATEGORY_ORDER, type ResourceAuditEntry, type ResourceCategory } from '@/types/resource';

type SecretMode = 'keep' | 'replace' | 'remove';

function personName(id?: string): string {
  const p = id ? db.people[id] : undefined;
  return p ? `${p.firstName} ${p.lastName}`.trim() : 'Someone';
}

function describeAudit(e: ResourceAuditEntry): string {
  const actor = personName(e.actorId);
  const target = personName(e.targetPersonId);
  switch (e.eventType) {
    case 'created': return `${actor} created this resource`;
    case 'updated': return `${actor} edited the details`;
    case 'access_granted': return `${actor} gave ${target} access`;
    case 'access_revoked':
      return e.metadata?.reason === 'deactivated'
        ? `${target} lost access (deactivated)`
        : `${actor} removed ${target}'s access`;
    case 'code_changed': return `${actor} set the code`;
    case 'code_removed': return `${actor} removed the code`;
    case 'code_revealed': return `${actor} viewed the code`;
    default: return e.eventType;
  }
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Add or edit a resource (owner/admin). Opened as a modal from anywhere. */
export default function ResourceEditScreen() {
  const params = useLocalSearchParams<{ id?: string; category?: ResourceCategory; truckId?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getResource, createResource, updateResource, deleteResource, revealSecret, activeWorkers, auditFor, accessFor, refreshResources } = useResources();
  const { allTrucks } = useTrucks();

  const existing = params.id ? getResource(params.id) : undefined;
  const isNew = !params.id;

  const [category, setCategory] = useState<ResourceCategory>(existing?.category ?? params.category ?? 'access_code');
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [truckId, setTruckId] = useState<string | undefined>(existing?.truckId ?? params.truckId);
  const [itemName, setItemName] = useState(existing?.itemName ?? '');
  const [cardLastFour, setCardLastFour] = useState(existing?.cardLastFour ?? '');
  const [cardHolderId, setCardHolderId] = useState<string | undefined>(existing?.cardHolderId);
  const [secret, setSecret] = useState('');
  const [secretMode, setSecretMode] = useState<SecretMode>(existing?.hasSecret ? 'keep' : 'replace');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull the latest activity (reveals, grants) for this resource.
  useEffect(() => { if (params.id) refreshResources(); }, [params.id, refreshResources]);

  const info = RESOURCE_CATEGORIES[category];
  const audit = useMemo(() => (existing ? auditFor(existing.id).slice(0, 8) : []), [existing, auditFor]);
  const accessCount = existing ? accessFor(existing.id).length : 0;

  if (!isNew && !existing) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
            <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Close</Text>
          </Pressable>
        </View>
        <EmptyState icon="alert-circle" title="Resource not found" description="It may have been deleted." />
      </View>
    );
  }

  async function handleSave() {
    if (saving) return;
    setError(null);
    const input: ResourceInput = { category, name, description, truckId, itemName, cardLastFour, cardHolderId };
    const hasCode = !!info.secretLabel;
    let secretArg: string | null | undefined;
    if (!hasCode) secretArg = existing?.hasSecret ? null : undefined;
    else if (secretMode === 'remove') secretArg = null;
    else if (secretMode === 'replace' && secret.trim()) secretArg = secret.trim();

    setSaving(true);
    const res = existing
      ? await updateResource(existing.id, input, secretArg)
      : await createResource(input, secretArg ?? undefined);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      haptics.warning();
      return;
    }
    haptics.success();
    setSecret('');
    if (isNew) {
      // New resources are private; go straight to choosing who gets access.
      router.replace(`/(owner)/resource-access?id=${res.id}&created=1` as any);
    } else {
      router.back();
    }
  }

  function handleDelete() {
    if (!existing) return;
    const go = () => {
      haptics.destructive();
      deleteResource(existing.id);
      router.back();
    };
    const msg = `Delete “${existing.name}”? Workers will lose access right away and its code will be erased.`;
    Alert.alert('Delete Resource', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: go },
    ]);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
          <Text style={[typeScale.labelLarge, { color: colors.primary }]}>Cancel</Text>
        </Pressable>
        <Text style={[typeScale.headingSmall, { color: colors.textPrimary, flex: 1, textAlign: 'center' }]}>
          {isNew ? 'Add Resource' : 'Edit Resource'}
        </Text>
        <View style={{ width: 52 }} />
      </View>

      <KeyboardAwareScrollView bounces={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing['3xl'] }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={spacing.xl}
      >
        <Text style={[typeScale.overline, styles.fieldLabel, { color: colors.textTertiary }]}>TYPE</Text>
        <View style={styles.chips}>
          {RESOURCE_CATEGORY_ORDER.map((c) => {
            const selected = c === category;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surface }]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Icon name={RESOURCE_CATEGORIES[c].icon} size={14} color={selected ? colors.textOnPrimary : colors.textSecondary} />
                <Text style={[typeScale.labelSmall, { color: selected ? colors.textOnPrimary : colors.textPrimary, marginLeft: 6 }]}>
                  {RESOURCE_CATEGORIES[c].label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Input
          label="Name"
          containerStyle={styles.field}
          value={name}
          onChangeText={setName}
          placeholder={category === 'vehicle' ? 'e.g. Truck #1 key lockbox' : category === 'company_card' ? 'e.g. Fuel card' : 'e.g. Main yard gate'}
          maxLength={120}
        />

        {category === 'vehicle' && (
          <ListSection title="Truck or trailer">
            {allTrucks.length === 0 ? (
              <ListRow title="No trucks yet" subtitle="Add trucks and trailers under More → Trucks" />
            ) : (
              allTrucks.map((t) => (
                <ListRow
                  key={t.id}
                  icon="truck"
                  title={t.name}
                  subtitle={[t.year, t.make, t.model].filter(Boolean).join(' ') || undefined}
                  selected={truckId === t.id}
                  onPress={() => setTruckId(truckId === t.id ? undefined : t.id)}
                />
              ))
            )}
          </ListSection>
        )}

        {category === 'equipment' && (
          <Input label="Equipment" containerStyle={styles.field} value={itemName} onChangeText={setItemName} placeholder="e.g. Equipment shed, skid steer" maxLength={120} />
        )}

        {category === 'company_card' && (
          <>
            <InlineNotice
              icon="shield"
              tone="warning"
              text="Only the card's name, who carries it and the last 4 digits are saved. Never enter a full card number, PIN or security code. Share PINs through the card issuer."
              style={{ marginBottom: spacing.md }}
            />
            <Input
              label="Last 4 digits"
              containerStyle={styles.field}
              value={cardLastFour}
              onChangeText={(t) => setCardLastFour(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="1234"
            />
            <ListSection title="Carried by">
              <ListRow title="No one in particular" selected={!cardHolderId} onPress={() => setCardHolderId(undefined)} />
              {activeWorkers.map((p) => (
                <ListRow
                  key={p.id}
                  title={`${p.firstName} ${p.lastName}`}
                  selected={cardHolderId === p.id}
                  onPress={() => setCardHolderId(p.id)}
                />
              ))}
            </ListSection>
          </>
        )}

        <Input
          label="Instructions"
          containerStyle={styles.field}
          value={description}
          onChangeText={setDescription}
          placeholder="Where it is, how to use it, anything workers should know"
          multiline
          maxLength={2000}
        />

        {info.secretLabel && (
          <View style={[styles.codeCard, { backgroundColor: colors.surface }]}>
            {existing?.hasSecret && secretMode === 'keep' ? (
              <>
                <ProtectedCode label={info.secretLabel} reveal={() => revealSecret(existing.id)} />
                <View style={styles.codeLinks}>
                  <Pressable onPress={() => setSecretMode('replace')} hitSlop={8}>
                    <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Change code</Text>
                  </Pressable>
                  <Pressable onPress={() => setSecretMode('remove')} hitSlop={8}>
                    <Text style={[typeScale.labelSmall, { color: colors.error }]}>Remove code</Text>
                  </Pressable>
                </View>
              </>
            ) : secretMode === 'remove' ? (
              <View style={styles.removeRow}>
                <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flex: 1 }]}>The code will be erased when you save.</Text>
                <Pressable onPress={() => setSecretMode('keep')} hitSlop={8}>
                  <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Undo</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Input
                  label={info.secretLabel}
                  value={secret}
                  onChangeText={setSecret}
                  placeholder={existing?.hasSecret ? 'Enter the new code' : 'Optional'}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  maxLength={500}
                  containerStyle={{ marginBottom: 0 }}
                />
                <Text style={[typeScale.caption, { color: colors.textTertiary, marginTop: spacing.xs }]}>
                  Stored encrypted. Workers you give access can reveal and copy it.
                </Text>
                {existing?.hasSecret && (
                  <Pressable onPress={() => { setSecret(''); setSecretMode('keep'); }} hitSlop={8} style={{ marginTop: spacing.sm }}>
                    <Text style={[typeScale.labelSmall, { color: colors.primary }]}>Keep current code</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        )}

        {error && <InlineNotice icon="alert-circle" tone="error" text={error} style={{ marginBottom: spacing.md }} />}

        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" onPress={() => router.back()} style={{ flex: 1 }} />
          <Button title={isNew ? 'Save & Choose Access' : 'Save Changes'} onPress={handleSave} loading={saving} style={{ flex: 1.6 }} />
        </View>

        {isNew && (
          <Text style={[typeScale.caption, { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm }]}>
            New resources are private until you give workers access.
          </Text>
        )}

        {existing && (
          <>
            <ListSection style={{ marginTop: spacing.xl }}>
              <ListRow
                icon="users"
                title="Manage Access"
                value={`${accessCount} worker${accessCount === 1 ? '' : 's'}`}
                showChevron
                onPress={() => router.push(`/(owner)/resource-access?id=${existing.id}` as any)}
              />
            </ListSection>

            {audit.length > 0 && (
              <ListSection title="RECENT ACTIVITY">
                {audit.map((e) => (
                  <ListRow key={e.id} title={describeAudit(e)} subtitle={formatWhen(e.createdAt)} />
                ))}
              </ListSection>
            )}

            <ListSection>
              <ListRow icon="trash-2" iconColor={colors.error} title="Delete Resource" destructive onPress={handleDelete} />
            </ListSection>
          </>
        )}
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
  },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  field: { marginBottom: spacing.lg },
  fieldLabel: { marginBottom: spacing.xs, marginLeft: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  codeCard: { borderRadius: radius.xl, padding: spacing.md, marginBottom: spacing.lg },
  codeLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  removeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
