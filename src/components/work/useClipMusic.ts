import { useEffect, useRef } from 'react';
import { useVideoPlayer } from 'expo-video';
import { clipVolume, nextLoopPosition, type Clip } from '@/lib/portfolio';

/**
 * Plays the part of the owner's track that was chosen for a post, on a loop, while `active` (the post is open) and not `muted`.
 * It starts at the chosen start, jumps back to it when the part ends, and fades out over the last 2 seconds when the owner kept the fade on.
 * While a video that keeps its own sound is on screen (`duck`), the song is lowered to a fifth and comes back up after, like Instagram.
 * Leaving the post (active false) pauses it. It goes to the chosen start only the first time it plays; swiping between pictures, muting and
 * unmuting, or switching apps never restarts it. The track is played with the same player the app uses for video (an audio file plays with no picture).
 */
/** How loud the song is while a video with its own sound is on screen (it is lowered, not stopped, then comes back up). */
export const DUCK_LEVEL = 0.2;

export function useClipMusic(url: string | null, clip: Clip | null, opts: { active: boolean; muted: boolean; fade: boolean; duck?: boolean }): void {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
    // Start as soon as a few seconds are in, rather than waiting for a comfortable buffer: a song that starts a second late feels broken.
    try { p.bufferOptions = { ...p.bufferOptions, waitsToMinimizeStalling: false, preferredForwardBufferDuration: 8 }; } catch { /* older player */ }
  });
  const { active, muted, fade } = opts;
  const duck = !!opts.duck;
  // The song's level moves toward its target a step at a time (every quarter second), so lowering and raising it is smooth, never a jump.
  const level = useRef(1);
  const target = useRef(1);
  target.current = duck ? DUCK_LEVEL : 1;
  const startS = clip?.startS ?? 0;
  const endS = clip?.endS ?? 0;
  const hasClip = !!clip;
  const begun = useRef(false);
  // A different track is a different player: it starts at its own chosen start.
  useEffect(() => { begun.current = false; }, [url]);
  // The loop below must never start a player that was not asked to play (every post with music used to start at once in the feed).
  const wanted = useRef(false);
  wanted.current = active && !muted;

  useEffect(() => {
    if (!url || !hasClip) return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      try {
        if (!wanted.current) return;
        const c = { startS, endS };
        const jump = nextLoopPosition(currentTime, c);
        if (jump !== null) { player.currentTime = jump; player.play(); return; }
        const step = 0.25;
        level.current = Math.abs(target.current - level.current) <= step ? target.current : level.current + Math.sign(target.current - level.current) * step;
        player.volume = clipVolume(currentTime, c, fade) * level.current;
      } catch { /* the player is gone (screen closed); nothing to do */ }
    });
    return () => { try { sub.remove(); } catch { /* already gone */ } };
  }, [player, url, startS, endS, fade, hasClip]);

  useEffect(() => {
    if (!url || !hasClip) return;
    try {
      if (active && !muted) {
        if (!begun.current) { begun.current = true; player.currentTime = startS; }
        player.volume = duck ? DUCK_LEVEL : 1;
        level.current = duck ? DUCK_LEVEL : 1;
        player.play();
      } else {
        player.pause();
      }
    } catch { /* the player is gone (screen closed); nothing to do */ }
  }, [player, url, hasClip, active, muted, startS, duck]);
}
