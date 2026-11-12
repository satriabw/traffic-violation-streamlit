'use client';

import { Loading } from '@/components/loading';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CHAT_ENABLED, get, getOrNull } from '@/lib/api';
import { eventTime, frameTime, safeUrl, ts } from '@/lib/format';
import { reviewLabel } from '@/lib/status';
import { cameraView, colourMap, groundZones, implausible, involved, label, tracksOf } from '@/lib/evidence';
import type { Doc, FileRow, Source, Violation } from '@/lib/types';
import { chatHref, workspaceHref } from '@/lib/navigation';
import { VideoPlayer } from '@/components/video-player';
import { Button } from '@/components/ui/button';
import { ReviewPanel } from '@/components/review-panel';
import { ErrorAlert } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { BoxesOverlay } from '@/components/evidence/boxes-overlay';
import { TrackPicker } from '@/components/evidence/track-picker';
import { FeedbackForm } from '@/components/feedback-form';
import { GroundPlot } from '@/components/evidence/ground-plot';
import { SpeedChart } from '@/components/evidence/speed-chart';
import { Alert, AlertDescription } from '@/components/ui/alert';

type Configuration = NonNullable<Parameters<typeof groundZones>[1]> & {
  camera?: { width?: number; height?: number };
};

function ViolationPage() {
  const { siteId, violationId } = useParams<{ siteId: string; violationId: string }>();
  const path = `/sites/${encodeURIComponent(siteId)}`;
  const violation = useQuery({
    queryKey: ['violation', siteId, violationId],
    queryFn: () => get<Violation>(`${path}/violations/${encodeURIComponent(violationId)}`),
  });
  const row = violation.data;
  const source = useQuery({
    queryKey: ['sources', siteId, row?.source_id],
    queryFn: () => getOrNull<Source>(`${path}/sources/${encodeURIComponent(row!.source_id!)}`),
    enabled: !!row?.source_id,
  });
  const configuration = useQuery({
    queryKey: ['configuration-version', siteId, row?.configuration_id],
    queryFn: async () => {
      const doc = await get<Doc>(`${path}/configurations/${encodeURIComponent(row!.configuration_id!)}`);
      const file = await get<FileRow>(`/files/${encodeURIComponent(doc.file_id)}`);
      const url = safeUrl(file.download_url);
      if (!url) throw new Error('The pinned configuration has no usable download URL.');
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not read the pinned configuration.');
      return await response.json() as Configuration;
    },
    enabled: !!row?.configuration_id,
    staleTime: Infinity,
  });
  return (
    <div className="space-y-6">
      <Link href={workspaceHref('/violations', siteId)} className="text-sm underline">Back to the list</Link>
      {violation.isPending && <Loading variant="video" label="Loading violation…" />}
      {violation.isError && <ErrorAlert error={violation.error} />}
      {row && <>
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">Violation</p>
          <h1 className="text-3xl font-semibold capitalize">{row.type.replaceAll('_', ' ')}</h1>
          <p>{eventTime(source.data, row.frame_index, row.detected_at)}</p>
          <div className="flex gap-3">
            <StatusBadge value={row.explanation_status} label={reviewLabel(row.explanation_status)} prefix="review" />
            <StatusBadge value={row.evidence_status} prefix="evidence" />
          </div>

        </header>
        {row.evidence_status == null && <Alert><AlertDescription>No evidence clip exists for this violation — it was recorded before evidence clips were introduced, so none will be created.</AlertDescription></Alert>}
        {source.isError && <ErrorAlert error={source.error} />}
        {configuration.isError && <ErrorAlert error={configuration.error} />}
        <Evidence key={`${siteId}-${violationId}`} violation={row} source={source.data} configuration={configuration.data} analysisLoading={!!((row.source_id && source.isPending) || (row.configuration_id && configuration.isPending))} />
        <details className="border-t pt-4 text-sm"><summary className="cursor-pointer text-muted-foreground">Record details</summary><div className="mt-4 space-y-2 break-all text-xs text-muted-foreground"><p>{row.id} · {frameTime(row.frame_index, source.data?.metadata?.fps)} · processed {ts(row.detected_at)}</p><p>{row.source_name || 'source'}{row.source_version != null && ` v${row.source_version}`} · {row.calibration_version != null ? `calibration v${row.calibration_version}` : 'no calibration'} · {row.configuration_version != null ? `configuration v${row.configuration_version}` : 'no configuration'} · run {row.run_id}</p></div></details>

      </>}
    </div>
  );
}

