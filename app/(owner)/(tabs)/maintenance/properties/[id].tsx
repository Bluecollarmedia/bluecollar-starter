/**
 * Owner → Maintenance → Properties → a property: where it is, who it's for,
 * its contract and recurring services (each with its own due state), and every
 * visit so far. Deactivating the contract or the property keeps all history.
 */

import { IssuesSection } from '@/components/issues/IssuesSection';
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader, GlassIconButton, EmptyState, StatusBadge, ListSection, ListRow } from '@/components/ui';
import { ServiceDueLine } from '@/components/maintenance/ServiceDueLine';
import { CustomerAccessSection } from '@/components/maintenance/CustomerAccessSection';
import { useTheme } from '@/providers/ThemeProvider';
import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import { useMaintenance, useMaintenanceProperty } from '@/hooks/useMaintenance';
import { setContractActive, setPropertyActive } from '@/data/maintenance';
import { formatDocDate } from '@/lib/documentHtml';
import { previewOnMap } from '@/lib/maps';
import { todayKey } from '@/lib/ids';
import { haptics } from '@/lib/haptics';
import type { MaintenanceStopDetail, StopStatus } from '@/types/maintenance';
import { typeScale } from '@/theme/typography';
import { spacing, radius, shadow } from '@/theme/spacing';

function confirmThen(title: string, msg: string, action: string, run: () => void) {
  Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: action, onPress: run }]);
}

/** Visits shown here; the rest are on the history screen. */
const RECENT_VISITS = 5;

const STOP_BADGE: Record<StopStatus, { label: string; status: 'success' | 'info' | 'warning' | 'neutral' }> = {
  completed: { label: 'Completed', status: 'success' },
  arrived: { label: 'In progress', status: 'info' },
  pending: { label: 'Scheduled', status: 'neutral' },
  skipped: { label: 'Skipped', status: 'warning' },
};

