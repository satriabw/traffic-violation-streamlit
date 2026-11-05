'use client';

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { label, SPEED_WINDOW_SECONDS, type Track } from '@/lib/evidence';

export function SpeedChart({ tracks, colours, fps, violationT }: {
  tracks: Track[];
  colours: Map<number, string>;
  fps?: number | null;
  violationT?: number | null;
}) {
  const selected = tracks.filter(track => colours.has(track.trackId));
  const rows = new Map<number, Record<string, number>>();
  if (fps && fps > 0) {
    for (const track of selected) {
      track.frameIdxs.forEach((frame, index) => {
        const speed = track.speed[index];
        if (speed == null || !Number.isFinite(speed)) return;
        const t = frame / fps;
        rows.set(t, { ...rows.get(t), t, [`track${track.trackId}`]: speed });
      });
    }
  }
  const data = [...rows.values()].sort((a, b) => a.t - b.t);
  if (!data.length) return <p>No speeds available for the selected vehicles.</p>;
  const end = data[data.length - 1].t;
  const start = end - SPEED_WINDOW_SECONDS;
  const config = Object.fromEntries(selected.map(track => [`track${track.trackId}`, { label: label(track), color: colours.get(track.trackId)! }]));
  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <LineChart data={data.filter(row => row.t >= start)} margin={{ top: 25, right: 20, bottom: 25, left: 10 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="t" type="number" domain={[start, end]} allowDataOverflow tickFormatter={value => Number(value).toFixed(1)} label={{ value: 'seconds into the video', position: 'bottom' }} />
        <YAxis label={{ value: 'speed (m/s)', angle: -90, position: 'insideLeft' }} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {selected.map(track => <Line key={track.trackId} dataKey={`track${track.trackId}`} name={label(track)} stroke={colours.get(track.trackId)} dot={false} connectNulls isAnimationActive={false} />)}
        {violationT != null && violationT >= start && violationT <= end && <ReferenceLine x={violationT} stroke="#64748b" strokeDasharray="4 4" label="violation" />}
      </LineChart>
    </ChartContainer>
  );
}
