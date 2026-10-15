import type * as THREE from 'three/webgpu';

/**
 * Object layers. The main camera sees every layer; the ball's reflection cameras see only layer 0.
 * The backdrop (stands, crowd, stars, ground, light shafts, particles) goes on its own layer: in a
 * 64-128 px reflection on a 27 mm ball it is sub-pixel, and leaving it out of the six cube faces
 * saves most of their draws.
 */
export const BACKDROP_LAYER = 1;

/** Move `obj` and everything under it onto the backdrop layer (layers are not inherited). */
export function toBackdrop<T extends THREE.Object3D>(obj: T): T {
  obj.traverse((o) => o.layers.set(BACKDROP_LAYER));
  return obj;
}
