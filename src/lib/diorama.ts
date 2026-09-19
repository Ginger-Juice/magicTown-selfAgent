/**
 * Per-landmark 3D scenes. The town shell stays 2.5D; only listed ids
 * step into a diorama. Plan A ships `town-hall` (镇公所) as the first
 * homepage-aligned scene. The older konbini GLB is a tech sample only
 * and is intentionally not registered here.
 *
 * The town-hall mesh is Blender-authored (`scripts/blender/town_hall.py`).
 * Runtime only loads that exported GLB. Do not generate this building in Three.js.
 */
export type DioramaKind = 'town-hall-garden';

export interface DioramaScene {
  landmarkId: string;
  kind: DioramaKind;
  /** Vite-public URL served from public/ */
  glbUrl: string;
  /** CSS backdrop while the canvas boots (match the mount preset). */
  backdrop: string;
}

export const DIORAMA_SCENES: Record<string, DioramaScene> = {
  'town-hall': {
    landmarkId: 'town-hall',
    kind: 'town-hall-garden',
    glbUrl: '/diorama-town-hall/town_hall.glb',
    backdrop: '#f3efe6',
  },
};

export function dioramaFor(landmarkId: string | null | undefined): DioramaScene | undefined {
  if (!landmarkId) return undefined;
  return DIORAMA_SCENES[landmarkId];
}
