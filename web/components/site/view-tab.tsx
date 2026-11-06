'use client';

import { Loading } from '@/components/loading';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, getOrNull } from '@/lib/api';
import { safeUrl } from '@/lib/format';
import { drawnSize, LAYERS, type Layer, type SceneDocument } from '@/lib/regions';
import type { Doc, FileRow, Source } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { RegionsOverlay } from '@/components/regions-overlay';
import { StatusBadge } from '@/components/status-badge';
import { VideoPlayer } from '@/components/video-player';
import { Switch } from '@/components/ui/switch';

const names = { lanes: 'Lanes', rois: 'ROIs', traffic_lights: 'Traffic lights' };
export function ViewTab({ siteId }: { siteId: string }) {
  const path = `/sites/${encodeURIComponent(siteId)}`;
  const source = useQuery({ queryKey: ['sources', siteId], queryFn: () => getOrNull<Source>(`${path}/sources`) });
  const configuration = useQuery({ queryKey: ['configurations', siteId], queryFn: () => getOrNull<Doc>(`${path}/configurations`) });
  const document = useQuery({
    queryKey: ['scene-document', configuration.data?.id],
    enabled: !!configuration.data,
    queryFn: async () => {
      const row = await get<FileRow>(`/files/${encodeURIComponent(configuration.data!.file_id)}`);
      const url = safeUrl(row.download_url);
      if (!url) throw new Error('The configuration could not be found in storage.');
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not read the scene configuration.');
      return await response.json() as SceneDocument;
    },
    staleTime: Infinity,
  });
  return <div className="space-y-4 pt-4">
    {source.isPending && <Loading variant="video" label="Loading source…" />}
    {source.isError && <ErrorAlert error={source.error} />}
    {configuration.isError && <ErrorAlert error={configuration.error} />}
    {document.isError && <ErrorAlert error={document.error} />}
    {source.data === null && <p>This site has no source yet. Add a video or a live feed on Site Setup.</p>}
    {source.data && <Player key={source.data.id} siteId={siteId} source={source.data} document={document.data} version={configuration.data?.version} />}
  </div>;
}

function Player({ siteId, source, document, version }: { siteId: string; source: Source; document?: SceneDocument; version?: number }) {
  const [watching, setWatching] = useState(false);
  const [show, setShow] = useState(true);
  const [labels, setLabels] = useState(true);
  const [layers, setLayers] = useState<Layer[]>([...LAYERS]);
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const [failed, setFailed] = useState(false);
  const file = useQuery({
    queryKey: ['files', source.file_id],
    queryFn: () => get<FileRow>(`/files/${encodeURIComponent(source.file_id!)}`),
    enabled: source.kind === 'video' && !!source.file_id,
    staleTime: 10 * 60 * 1000,
  });
  const size = drawnSize(document, source) ?? natural;
  const clip = safeUrl(file.data?.download_url);
  return <div className="space-y-4">
    <p><StatusBadge value={source.status} prefix="source" /> {source.kind} · version v{source.version}</p>
    <details className="text-sm"><summary className="cursor-pointer font-medium">Scene layers</summary><div className="mt-3 flex flex-wrap gap-4">
      <label className="flex items-center gap-2"><Switch checked={show} onCheckedChange={setShow} disabled={!document} />Configuration</label>
      {LAYERS.map(layer => <label key={layer} className="flex items-center gap-2"><Switch disabled={!show || !document} checked={layers.includes(layer)} onCheckedChange={on => setLayers(old => on ? [...old, layer] : old.filter(item => item !== layer))} />{names[layer]}</label>)}
      <label className="flex items-center gap-2"><Switch checked={labels} onCheckedChange={setLabels} disabled={!show || !document} />Region names</label>
    </div></details>
    {file.isError && <ErrorAlert error={file.error} />}
    {source.kind === 'stream' && <label className="flex items-center gap-2"><Switch checked={watching} onCheckedChange={on => { setFailed(false); setWatching(on); }} />Watch live</label>}
    {source.kind === 'video' && file.isPending && source.file_id && <Loading variant="video" label="Loading video…" />}
    {source.kind === 'video' && !file.isPending && !clip && <p>The video could not be found in storage.</p>}
    {(source.kind === 'video' && clip || source.kind === 'stream' && watching) && <div className="relative mx-auto max-w-5xl">
      {source.kind === 'video'
        ? <VideoPlayer key={clip} src={clip!} poster={`/poster?${new URLSearchParams({ site: siteId, source: source.id })}`} label="Site video" muted onSize={setNatural} onError={() => setFailed(true)} />
        : <LiveImage siteId={siteId} onSize={setNatural} onError={() => setFailed(true)} />}
      {size && show && <RegionsOverlay document={document} size={size} layers={layers} labels={labels} />}
    </div>}
    {failed && <p role="alert">The source could not be played. For a live feed, check that ffmpeg is installed and the camera is reachable, then switch Watch live off and on.</p>}
    {source.kind === 'stream' ? <><p className="text-sm text-muted-foreground">{watching ? 'Live · 2 frames per second' : 'Switch on Watch live to start the feed.'}</p></>
      : <p className="text-sm text-muted-foreground">The regions are drawn over the player; the video itself is the source as uploaded.</p>}
    <details><summary className="cursor-pointer">Technical details</summary><pre className="overflow-auto rounded bg-muted p-4 text-xs">{JSON.stringify({ source, configuration: document, configurationVersion: version }, null, 2)}</pre></details>
  </div>;
}

function LiveImage({ siteId, onSize, onError }: {
  siteId: string; onSize: (size: [number, number]) => void; onError: () => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = image.current;
    // Removing a streaming img from the DOM alone can leave its HTTP request alive.
    return () => { if (element) element.src = ''; };
  }, []);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} src={`/feed?site=${encodeURIComponent(siteId)}`} alt="Live camera feed" className="block h-auto w-full"
    onLoad={event => onSize([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])} onError={onError} />;
}
