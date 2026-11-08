/**
 * Owner/admin: one snow property's details — contacts, the services it gets,
 * and each service's instructions and reference photos/videos.
 *
 * Layout is a working first pass; the approved Snow Mode mockup will restyle
 * it. Everything here saves to the live database (supabase/updates/022).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Alert, Platform, Keyboard } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KEYBOARD_GAP } from '@/components/layout/ScreenContainer';
import { Button, Icon, LoadingSpinner } from '@/components/ui';
import { PhotoCountStepper } from '@/components/maintenance/PhotoRuleEditor';
import { CustomerPicker } from '@/components/customers/CustomerPicker';
import { CustomerInviteCard } from '@/components/invites/CustomerInviteCard';
import { TaskMediaStrip, TaskMediaViewer } from '@/components/tasks/TaskMedia';
import { snowMediaItems } from '@/components/snow/SnowReference';
import { notify, pickSnowMedia } from '@/components/snow/pickSnowMedia';
import { SnowUploadStatus } from '@/components/snow/SnowUploadStatus';
import { useSnowUploads } from '@/hooks/useSnowUploads';
import { SNOW_REFERENCE_TARGET } from '@/data/snowMediaTargets';
import { confirmAction } from '@/components/financials/ActionSheet';
import { useTheme } from '@/providers/ThemeProvider';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';
import { haptics } from '@/lib/haptics';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { db, useDb } from '@/data/store';
import { useSnowPropertyDetails } from '@/hooks/useSnowPropertyDetails';
import {
  addContact, addReferenceMedia, addService, referenceAsOf, retireReferenceMedia, saveInstructions,
  setServiceActive, setServicePhotoRule, updateContact, type ContactInput, type SnowPropertyDetails,
} from '@/data/snowProperties';
import {
  SNOW_SERVICES, SNOW_SERVICE_ICONS, SNOW_SERVICE_LABELS,
  type SnowPropertyContact, type SnowPropertyService, type SnowService,
} from '@/types/snowProperty';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Name and address from the foundation's snow_properties row. */
function usePropertyHeader(id?: string) {
  const [row, setRow] = useState<{ name?: string; address?: string; companyId?: string } | null>(null);
  useEffect(() => {
    if (!id || !isSupabaseConfigured) return;
    supabase.from('snow_properties').select('*').eq('id', id).maybeSingle().then(({ data }) => {
      if (data) setRow({ name: data.name, address: data.address ?? undefined, companyId: data.company_id });
    });
  }, [id]);
  return row;
}

