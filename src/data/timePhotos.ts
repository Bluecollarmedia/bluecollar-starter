/**
 * Start / completion photos for a property visit (the owner can require them: Hours & Labor settings).
 *
 * The database refuses to start or complete a property until the worker's photo for that step is saved, so a hacked app can't skip
 * it. These helpers make that smooth: when the database says a photo is missing, offer the camera, save the photo (awaited, not in the
 * background, so it counts immediately), and try the step again. The photo is internal; it is never shown to customers.
 */
import { tr } from '@/i18n';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { keepPicked } from '@/lib/keepPickedFile';
import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/media';
import { db, refresh } from '@/data/store';

export type TimedPhotoTarget =
  | { kind: 'maintenance'; stopId: string }
  | { kind: 'project'; projectId: string; assignmentId?: string };
export type Phase = 'start' | 'complete';

const SAYS: Record<Phase, RegExp> = { start: /start photo/i, complete: /completion photo/i };

function ask(phase: Phase): Promise<boolean> {
  const title = phase === 'start' ? 'Start photo needed' : 'Completion photo needed';
  const body = phase === 'start' ? 'Take a photo of the property before you start.' : 'Take a photo of the finished work before you complete this property.';
  return new Promise((resolve) => {
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Take Photo', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** Opens the camera, uploads, and saves the photo for this step. */
export async function takeTimedPhoto(target: TimedPhotoTarget, phase: Phase): Promise<{ ok: true } | { ok: false; error: string }> {
  if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { ok: false, error: 'Camera access is needed for this photo. Turn it on for Brighton Lawn in the Settings app.' };
  }
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (shot.canceled || !shot.assets?.[0]) return { ok: false, error: 'No photo was taken.' };
  const uri = await keepPicked(shot.assets[0].uri);
  try {
    const companyId = db.companyId;
    if (target.kind === 'maintenance') {
      const stop = db.maintenance.stopById[target.stopId];
      if (!stop) return { ok: false, error: 'Stop not found.' };
      const { url, key } = await uploadImage(uri, `${companyId}/maintenance/${stop.propertyId}`);
      const { error } = await supabase.from('maintenance_photos').insert({
        company_id: companyId, route_id: stop.routeId, stop_id: stop.id, property_id: stop.propertyId, uploaded_by: db.personId,
        file_url: url, file_key: key, is_customer_visible: false, time_phase: phase, taken_at: new Date().toISOString(),
      });
      if (error) return { ok: false, error: "The photo couldn't be saved. Try again." };
      await refresh('maintenance_photos');
    } else {
      const { url, key } = await uploadImage(uri, `${companyId}/projects/${target.projectId}`);
      const { error } = await supabase.from('project_photos').insert({
        company_id: companyId, project_id: target.projectId, assignment_id: target.assignmentId ?? null, uploaded_by: db.personId,
        file_url: url, file_key: key, is_customer_visible: false, photo_type: phase === 'start' ? 'before' : 'after', time_phase: phase, taken_at: new Date().toISOString(),
      });
      if (error) return { ok: false, error: "The photo couldn't be saved. Try again." };
      await refresh('project_photos');
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : tr("The photo couldn't be uploaded. Try again.") };
  }
}

/**
 * Runs a start/complete step. If the database says the photo is missing, asks for it, saves it, and runs the step once more.
 * Anything else (or a cancelled photo) comes straight back as the original answer.
 */
export async function withTimedPhoto<T extends { ok: boolean; error?: string }>(run: () => Promise<T>, phase: Phase, target: TimedPhotoTarget): Promise<T> {
  const first = await run();
  if (first.ok || !SAYS[phase].test(first.error ?? '')) return first;
  if (!(await ask(phase))) return first;
  const shot = await takeTimedPhoto(target, phase);
  if (!shot.ok) return { ...first, error: shot.error } as T;
  return run();
}
