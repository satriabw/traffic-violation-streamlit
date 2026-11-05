'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { get, getOrNull } from '@/lib/api';
import { eventTime, frameTime, safeUrl, ts } from '@/lib/format';
import { reviewLabel } from '@/lib/status';
import { cameraView, colourMap, groundZones, implausible, involved, label, tracksOf } from '@/lib/evidence';
import type { Doc, FileRow, Source, Violation } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { BoxesOverlay } from '@/components/evidence/boxes-overlay';
import { TrackPicker } from '@/components/evidence/track-picker';
import { GroundPlot } from '@/components/evidence/ground-plot';
import { SpeedChart } from '@/components/evidence/speed-chart';
import { Alert, AlertDescription } from '@/components/ui/alert';

type Configuration = NonNullable<Parameters<typeof involved>[2]> & {
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
      <Link href={`/sites/${encodeURIComponent(siteId)}/violations`} className="text-sm underline">Back to the list</Link>
      {violation.isPending && <p role="status">Loading violation…</p>}
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
          <p className="break-all text-sm text-muted-foreground">{row.id} · {frameTime(row.frame_index, source.data?.metadata?.fps)} · processed {ts(row.detected_at)}</p>
          <p className="break-all text-sm text-muted-foreground">{row.source_name || 'source'}{row.source_version != null && ` v${row.source_version}`} · {row.calibration_version != null ? `calibration v${row.calibration_version}` : 'no calibration'} · {row.configuration_version != null ? `configuration v${row.configuration_version}` : 'no configuration'} · run {row.run_id}</p>
        </header>
        {row.evidence_status == null && <Alert><AlertDescription>No evidence clip exists for this violation — it was recorded before evidence clips were introduced, so none will be created.</AlertDescription></Alert>}
        {source.isError && <ErrorAlert error={source.error} />}
        {configuration.isError && <ErrorAlert error={configuration.error} />}
        {(row.source_id && source.isPending) || (row.configuration_id && configuration.isPending)
          ? <p role="status">Loading the source and configuration used for this violation…</p>
          : <Evidence key={`${siteId}-${violationId}-${configuration.isSuccess}`} violation={row} source={source.data} configuration={configuration.data} />}
      </>}
    </div>
  );
}

function Evidence({ violation, source, configuration }: {
  violation: Violation;
  source?: Source | null;
  configuration?: Configuration;
}) {
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
  const users = involved(tracks, violatorId, configuration, frame, fps);
  const [selected, setSelected] = useState(() => users.slice(0, 3).map(track => track.trackId));
  const colours = colourMap(selected);
  const fastest = implausible(tracks, colours);
  const clip = safeUrl(violation.clip_url);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <section className="min-w-0 space-y-4">
          <h2 className="text-xl font-semibold">Evidence</h2>
          {users.length > 0 && <TrackPicker tracks={users} selected={selected} onChange={setSelected} />}
          {violation.thumbnail_url
            ? <BoxesOverlay src={violation.thumbnail_url} tracks={tracks} frame={frame} sourceSize={sourceSize} colours={colours} violatorId={violatorId} />
            : <p>{violation.evidence_status === 'pending' ? 'The image is still being prepared.' : violation.evidence_status === 'failed' ? 'The evidence clip could not be created for this violation.' : 'No evidence image is available.'}</p>}
          {clip && <div className="space-y-2"><h3 className="font-medium">Clip</h3><video src={clip} controls preload="metadata" className="w-full" /><p className="text-sm text-muted-foreground">The clip covers the same time span as the violation record.</p></div>}
        </section>
        <aside aria-label="Evidence review" className="min-w-0" />
      </div>
      {tracks.length > 0 && colours.size > 0 && <section className="space-y-4 border-t pt-6">
        <h2 className="text-xl font-semibold">Paths of the involved road users</h2>
        <p className="text-sm text-muted-foreground">Paths are shown on a top-down map in metres rather than over the video image, because camera perspective distorts distance: the same on-screen gap can be a few metres near the camera and tens of metres far away. <strong>Positions and speeds are estimates</strong> based on the camera calibration.</p>
        {fastest != null && <Alert><AlertDescription>The fastest vehicle here is estimated at {fastest.toFixed(0)} m/s — about {(fastest * 3.6).toFixed(0)} km/h, which is not realistic. This usually means the camera calibration is inaccurate, which makes all speeds and positions on this page unreliable. The detection itself and its timing are not affected.</AlertDescription></Alert>}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-3"><h3 className="font-medium">Top-down view of the road (metres, estimated)</h3><GroundPlot tracks={tracks} colours={colours} fps={fps} violationT={moment} zones={groundZones(violation.metadata, configuration)} view={cameraView(violation.metadata, picture)} /></div>
          <div className="min-w-0 space-y-3"><h3 className="font-medium">Estimated speed, last 10 seconds (m/s)</h3><SpeedChart tracks={tracks} colours={colours} fps={fps} violationT={moment} /></div>
        </div>
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">Road users involved in this violation</summary>
          <ul className="mt-3 space-y-2">{users.map(track => <li key={`${track.kind}-${track.trackId}`}>{label(track)} — {track.frameIdxs.length ? `${track.frameIdxs.length} samples, frames ${track.frameIdxs[0]}–${track.frameIdxs[track.frameIdxs.length - 1]}` : 'no samples'}{track.trackId === violatorId && ' · violator'}</li>)}</ul>
          {violatorId == null && <p className="mt-3 text-sm text-muted-foreground">This record does not mark which vehicle committed the violation — it was recorded before that information was stored.</p>}
        </details>
      </section>}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<p role="status">Loading violation…</p>}><ViolationPage /></Suspense>;
}