export default function MaintenancePropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const clearance = useTabBarClearance();
  const today = todayKey();
  const detail = useMaintenanceProperty(id, today);
  const m = useMaintenance();
  const [showOff, setShowOff] = useState(false);

  if (!detail) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
        <ScreenHeader title="Property" />
        <EmptyState icon="alert-circle" title="Property not found" description="It may have been removed." />
      </View>
    );
  }

  const { property: p, activeContract, contracts, due, visits } = detail;
  const contract = activeContract ?? contracts[0];
  const edit = () => router.push(`/(owner)/maintenance-property-edit?id=${p.id}` as any);
  // Adding a service opens a short form about the service only (not the whole property form).
  const addService = () => router.push(`/(owner)/maintenance-service-add?propertyId=${p.id}` as any);
  const address = [p.address, [p.city, p.state].filter(Boolean).join(', '), p.zip].filter(Boolean).join(' ');
  // Rules of the contract on screen (the active one, else the latest).
  const rules = contract ? m.rulesByContract[contract.id] ?? [] : [];
  const onServices = due.services.filter((s) => s.rule.isActive);
  const offServices = rules.filter((r) => !r.isActive);
  const contractActive = contract?.status === 'active';

  function toggleContract() {
    if (!contract) return;
    if (contractActive) {
      confirmThen(
        'Deactivate Contract',
        `Stop recommending ${p.name} for routes? Past visits and service history stay.`,
        'Deactivate',
        () => { haptics.select(); setContractActive(contract.id, false); },
      );
    } else {
      haptics.select();
      setContractActive(contract.id, true);
    }
  }

  function toggleProperty() {
    if (p.isActive) {
      confirmThen(
        'Turn Off Property',
        `Hide ${p.name} from routes and recommendations? Its contract, services and every past visit are kept, and you can turn it back on.`,
        'Turn Off',
        () => { haptics.select(); setPropertyActive(p.id, false); },
      );
    } else {
      haptics.select();
      setPropertyActive(p.id, true);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.groupedBackground }]}>
      <ScreenHeader
        title={p.name}
        subtitle={address || undefined}
        right={<GlassIconButton icon="edit-2" onPress={edit} accessibilityLabel="Edit property and services" />}
      />

      <ScrollView bounces={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: clearance + spacing['2xl'] }}>
        {!p.isActive && (
          <View style={[styles.banner, { backgroundColor: colors.backgroundTertiary }]}>
            <Icon name="pause-circle" size={16} color={colors.textSecondary} />
            <Text style={[typeScale.bodySmall, { color: colors.textSecondary, flex: 1 }]}>
              This property is turned off. It isn't recommended for routes. History is kept.
            </Text>
          </View>
        )}

        {/* Where and who */}
        <ListSection title="PROPERTY">
          <ListRow
            icon="map-pin"
            title={p.address || 'No address'}
            subtitle={[p.city, p.state, p.zip].filter(Boolean).join(', ') || undefined}
            showChevron={!!p.address}
            onPress={p.address ? () => previewOnMap({ address: p.address, city: p.city, state: p.state, zip: p.zip, latitude: p.latitude, longitude: p.longitude }) : undefined}
          />
          <ListRow
            icon="user"
            title={p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : 'No customer linked'}
            subtitle={p.customer ? 'Customer' : undefined}
            showChevron={!!p.customer}
            onPress={p.customer ? () => router.push(`/(owner)/customers/${p.customer!.id}` as any) : undefined}
          />
          {p.latitude == null && (
            <ListRow icon="crosshair" title="No map location" subtitle="Arrivals here can't be GPS-verified. Edit the address and check it on the map." />
          )}
        </ListSection>

        <CustomerAccessSection customer={p.customer} />

        {(!!p.accessNotes || !!p.notes) && (
          <ListSection title="NOTES">
            {!!p.accessNotes && <NoteBlock icon="key" title="Access" body={p.accessNotes} />}
            {!!p.notes && <NoteBlock icon="file-text" title="Property notes" body={p.notes} />}
          </ListSection>
        )}

        {/* Contract */}
        <ListSection title="CONTRACT">
          {contract ? (
            <>
              <ListRow
                icon="file"
                title={contract.name}
                subtitle={contract.seasonStart || contract.seasonEnd
                  ? `Season ${contract.seasonStart ? formatDocDate(contract.seasonStart) : '…'} – ${contract.seasonEnd ? formatDocDate(contract.seasonEnd) : '…'}`
                  : 'No season dates'}
                rightElement={<StatusBadge label={contractActive ? 'Active' : 'Inactive'} status={contractActive ? 'success' : 'neutral'} />}
              />
              {!!contract.notes && <NoteBlock icon="info" title="Contract notes" body={contract.notes} />}
              <ListRow
                icon={contractActive ? 'pause' : 'play'}
                title={contractActive ? 'Deactivate Contract' : 'Reactivate Contract'}
                subtitle={contractActive ? 'Keeps all past visits' : 'Recommend this property for routes again'}
                onPress={toggleContract}
              />
            </>
          ) : (
            <ListRow
              icon="plus"
              title="Start a Contract"
              subtitle="Add the recurring services for this property"
              showChevron
              onPress={edit}
            />
          )}
        </ListSection>

        {/* Services */}
        {contract && (
          <ListSection title="SERVICES" footer={contractActive ? 'Each service is due on its own schedule. Only finished stops count as done.' : undefined}>
            {onServices.length === 0 ? (
              <ListRow icon="plus" title="Add Service" subtitle="Lawn cuts, cleanups, trimming…" showChevron onPress={addService} />
            ) : onServices.map((s) => (
              <View key={s.rule.id} style={styles.blockPad}>
                <ServiceDueLine info={s} onDate={today} showRule />
                {!!s.rule.instructions && (
                  <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 4 }]}>{s.rule.instructions}</Text>
                )}
              </View>
            ))}
            {onServices.length > 0 && <ListRow icon="plus" title="Add Service" showChevron onPress={addService} />}
            {offServices.length > 0 && (
              <ListRow
                icon={showOff ? 'chevron-up' : 'chevron-down'}
                title={`${offServices.length} turned-off service${offServices.length === 1 ? '' : 's'}`}
                onPress={() => setShowOff((v) => !v)}
              />
            )}
            {showOff && offServices.map((r) => (
              <ListRow key={r.id} icon="slash" title={r.label} subtitle="Turned off · history kept" />
            ))}
          </ListSection>
        )}

        {contracts.length > 1 && (
          <ListSection title="EARLIER CONTRACTS">
            {contracts.filter((c) => c.id !== contract?.id).map((c) => (
              <ListRow key={c.id} icon="archive" title={c.name} subtitle={c.status === 'active' ? 'Active' : 'Inactive'} />
            ))}
          </ListSection>
        )}

        {/* History */}
        <ListSection title={visits.length > RECENT_VISITS ? 'RECENT VISITS' : `VISITS (${visits.length})`}>
          {visits.length === 0 ? (
            <View style={styles.blockPad}>
              <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]}>
                No visits yet. Visits appear here when this property is put on a route.
              </Text>
            </View>
          ) : visits.slice(0, RECENT_VISITS).map((v) => <VisitRow key={v.id} stop={v} serviceDate={m.routeById[v.routeId]?.serviceDate} />)}
          {/* Every visit and per-service counts live on the shared history screen. */}
          <ListRow
            icon="clock"
            title="Full Service History"
            subtitle={visits.length > RECENT_VISITS ? `All ${visits.length} visits, per service` : 'Every visit, per service'}
            showChevron
            onPress={() => router.push(`/(owner)/maintenance/history/${p.id}` as any)}
          />
        </ListSection>

        <ListSection>
          <ListRow
            icon={p.isActive ? 'eye-off' : 'eye'}
            title={p.isActive ? 'Turn Off Property' : 'Turn Property Back On'}
            destructive={p.isActive}
            onPress={toggleProperty}
          />
        </ListSection>

        <IssuesSection where={{ maintenancePropertyId: p.id }} />
      </ScrollView>
    </View>
  );
}