export default function SnowPropertyScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const header = usePropertyHeader(id);
  const { details, mediaUrls, error, loading, reload } = useSnowPropertyDetails(id);
  const companyId = header?.companyId ?? db.companyId;

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <KeyboardAwareScrollView bounces={false}
        bottomOffset={KEYBOARD_GAP}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing['3xl'] }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: colors.surface }, shadow.sm]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="chevron-left" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={[typeScale.displaySmall, { color: colors.textPrimary, marginTop: spacing.md }]} numberOfLines={2}>
          {header?.name ?? 'Snow Property'}
        </Text>
        {!!header?.address && (
          <Text style={[typeScale.bodyLarge, { color: colors.textTertiary, marginTop: 2 }]}>{header.address}</Text>
        )}

        {loading && !details && <LoadingSpinner style={{ marginTop: spacing['2xl'] }} />}
        {error && (
          <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary }]}>{error}</Text>
            {isSupabaseConfigured && <Button title="Try Again" variant="secondary" size="sm" onPress={reload} style={{ alignSelf: 'flex-start', marginTop: spacing.md }} />}
          </View>
        )}
        {details && id && (
          <>
            <ContactsSection companyId={companyId} propertyId={id} contacts={details.contacts} onChanged={reload} />
            <Text style={[typeScale.overline, styles.sectionTitle, { color: colors.textTertiary }]}>SERVICES</Text>
            {SNOW_SERVICES.map((service) => (
              <ServiceCard
                key={service}
                companyId={companyId}
                propertyId={id}
                service={service}
                details={details}
                mediaUrls={mediaUrls}
                onChanged={reload}
              />
            ))}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

// ── Contacts ────────────────────────────────────────────────────────────────

const firstNameOf = (full: string) => (full ?? '').trim().split(/\s+/)[0] ?? '';

function ContactsSection({ companyId, propertyId, contacts, onChanged }: {
  companyId: string; propertyId: string; contacts: SnowPropertyContact[]; onChanged: () => void;
}) {
  const { colors } = useTheme();
  const v = useDb();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);

  // The property's customer: the linked account, else the main contact. Every property has one.
  const customer = contacts.find((x) => x.personId) ?? contacts.find((x) => x.isPrimary);
  /** Puts an existing customer on this property (their name, phone and email come from their record; nothing is typed). */
  async function linkCustomer(personId: string) {
    const m = db.members.find((x) => x.personId === personId);
    if (!m?.person || busy) return;
    const p = m.person;
    const input: ContactInput = {
      name: `${p.firstName} ${p.lastName}`.trim() || p.email, title: '', phone: p.phone ?? '', email: p.email ?? '', personId, isPrimary: true,
    };
    setBusy(true);
    const res = customer ? await updateContact(customer, input) : await addContact(companyId, propertyId, input);
    setBusy(false);
    if (!res.ok) return notify('Not Saved', res.error);
    haptics.success();
    setChoosing(false);
    onChanged();
  }

  return (
    <>
      <Text style={[typeScale.overline, styles.sectionTitle, { color: colors.textTertiary }]}>CUSTOMER</Text>
      <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
        {customer && !choosing ? (
          <>
            <ContactRow contact={customer} onEdit={() => setChoosing(true)} customer />
            <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
              {customer.personId ? 'They see this property and its completed snow services in their app.' : 'Not linked to a customer account yet. Tap to choose the customer.'}
            </Text>
            {/* Their one private link, right here in Snow Mode: it covers everything on their customer record, not just this property. */}
            {customer.personId ? (
              <CustomerInviteCard personId={customer.personId} firstName={firstNameOf(customer.name)} phone={customer.phone} />
            ) : null}
          </>
        ) : (
          <>
            <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>{customer ? 'Change the customer' : 'Choose the customer'}</Text>
            <CustomerPicker onPick={linkCustomer} checkedId={customer?.personId ?? undefined} disabled={busy} />
            {customer ? <Button title="Cancel" variant="ghost" size="sm" onPress={() => setChoosing(false)} style={{ alignSelf: 'flex-start' }} /> : null}
          </>
        )}
      </View>

    </>
  );
}

function ContactRow({ contact, onEdit, customer }: { contact: SnowPropertyContact; onEdit: () => void; customer?: boolean }) {
  const { colors } = useTheme();
  const reach = [contact.phone, contact.email].filter(Boolean).join(' · ');
  const tags = customer ? (contact.personId ? 'Customer account linked' : '') : [contact.isPrimary && 'Main contact'].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onEdit}
      style={({ pressed }) => [styles.contactRow, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={customer ? `Change the customer, now ${contact.name}` : `Edit ${contact.name}`}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600' }]}>
          {contact.name}{contact.title ? <Text style={{ color: colors.textSecondary, fontWeight: '400' }}>{`, ${contact.title}`}</Text> : null}
        </Text>
        {!!reach && <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{reach}</Text>}
        {!!tags && <Text style={[typeScale.caption, { color: colors.primary }]}>{tags}</Text>}
      </View>
      <Icon name={customer ? 'repeat' : 'edit-2'} size={16} color={colors.textTertiary} />
    </Pressable>
  );
}
// ── Services ────────────────────────────────────────────────────────────────

function ServiceCard({ companyId, propertyId, service, details, mediaUrls, onChanged }: {
  companyId: string; propertyId: string; service: SnowService; details: SnowPropertyDetails;
  mediaUrls: Record<string, string>; onChanged: () => void;
}) {
  const { colors } = useTheme();
  const row = details.services.find((s) => s.service === service);
  const [busy, setBusy] = useState(false);
  const label = SNOW_SERVICE_LABELS[service];

  async function start() {
    setBusy(true);
    const res = await addService(companyId, propertyId, service, row);
    setBusy(false);
    if (!res.ok) return notify('Not Saved', res.error);
    haptics.success();
    onChanged();
  }

  function stop() {
    if (!row) return;
    confirmAction(
      `Stop ${label}`,
      `New storms won't offer ${label.toLowerCase()} here. Its instructions and media are kept, and past visits still show them.`,
      'Stop Service',
      async () => {
        const res = await setServiceActive(row.id, false);
        if (!res.ok) return notify('Not Saved', res.error);
        onChanged();
      },
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }, shadow.sm]}>
      <View style={styles.serviceHeader}>
        <Icon name={SNOW_SERVICE_ICONS[service]} size={18} color={row?.isActive ? colors.primary : colors.textTertiary} />
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '700', flex: 1 }]}>{label}</Text>
        {row?.isActive ? (
          <Button title="Stop" variant="ghost" size="sm" onPress={stop} />
        ) : (
          <Button title={row ? 'Resume' : 'Add'} icon={row ? undefined : 'plus'} variant="secondary" size="sm" loading={busy} onPress={start} />
        )}
      </View>
      {!row && (
        <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>This property doesn't get {label.toLowerCase()}.</Text>
      )}
      {row && !row.isActive && (
        <Text style={[typeScale.bodySmall, { color: colors.textTertiary }]}>
          Stopped{row.deactivatedAt ? ` ${formatDate(row.deactivatedAt)}` : ''}. Its instructions and media are kept.
        </Text>
      )}
      {row?.isActive && <ServicePhotoRule ps={row} label={label} onChanged={onChanged} />}
      {row?.isActive && (
        <ServiceReferenceEditor companyId={companyId} ps={row} details={details} mediaUrls={mediaUrls} onChanged={onChanged} />
      )}
    </View>
  );
}

