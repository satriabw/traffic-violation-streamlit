import { SERIES } from '@/lib/evidence';
import { LAYERS, type Layer, type SceneDocument } from '@/lib/regions';

export function RegionsOverlay({ document, size, layers, labels = true }: {
  document?: SceneDocument | null; size: [number, number]; layers: Layer[]; labels?: boolean;
}) {
  return <svg viewBox={`0 0 ${size[0]} ${size[1]}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Scene configuration regions">
    {LAYERS.filter(layer => layers.includes(layer)).flatMap(layer => (document?.regions?.[layer] ?? []).flatMap((region, index) => {
      const points = region.points;
      if (!points || points.length < 3 || points.some(p => p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) return [];
      const colour = SERIES[LAYERS.indexOf(layer)];
      const at = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
      return [<g key={`${layer}-${index}`}>
        <polygon points={points.map(p => p.slice(0, 2).join(',')).join(' ')} fill={colour} fillOpacity={0.2} stroke={colour} strokeWidth={Math.max(2, size[0] / 400)}><title>{region.id ?? layer}</title></polygon>
        {labels && <text x={at[0]} y={at[1]} fill="white" fontSize={Math.max(14, size[0] / 70)} fontWeight={700} paintOrder="stroke" stroke={colour} strokeWidth={6}>{region.id ?? layer}</text>}
      </g>];
    }))}
  </svg>;
}
