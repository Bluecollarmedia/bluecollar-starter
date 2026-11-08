// The maths behind the profile photo crop screen. Pure, no network.
//
// The crop frame is a square of FRAME screen points (the circle is drawn inside it). The picture is shown "cover" style (it
// always fills the frame) times a zoom from 1 up, and the person drags it. Offsets are how far the picture's centre sits from
// the frame's centre, in screen points. From those we work out which square of the ORIGINAL picture is under the frame.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface CropView {
  /** Original picture size in pixels. */
  width: number;
  height: number;
  /** Side of the square crop frame on screen, in points. */
  frame: number;
  zoom: number;
}

/** Screen points per original pixel at this zoom (zoom 1 = the picture just covers the frame). */
export function displayScale(v: CropView): number {
  const base = v.frame / Math.min(v.width, v.height);
  return base * clampZoom(v.zoom);
}

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Keeps the picture covering the whole frame: the offset can't drag an edge into the frame. */
export function clampOffset(v: CropView, tx: number, ty: number): { tx: number; ty: number } {
  const s = displayScale(v);
  const maxX = Math.max(0, (v.width * s - v.frame) / 2);
  const maxY = Math.max(0, (v.height * s - v.frame) / 2);
  return { tx: Math.min(maxX, Math.max(-maxX, tx)), ty: Math.min(maxY, Math.max(-maxY, ty)) };
}

/** The square of the original picture (in pixels) that sits under the frame. */
export function cropBox(v: CropView, tx: number, ty: number): { originX: number; originY: number; size: number } {
  const s = displayScale(v);
  const o = clampOffset(v, tx, ty);
  const size = Math.min(Math.min(v.width, v.height), v.frame / s);
  // Frame centre in original pixels: picture centre minus the offset, converted from points to pixels.
  const cx = v.width / 2 - o.tx / s;
  const cy = v.height / 2 - o.ty / s;
  const originX = Math.min(v.width - size, Math.max(0, cx - size / 2));
  const originY = Math.min(v.height - size, Math.max(0, cy - size / 2));
  return { originX: Math.floor(originX), originY: Math.floor(originY), size: Math.floor(size) };
}

/** Slider position (0 to 1) from a zoom, and back. */
export const zoomToFraction = (z: number) => (clampZoom(z) - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM);
export const fractionToZoom = (f: number) => clampZoom(MIN_ZOOM + Math.min(1, Math.max(0, f)) * (MAX_ZOOM - MIN_ZOOM));
