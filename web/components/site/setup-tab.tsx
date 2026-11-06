'use client';

import { Loading } from '@/components/loading';
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrNull, post } from '@/lib/api';
import { ts } from '@/lib/format';
import type { Doc, FileRow, Source } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { UploadForm } from '@/components/upload-form';
import { DocumentCard } from './document-card';
import { ArrowRight, Check, Circle, Radio, Video, SlidersHorizontal, Focus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <div className="flex items-center gap-3">{ready ? <Check className="size-4 text-emerald-600" /> : <Circle className="size-4 text-muted-foreground" />}<div><p className="text-sm font-medium">{ready ? 'Ready for detection' : 'Start with a video or live feed'}</p><p className="mt-1 text-xs text-muted-foreground">{ready ? 'You can refine the optional documents below.' : 'Configuration and calibration can be added later.'}</p></div></div>
        <Button size="sm" disabled={!ready} onClick={onDetection}>Go to detection<ArrowRight className="size-3.5" /></Button>
      </div>
      {configuration.isError && <ErrorAlert error={configuration.error} />}{calibration.isError && <ErrorAlert error={calibration.error} />}
      <Tabs defaultValue="source" className="gap-5">
        <TabsList variant="line" className="h-auto max-w-full flex-wrap justify-start gap-3 border-b pb-2">
          <TabsTrigger value="source" className="gap-2 px-2 py-2"><Video className="size-4" />Source{active && <Check className="size-3 text-emerald-600" />}</TabsTrigger>
          <TabsTrigger value="configuration" className="gap-2 px-2 py-2"><SlidersHorizontal className="size-4" />Scene configuration{configuration.data && <Check className="size-3 text-emerald-600" />}</TabsTrigger>
          <TabsTrigger value="calibration" className="gap-2 px-2 py-2"><Focus className="size-4" />Camera calibration{calibration.data && <Check className="size-3 text-emerald-600" />}</TabsTrigger>
        </TabsList>
        <TabsContent value="source">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(15rem,2fr)]">
          <section className="min-w-0 space-y-5 rounded-xl border p-5 sm:p-6">
            <header className="space-y-1"><h2 className="text-base font-medium">Video or live camera</h2><p className="text-sm text-muted-foreground">Choose the source this site will use for detection.</p></header>


        {source.isPending && <Loading label="Loading source…" />}
        {source.isError && <ErrorAlert error={source.error} />}
        {source.data === null && <p>No source attached yet. Detection needs a video or a live feed to run.</p>}
        <Tabs defaultValue="video">
          <TabsList>
            <TabsTrigger value="video" className="px-3"><Video className="size-4" />Video</TabsTrigger>
            <TabsTrigger value="stream" className="px-3"><Radio className="size-4" />Live feed</TabsTrigger>
          </TabsList>
          <TabsContent value="video" className="space-y-4 pt-3">
            <p className="text-sm text-muted-foreground">Upload a recording. We’ll check that it can be read.</p>
            <label className="flex items-center gap-2"><Checkbox checked={known} onCheckedChange={setKnown} />Add a recording start time</label>
            {known && <p className="text-xs text-muted-foreground">Optional. Uses clock times instead of time elapsed in the video.</p>}
            {known && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor={`${id}-date`}>Recording date</Label><Input id={`${id}-date`} type="date" value={day} onChange={(event) => setDay(event.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor={`${id}-time`}>Start time (local)</Label><Input id={`${id}-time`} type="time" step={60} value={clock} onChange={(event) => setClock(event.target.value)} /></div>
              </div>
            )}
            <UploadForm compact types={['video']} accept=".mp4,.mov,.mkv,.avi" onUploaded={(row) => videoAttach.mutate(row)} />
            {videoAttach.isPending && <Loading label="Attaching it to the site…" />}
            {videoAttach.isError && <ErrorAlert error={videoAttach.error} />}
            {videoAttach.data && <p role="status">Attached as v{videoAttach.data.version}.</p>}
          </TabsContent>
          <TabsContent value="stream" className="space-y-4 pt-3">
            <p className="text-sm text-muted-foreground">Connect a camera. The feed is checked when detection starts.</p>
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
          <aside className="min-w-0 space-y-5 self-start rounded-xl bg-muted/40 p-5 sm:p-6">
            <div className="space-y-2"><h3 className="text-sm font-medium">Current source</h3>{active ? <><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{active.kind === 'video' ? 'Recorded video' : 'Live feed'}</Badge><span className="text-xs text-muted-foreground">Version {active.version}</span></div><p className="text-sm text-muted-foreground">{active.kind === 'video' ? `${metadata?.fps?.toFixed(2) ?? '—'} FPS${metadata?.resolution ? ` · ${metadata.resolution.width} × ${metadata.resolution.height}` : ''}` : 'The feed is checked when detection starts.'}</p></> : <p className="text-sm text-muted-foreground">No source yet. Add one to get started.</p>}</div>
            <div className="space-y-2 border-t pt-4"><h3 className="text-sm font-medium">When you change sources</h3><p className="text-sm leading-relaxed text-muted-foreground">The new source is used for the next detection session. Sessions already running keep their original source.</p></div>
        {active && (
          <details className="rounded-lg bg-muted/50 p-3 text-sm"><summary className="cursor-pointer font-medium">Current source · {active.kind === 'stream' ? 'Live feed' : 'Video'} v{active.version}</summary><div className="mt-3 space-y-2 text-muted-foreground">
            <p>Frames: {estimated ? '≈ ' : ''}{frames ?? '—'} · FPS: {metadata?.fps ?? '—'}</p>
            {metadata?.resolution && <p>{metadata.resolution.width}×{metadata.resolution.height}{metadata.duration_seconds != null && ` · ${metadata.duration_seconds.toFixed(2)}s`}</p>}
            {active.kind === 'video' && <p>{active.recorded_at ? `Recording started ${ts(active.recorded_at)}` : 'No recording start time. Violation times are relative to the video.'}</p>}
            <p className="break-all text-xs">Source {active.id}{active.stream_url && ` · ${active.stream_url}`}</p>
          </div></details>
        )}

          </aside>
          </div>
        </TabsContent>
        <TabsContent value="configuration">
      <DocumentCard expanded siteId={siteId} resource="configurations" title="Scene configuration" blurb="Choose the road areas and rules to check. Add a configuration file with your lanes, crossing areas and traffic lights.">
        <details className="border-t pt-4 text-sm"><summary className="cursor-pointer text-muted-foreground">Need a starting point?</summary><div className="mt-4 space-y-3"><p className="leading-relaxed text-muted-foreground">Download the example and adjust the areas to your camera. Use format version 1 and at least three points for each area.</p><Button variant="outline" size="sm" onClick={downloadStarter}>Download config.json</Button><details><summary className="cursor-pointer text-muted-foreground">Preview example</summary><pre className="mt-3 overflow-auto rounded-lg bg-muted p-4 text-xs"><code>{starterBody}</code></pre></details></div></details>
      </DocumentCard>
        </TabsContent>
        <TabsContent value="calibration"><DocumentCard expanded siteId={siteId} resource="calibrations" title="Camera calibration" blurb="Convert positions in the image into distances on the road. Add a calibration file to estimate vehicle paths and speeds." /></TabsContent>
      </Tabs>
      <p className="px-1 pt-2 text-xs leading-relaxed text-muted-foreground">A source is required. Configuration enables rules for your scene; calibration enables distance and speed estimates.</p>
    </div>
  );
}
