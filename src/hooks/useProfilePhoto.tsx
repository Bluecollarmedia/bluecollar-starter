/**
 * One way to choose a profile photo everywhere: pick it (camera or library), then crop it on our own crop screen.
 * A screen calls pick('camera' | 'library') and renders {cropper}. onPicked gets the finished square picture; if the crop
 * screen's crop can't be made, it gets the automatic centred square instead, so a photo is never lost.
 */
import React, { useCallback, useState } from 'react';
import { AvatarCropper } from '@/components/account/AvatarCropper';
import { chooseProfilePhoto, type ProfilePhotoSource } from '@/lib/profilePhoto';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The system picker needs a moment to finish closing before another full-screen view can open. */
const AFTER_PICKER_MS = 400;

interface Pending { uri: string; width: number; height: number; fallback: string }

export function useProfilePhoto(onPicked: (uri: string) => void, onError: (message: string) => void) {
  const [pending, setPending] = useState<Pending | null>(null);

  const pick = useCallback(async (source: ProfilePhotoSource, opts: { afterSheetMs?: number } = {}) => {
    const res = await chooseProfilePhoto(source, opts);
    if (res.status === 'error') { onError(res.message); return; }
    if (res.status !== 'picked') return;
    await sleep(AFTER_PICKER_MS);
    setPending({ ...res.raw, fallback: res.uri });
  }, [onPicked, onError]);

  const cropper: React.ReactNode = pending ? (
    <AvatarCropper
      visible
      uri={pending.uri}
      width={pending.width}
      height={pending.height}
      onCancel={() => setPending(null)}
      onDone={(cropped) => { const p = pending; setPending(null); onPicked(cropped ?? p.fallback); }}
    />
  ) : null;

  return { pick, cropper };
}