/**
 * Photos for this service at this property: follow the route, required (with how many), or none. New stops for this property start from it;
 * the owner can still change one stop, or a whole route, on the route screen.
 */
function ServicePhotoRule({ ps, label, onChanged }: { ps: SnowPropertyService; label: string; onChanged: () => void }) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<'route' | 'on' | 'off'>(ps.photosRequired === true ? 'on' : ps.photosRequired === false ? 'off' : 'route');
  const [count, setCount] = useState(ps.photoCount ?? 1);
  const [saving, setSaving] = useState(false);
  async function save(nextMode: 'route' | 'on' | 'off', nextCount: number) {
    setMode(nextMode);
    setCount(nextCount);
    setSaving(true);
    const res = await setServicePhotoRule(ps.id, { photosRequired: nextMode === 'route' ? null : nextMode === 'on', photoCount: nextMode === 'on' ? nextCount : null });
    setSaving(false);
    if (!res.ok) return notify('Not Saved', res.error);
    onChanged();
  }
  const chips: { key: 'route' | 'on' | 'off'; text: string }[] = [
    { key: 'route', text: 'Follow the route' }, { key: 'on', text: 'Photos required' }, { key: 'off', text: 'No photos' },
  ];
  return (
    <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
      <Text style={[typeScale.labelLarge, { color: colors.textPrimary }]}>{`Photos for ${label.toLowerCase()} here`}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {chips.map((c) => {
          const on = mode === c.key;
          return (
            <Pressable key={c.key} onPress={() => save(c.key, count)} disabled={saving} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.primary : colors.backgroundSecondary, borderColor: on ? colors.primary : colors.border }}>
              <Text style={[typeScale.bodySmall, { color: on ? '#FFFFFF' : colors.textPrimary, fontWeight: '700' }]}>{c.text}</Text>
            </Pressable>
          );
        })}
      </View>
      {mode === 'on' ? <PhotoCountStepper count={count} onChange={(n) => save('on', n)} /> : null}
      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
        {mode === 'route' ? 'Each route decides.' : mode === 'on' ? 'New stops here start with this many photos required.' : 'New stops here start with no photos required.'}
      </Text>
    </View>
  );
}