function Evidence({ violation, source, configuration, analysisLoading }: {
  violation: Violation; source?: Source | null; configuration?: Configuration; analysisLoading: boolean;
}) {
  const [stepsContainer, setStepsContainer] = useState<HTMLDivElement | null>(null);
  const clip = safeUrl(violation.clip_url);
  const thumbnail = safeUrl(violation.thumbnail_url);
  return <div className="space-y-6">
    <div className="grid items-start gap-6 xl:grid-cols-[3fr_2fr]">
      <section aria-label="Violation evidence" className="min-w-0 space-y-3">
        <h2 className="text-base font-medium">Violation clip</h2>
        {clip ? <VideoPlayer key={clip} src={clip} poster={thumbnail} label="Violation evidence clip" /> : thumbnail
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={thumbnail} alt="Violation evidence" className="aspect-video w-full rounded-xl bg-muted object-contain" />
          : <div className="rounded-xl bg-muted/40 p-8 text-center text-sm text-muted-foreground">{violation.evidence_status === 'pending' ? 'The evidence is still being prepared.' : 'No evidence image is available.'}</div>}
        {CHAT_ENABLED && <Button variant="outline" size="sm" render={<Link href={chatHref(violation.site_id, violation.id)} />}>Ask about this violation in Chat</Button>}
        <FeedbackForm siteId={violation.site_id} violationId={violation.id} />
      </section>
      <aside aria-label="Evidence review" className="min-w-0"><ReviewPanel key={violation.id} siteId={violation.site_id} violationId={violation.id} status={violation.explanation_status} updatedAt={violation.updated_at} stepsContainer={stepsContainer} /></aside>
    </div>
    <div ref={setStepsContainer} className="min-w-0 empty:hidden" />
    {analysisLoading ? <details className="border-t pt-5"><summary className="cursor-pointer text-sm font-medium">Paths of the involved road users</summary><Loading variant="panel" label="Loading road-user analysis…" /></details> : <RoadUserAnalysis key={`${source?.id}-${!!configuration}`} violation={violation} source={source} configuration={configuration} />}
  </div>;
}

function RoadUserAnalysis({ violation, source, configuration }: { violation: Violation; source?: Source | null; configuration?: Configuration }) {
  const tracks = tracksOf(violation.metadata);
  const fps = source?.metadata?.fps;
  const frame = violation.frame_index;
  const moment = fps && fps > 0 && frame != null ? frame / fps : null;
  const resolution = source?.metadata?.resolution;
  const sourceSize: [number, number] | null = resolution?.width && resolution.height
    ? [resolution.width, resolution.height] : null;
  const camera = configuration?.camera;
  const picture = sourceSize ?? (camera?.width && camera.height ? [camera.width, camera.height] as [number, number] : null);
  const violatorId = violation.metadata?.violator_track_id;
  const users = involved(tracks, violatorId, violation.involved_track_ids);
  const [selected, setSelected] = useState(() => users.slice(0, 3).map(track => track.trackId));
  const colours = colourMap(selected);
  const fastest = implausible(tracks, colours);
  if (!tracks.length) return null;
  return <details className="group min-w-0 border-t pt-5">
    <summary className="cursor-pointer text-sm font-medium">Paths of the involved road users<span className="ml-2 text-xs font-normal text-muted-foreground">Key frame, paths and speed estimates</span></summary>
    <div className="mt-5 space-y-5">
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">Positions and speeds are estimates based on camera calibration. Paths use a top-down ground plane in metres, because perspective distorts distances in the video.</p>
      {users.length > 0 && <TrackPicker tracks={users} selected={selected} onChange={setSelected} />}
      {violation.thumbnail_url && <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">Inspect the key frame</summary><div className="mt-4 max-w-3xl"><BoxesOverlay src={violation.thumbnail_url} tracks={tracks} frame={frame} sourceSize={sourceSize} colours={colours} violatorId={violatorId} involvedIds={violation.involved_track_ids} /></div></details>}
      {fastest != null && <Alert><AlertDescription>The fastest vehicle is estimated at {fastest.toFixed(0)} m/s ({(fastest * 3.6).toFixed(0)} km/h). Check the camera calibration; speeds and positions may be unreliable. Detection timing is unaffected.</AlertDescription></Alert>}
      {colours.size > 0 && <div className="grid gap-6 lg:grid-cols-2"><div className="min-w-0 space-y-3"><h3 className="text-sm font-medium">Road paths (metres, estimated)</h3><GroundPlot tracks={tracks} colours={colours} fps={fps} violationT={moment} zones={groundZones(violation.metadata, configuration)} view={cameraView(violation.metadata, picture)} /></div><div className="min-w-0 space-y-3"><h3 className="text-sm font-medium">Speed over the last 10 seconds (m/s)</h3><SpeedChart tracks={tracks} colours={colours} fps={fps} violationT={moment} /></div></div>}
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Road-user samples</summary><ul className="mt-3 space-y-2 text-xs text-muted-foreground">{users.map(track => <li key={`${track.kind}-${track.trackId}`}>{label(track)} · {track.frameIdxs.length} samples{track.trackId === violatorId && ' · violator'}</li>)}</ul></details>
    </div>
  </details>;
}

export default function Page() {
  return <Suspense fallback={<Loading variant="video" label="Loading violation…" />}><ViolationPage /></Suspense>;
}