function NoteBlock({ icon, title, body }: { icon: 'key' | 'file-text' | 'info'; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.blockPad, { flexDirection: 'row', gap: spacing.sm }]}>
      <Icon name={icon} size={16} color={colors.textTertiary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.labelSmall, { color: colors.textSecondary }]}>{title}</Text>
        <Text style={[typeScale.bodySmall, { color: colors.textPrimary }]}>{body}</Text>
      </View>
    </View>
  );
}

function VisitRow({ stop, serviceDate }: { stop: MaintenanceStopDetail; serviceDate?: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const badge = STOP_BADGE[stop.status];
  const done = stop.services.filter((s) => s.completed).map((s) => s.label);
  const planned = stop.services.map((s) => s.label);
  const services = stop.status === 'completed' ? done : planned;
  return (
    <Pressable
      onPress={() => router.push(`/(owner)/maintenance/routes/${stop.routeId}` as any)}
      style={({ pressed }) => [styles.blockPad, pressed && { backgroundColor: colors.backgroundSecondary }]}
      accessibilityRole="button"
      accessibilityLabel={`Visit on ${serviceDate ?? 'unknown date'}, ${badge.label}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={[typeScale.bodyLarge, { color: colors.textPrimary, fontWeight: '600', flex: 1 }]}>
          {serviceDate ? formatDocDate(serviceDate) : 'Route'}
        </Text>
        <StatusBadge label={badge.label} status={badge.status} />
        <Icon name="chevron-right" size={16} color={colors.textTertiary} />
      </View>
      {services.length > 0 && (
        <Text style={[typeScale.bodySmall, { color: colors.textSecondary }]} numberOfLines={2}>{services.join(', ')}</Text>
      )}
      {stop.status === 'completed' && stop.completedAt && (
        <Text style={[typeScale.caption, { color: colors.textTertiary }]}>
          Finished {new Date(stop.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </Text>
      )}
      {stop.status === 'skipped' && !!stop.skipReason && (
        <Text style={[typeScale.caption, { color: colors.textTertiary }]}>Skipped: {stop.skipReason}</Text>
      )}
      {!!stop.instructions && (
        <Text style={[typeScale.caption, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={3}>
          Visit note: {stop.instructions}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, marginBottom: spacing.lg },
  blockPad: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, gap: 2 },
});