function ServiceReferenceEditor({ companyId, ps, details, mediaUrls, onChanged }: {
  companyId: string; ps: SnowPropertyService; details: SnowPropertyDetails;
  mediaUrls: Record<string, string>; onChanged: () => void;
}) {
  const { colors } = useTheme();
  const current = referenceAsOf(details, ps);
  const versions = details.instructions.filter((i) => i.propertyServiceId === ps.id);
  const [text, setText] = useState(current.instructions?.body ?? '');
  const [saving, setSaving] = useState(false);
  // Saved instructions show as a short read-only summary; the text box only opens while you are writing.
  const [editing, setEditing] = useState(false);
  // Reference photos upload in the background (shared queue); this screen only shows how many are on their way and any that failed.
  const { uploading, failed, saved } = useSnowUploads(SNOW_REFERENCE_TARGET, (p) => p.propertyServiceId === ps.id);
  useEffect(() => { if (saved > 0) onChanged(); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showHistory, setShowHistory] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const items = useMemo(() => snowMediaItems(current.media, mediaUrls), [current.media, mediaUrls]);
  const removed = details.media.filter((m) => m.propertyServiceId === ps.id && m.retiredAt).length;
  const changed = text.trim() !== (current.instructions?.body ?? '').trim();

  // Pick up a version saved elsewhere, unless the owner is mid-edit.
  const latestId = current.instructions?.id;
  useEffect(() => {
    if (!changed) setText(current.instructions?.body ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId]);

  async function save() {
    setSaving(true);
    const res = await saveInstructions(companyId, ps.id, text, current.instructions);
    setSaving(false);
    if (!res.ok) return notify('Not Saved', res.error);
    haptics.success();
    // Saved: put the keyboard away and fold the editor back up.
    Keyboard.dismiss();
    setEditing(false);
    onChanged();
  }

  function cancelEdit() {
    Keyboard.dismiss();
    setText(current.instructions?.body ?? '');
    setEditing(false);
  }

  async function add() {
    const drafts = await pickSnowMedia();
    if (drafts.length === 0) return;
    // Instant: queued, then uploaded in the background.
    const { queued, errors } = await addReferenceMedia(companyId, ps.id, drafts);
    if (queued > 0) haptics.success();
    if (errors.length > 0) notify("The files weren't added", errors[0]);
  }

  function retire(mediaId: string) {
    confirmAction(
      'Remove From Reference',
      'Crews won\'t see it on future storms. Visits already done with it keep it in their history.',
      'Remove',
      async () => {
        const res = await retireReferenceMedia(mediaId);
        if (!res.ok) return notify('Not Removed', res.error);
        haptics.destructive();
        onChanged();
      },
    );
  }

  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
      <Text style={[typeScale.labelSmall, { color: colors.textSecondary }]}>Instructions</Text>
      {editing ? (
        <>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Where to push snow, what to avoid, gates, ramps, drains…"
            placeholderTextColor={colors.textTertiary}
            multiline
            autoFocus
            textAlignVertical="top"
            accessibilityLabel={`${SNOW_SERVICE_LABELS[ps.service]} instructions`}
            style={[styles.instructions, typeScale.bodyLarge, { color: colors.textPrimary, backgroundColor: colors.backgroundSecondary, borderColor: colors.border }]}
          />
          <View style={styles.versionRow}>
            <View style={{ flex: 1 }} />
            <Button title="Cancel" variant="ghost" size="sm" onPress={cancelEdit} />
            <Button title="Save" size="sm" loading={saving} disabled={!changed} onPress={save} />
          </View>
        </>
      ) : (
        <Pressable
          onPress={() => setEditing(true)}
          style={[styles.summary, { backgroundColor: colors.backgroundSecondary }]}
          accessibilityRole="button"
          accessibilityLabel={current.instructions?.body ? `Edit ${SNOW_SERVICE_LABELS[ps.service]} instructions` : `Add ${SNOW_SERVICE_LABELS[ps.service]} instructions`}
        >
          <Text style={[typeScale.bodyLarge, { color: current.instructions?.body ? colors.textPrimary : colors.textTertiary, flex: 1 }]} numberOfLines={3}>
            {current.instructions?.body || 'Add instructions: where to push snow, what to avoid, gates, drains…'}
          </Text>
          <Icon name={current.instructions?.body ? 'edit-2' : 'plus'} size={16} color={colors.textTertiary} />
        </Pressable>
      )}
      {!editing && current.instructions ? (
        <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
          Version {current.instructions.version}, saved {formatDate(current.instructions.createdAt)}
        </Text>
      ) : null}
      {versions.length > 1 && (
        <Pressable onPress={() => setShowHistory((s) => !s)} accessibilityRole="button" style={styles.historyToggle}>
          <Icon name={showHistory ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
          <Text style={[typeScale.labelSmall, { color: colors.textSecondary }]}>
            {showHistory ? 'Hide' : 'Show'} earlier versions ({versions.length - 1})
          </Text>
        </Pressable>
      )}
      {showHistory && versions.slice(1).map((v) => (
        <View key={v.id} style={[styles.oldVersion, { backgroundColor: colors.backgroundSecondary }]}>
          <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Version {v.version}, {formatDate(v.createdAt)}</Text>
          <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>{v.body || '(empty)'}</Text>
        </View>
      ))}

      <Text style={[typeScale.labelSmall, { color: colors.textSecondary, marginTop: spacing.sm }]}>Reference photos and videos</Text>
      <TaskMediaStrip
        items={items}
        onOpen={setOpen}
        onAdd={add}
        onRemove={retire}
      />
      <SnowUploadStatus uploading={uploading} failed={failed} />
      <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
        Shown to the route lead for {SNOW_SERVICE_LABELS[ps.service].toLowerCase()} only. Not shared with the customer.
        {removed > 0 ? ` ${removed} removed ${removed === 1 ? 'item is' : 'items are'} kept for past visits.` : ''}
      </Text>
      <TaskMediaViewer items={items} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 52 },
  screen: { flex: 1 },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.xs, marginLeft: spacing.md },
  card: { borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md, gap: spacing.sm },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  serviceHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  instructions: { minHeight: 110, borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, minHeight: 52 },
  historyToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, minHeight: 36 },
  oldVersion: { borderRadius: radius.md, padding: spacing.md, gap: 2 },
});
