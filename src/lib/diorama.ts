/**
 * Per-landmark 3D scenes. The town shell stays 2.5D; only listed ids
 * step into a diorama. `store` is the general store / konbini chip and
 * matches assets/diorama-konbini (ほしマート rain-night GLB).
 */
export type DioramaKind = 'konbini-rain-night';

export interface DioramaScene {
  landmarkId: string;
  kind: DioramaKind;
  /** Vite-public URL served from public/ */
  glbUrl: string;
}

export const DIORAMA_SCENES: Record<string, DioramaScene> = {
  store: {
    landmarkId: 'store',
    kind: 'konbini-rain-night',
    glbUrl: '/diorama-konbini/konbini_rain_night.glb',
  },
};

export function dioramaFor(landmarkId: string | null | undefined): DioramaScene | undefined {
  if (!landmarkId) return undefined;
  return DIORAMA_SCENES[landmarkId];
}
