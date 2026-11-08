import { Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { db } from '@/data/store';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { useMaintenanceCheckIn } from '@/hooks/useMaintenanceCheckIn';
import { missingRequirements, finishStopAndAdvance } from '@/data/maintenanceFinish';
import { isCrewLeader } from '@/lib/maintenanceLeader';
import { haptics } from '@/lib/haptics';
import { useT } from '@/i18n';
import type { MaintenanceRouteDetail, MaintenanceStopDetail } from '@/types/maintenance';

function showMessage(title: string, message: string) {
  if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/**
 * What a worker can do to a route stop from a Today screen. These are the SAME actions the maintenance Today always had (check in,
 * finish, open the stop, directions); this only moves them so the maintenance Today and the combined Today share one copy.
 * Nothing about the rules changes: the stop screen still decides what is missing before a stop can finish.
 */
export function useStopActions() {
  const t = useT();
  const router = useRouter();
  const { openMapsNavigation } = useWorkerContext();
  const checkIn = useMaintenanceCheckIn();

  const open = (stop: MaintenanceStopDetail) => router.push(`/(worker)/maintenance-stop/${stop.id}` as any);
  const arrive = (stop: MaintenanceStopDetail) => { haptics.select(); checkIn.arriveAtStop(stop.id); };
  const finish = async (stop: MaintenanceStopDetail) => {
    if (missingRequirements(stop).length) { haptics.warning(); open(stop); return; }
    haptics.select();
    const result = await finishStopAndAdvance(stop.id);
    if (result.ok) haptics.success();
    else if (result.missing.length) open(stop);
    else { haptics.warning(); showMessage(t("Couldn't save that"), result.error ?? t('Please try again.')); }
  };
  const directions = (stop: MaintenanceStopDetail) => { if (stop.property) { haptics.select(); openMapsNavigation(stop.property); } };
  /** Whether this person checks the crew in and finishes stops on this route (its leader, or the owner/admin). */
  const isLeader = (route: MaintenanceRouteDetail) => isCrewLeader({ leadId: route.lead?.id, personId: db.personId, role: db.role });

  return { open, arrive, finish, directions, isLeader, startingStopId: checkIn.busy, checkIn };
}
