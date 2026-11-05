'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrNull, post } from '@/lib/api';
import { ts } from '@/lib/format';
import type { Doc, FileRow, Source } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { UploadForm } from '@/components/upload-form';
import { DocumentCard } from './document-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const starter = {
  version: 1,
  violations: ['pdx_violation'],
  regions: {
    lanes: [{ id: 'lane_1', points: [[115, 640], [430, 640], [400, 470], [210, 470]] }],
    traffic_lights: [{ id: 'tl_1', points: [[610, 90], [650, 90], [650, 160], [610, 160]], controls: ['lane_1'] }],
    rois: [{ id: 'crosswalk_1', points: [[100, 430], [700, 430], [700, 520], [100, 520]] }],
  },
  rules: { pdx_violation: { rois: ['crosswalk_1'] } },
};
const starterBody = JSON.stringify(starter, null, 2);

function downloadStarter() {
  const url = URL.createObjectURL(new Blob([starterBody], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'config.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SetupTab({ siteId, onDetection }: { siteId: string; onDetection: () => void }) {
  const id = useId();
  const client = useQueryClient();
  const path = `/sites/${encodeURIComponent(siteId)}`;
  const [streamUrl, setStreamUrl] = useState('');
  const [known, setKnown] = useState(false);
  const [day, setDay] = useState('');
  const [clock, setClock] = useState('00:00');
  const source = useQuery({ queryKey: ['sources', siteId], queryFn: () => getOrNull<Source>(`${path}/sources`) });
  const configuration = useQuery({ queryKey: ['configurations', siteId], queryFn: () => getOrNull<Doc>(`${path}/configurations`) });
  const calibration = useQuery({ queryKey: ['calibrations', siteId], queryFn: () => getOrNull<Doc>(`${path}/calibrations`) });
  async function onSourceAttached() {
    await client.invalidateQueries({ queryKey: ['sources', siteId] });
    await client.invalidateQueries({ queryKey: ['site', siteId] });
    await client.invalidateQueries({ queryKey: ['sites'] });
  }

  const attach = useMutation({
    mutationFn: (body: { kind: 'video' | 'stream'; file_id?: string; stream_url?: string; recorded_at?: string | null }) => post<Source>(`${path}/sources`, body),
    onSuccess: onSourceAttached,
  });
  const videoAttach = useMutation({
    mutationFn: (row: FileRow) => {
      const recorded = known ? new Date(`${day}T${clock}`) : null;
      if (recorded && !Number.isFinite(recorded.getTime())) {
        throw new Error('Choose a recording date and start time.');
      }
      return post<Source>(`${path}/sources`, {
        kind: 'video',
        file_id: row.id,
        recorded_at: recorded?.toISOString() ?? null,
      });
    },
    onSuccess: onSourceAttached,
  });
  const active = source.data;
  const metadata = active?.metadata;
  const estimated = !metadata?.total_frames && !!metadata?.fps && metadata.duration_seconds != null;
  const frames = metadata?.total_frames ?? (estimated ? Math.round(metadata!.fps! * metadata!.duration_seconds!) : null);
  const stream = active?.kind === 'stream';
  const ready = !!active && (stream || !!metadata?.fps);
  const checks = [
    ['Video or live feed attached', !!active],
    [stream ? 'Live feed (checked when detection starts)' : 'Video checked', stream || !!metadata?.fps],
    ['Configuration attached', !!configuration.data],
    ['Calibration attached', !!calibration.data],
  ] as const;

  return (
    <div className="space-y-6 pt-4">
      <p>Calibration, scene configuration and source for the selected site.</p>
      <DocumentCard siteId={siteId} resource="calibrations" title="Camera calibration" blurb="The camera calibration file. It converts positions in the video image into real positions on the road, in metres. Without it, violations can still be detected, but vehicle paths and speeds cannot be estimated." />
      <DocumentCard siteId={siteId} resource="configurations" title="Scene configuration" blurb="Which rules to check, and the road areas (polygons) they apply to. An area counts as a lane only when it is listed under `lanes`, whatever its name, and `controls` sets which lanes each traffic light governs. The optional `rules` block names the ROIs each rule reads; a rule without one reads every ROI." />
      <details className="space-y-3 rounded-lg border p-5">
        <summary className="cursor-pointer">Starter document</summary>
        <p>Start from this template. Only format version 1 is accepted, and unknown section names are rejected — so a misspelt section name gives an error instead of silently disabling a rule. Each area needs at least three corner points. A `rules` entry may only name a rule listed under `violations` and ROIs declared under `rois`. Red light running (`rlr_violation`) is switched off on the server until it is validated.</p>
        <pre className="overflow-auto rounded bg-muted p-4"><code>{starterBody}</code></pre>
        <Button onClick={downloadStarter}>Download config.json</Button>
      </details>
      <section className="space-y-4 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Active source</h2>
        <p>Adding a new source keeps the previous ones on record. A detection session that has already started keeps using the source it started with.</p>
        {source.isPending && <p role="status">Loading source…</p>}
        {source.isError && <ErrorAlert error={source.error} />}
        {source.data === null && <p>No source attached yet. Detection needs a video or a live feed to run.</p>}
        {active && (
          <div className="space-y-2">
            <p><Badge>{active.status}</Badge> {active.kind} · Version v{active.version}</p>
            <p>Frames: {estimated ? '≈ ' : ''}{frames ?? '—'} · FPS: {metadata?.fps ?? '—'}</p>
            {metadata?.resolution && <p>{metadata.resolution.width}×{metadata.resolution.height}{metadata.duration_seconds != null && ` · ${metadata.duration_seconds.toFixed(2)}s`}</p>}
            {estimated && <p>The number of frames shown is estimated from the video length and frame rate, because this video file does not record it. Detection still runs: frames are counted as the video is cut into pieces.</p>}
            {active.kind === 'video' && <p>{active.recorded_at ? `Recording started ${ts(active.recorded_at)}, so violations show the time they happened.` : 'No recording start time, so violations show how far into the video they happened. Add the video again with its start time to show clock times.'}</p>}
            <p className="break-all">source <code>{active.id}</code>{active.stream_url && ` · ${active.stream_url}`}</p>
          </div>
        )}
        <Tabs defaultValue="video">
          <TabsList>
            <TabsTrigger value="video">Upload a video</TabsTrigger>
            <TabsTrigger value="stream">Use a live camera feed</TabsTrigger>
          </TabsList>
          <TabsContent value="video" className="space-y-4 pt-3">
            <p>The video is checked when it is added, so a file that cannot be read is rejected now rather than failing detection later.</p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={known} onChange={(event) => setKnown(event.target.checked)} />I know when this video was recorded</label>
            <p className="text-sm text-muted-foreground">Optional. With it, violations show the clock time they happened; without it, how far into the video.</p>
            {known && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor={`${id}-date`}>Recording date</Label><Input id={`${id}-date`} type="date" value={day} onChange={(event) => setDay(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor={`${id}-time`}>Start time (local)</Label><Input id={`${id}-time`} type="time" step={60} value={clock} onChange={(event) => setClock(event.target.value)} /></div>
              </div>
            )}
            <UploadForm types={['video']} accept=".mp4,.mov,.mkv,.avi" onUploaded={(row) => videoAttach.mutate(row)} />
            {videoAttach.isPending && <p role="status">Attaching it to the site…</p>}
            {videoAttach.isError && <ErrorAlert error={videoAttach.error} />}
            {videoAttach.data && <p role="status">Attached as v{videoAttach.data.version}.</p>}
          </TabsContent>
          <TabsContent value="stream" className="space-y-4 pt-3">
            <p>A live camera feed is not checked when added; it is probed when detection starts, and recorded until you stop it on the Detection page.</p>
            <form className="space-y-3" onSubmit={(event) => {
              event.preventDefault();
              if (streamUrl.trim() && !attach.isPending) attach.mutate({ kind: 'stream', stream_url: streamUrl.trim() });
            }}>
              <Label htmlFor={`${id}-stream`}>Stream URL</Label>
              <Input id={`${id}-stream`} placeholder="rtsp://…" value={streamUrl} onChange={(event) => setStreamUrl(event.target.value)} />
              <Button type="submit" disabled={!streamUrl.trim() || attach.isPending}>
                {attach.isPending ? 'Attaching…' : 'Add live feed'}
              </Button>
            </form>
            {attach.isError && <ErrorAlert error={attach.error} />}
            {attach.data && <p role="status">Attached as v{attach.data.version}.</p>}
          </TabsContent>
        </Tabs>
      </section>
      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Ready to detect?</h2>
        {checks.map(([label, ok]) => <p key={label}><span aria-label={ok ? 'Ready' : 'Missing'}>{ok ? '✓' : '○'}</span> {label}</p>)}
        {configuration.isError && <ErrorAlert error={configuration.error} />}
        {calibration.isError && <ErrorAlert error={calibration.error} />}
        <p className="text-sm text-muted-foreground">The first two are required before detection can run. Configuration and calibration are optional, but without them fewer rules can be checked, and vehicle paths and speeds cannot be estimated.</p>
        <Button disabled={!ready} onClick={onDetection}>Go to detection</Button>
      </section>
    </div>
  );
}
