import type { Source } from './types';

export const LAYERS = ['lanes', 'rois', 'traffic_lights'] as const;
export type Layer = typeof LAYERS[number];
export type SceneDocument = {
  camera?: { width?: number; height?: number };
  regions?: Partial<Record<Layer, { id?: string; points?: number[][] }[]>>;
};

export function drawnSize(document: SceneDocument | null | undefined, source: Source | null | undefined): [number, number] | null {
  const camera = document?.camera;
  const resolution = source?.metadata?.resolution;
  for (const size of [camera, resolution]) {
    if (size?.width && size.height && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0) return [size.width, size.height];
  }
  return null;
}
