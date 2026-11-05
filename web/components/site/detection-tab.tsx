'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, getOrNull, post } from '@/lib/api';
import { runSpan, ts } from '@/lib/format';
import type { Page, Run, Session, Source, ViolationSummary } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';

const violationTypes = ['red_light_running', 'pedestrian_right_of_way'];
const isBusy = (run: Run) => run.status === 'queued' || run.status === 'running';

export function DetectionTab({ siteId }: { siteId: string }) {
  const client = useQueryClient();
  const path = `/sites/${encodeURIComponent(siteId)}`;
  const [types, setTypes] = useState<string[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [watch, setWatch] = useState(true);
  const discoveryUntil = useRef(0);
  const source = useQuery({
    queryKey: ['sources', siteId],
    queryFn: () => getOrNull<Source>(`${path}/sources`),
  });
  const runs = useQuery({
    queryKey: ['runs', siteId, { limit: 20 }],
    queryFn: async () => {
      const page = await get<Page<Run>>(`${path}/runs?limit=20`);
      if (page.items.some(isBusy)) discoveryUntil.current = 0;
      return page;
    },
    refetchInterval: (query) => watch && (
      query.state.data?.items.some(isBusy) || Date.now() < discoveryUntil.current
    ) ? 3000 : false,
  });
  const busy = runs.data?.items.some(isBusy) ?? false;
  const violations = useQuery({
    queryKey: ['violations', siteId, { limit: 1 }],
    queryFn: () => get<Page<ViolationSummary>>(`${path}/violations?limit=1`),
    refetchInterval: () => watch && (busy || Date.now() < discoveryUntil.current) ? 3000 : false,
  });
  const sourceIds = [...new Set(runs.data?.items.flatMap((run) => run.source_id ? [run.source_id] : []) ?? [])];
  const historicalSources = useQueries({
    queries: sourceIds.map((sourceId) => ({
      queryKey: ['sources', siteId, sourceId],
      queryFn: () => getOrNull<Source>(`${path}/sources/${encodeURIComponent(sourceId)}`),
    })),
  });
  const start = useMutation({
    mutationFn: () => post<Session>(`${path}/detect`, types.length ? { types } : {}),
    onSuccess: async (value) => {
      setSession(value);
      setBefore(violations.data?.total ?? null);
      discoveryUntil.current = Date.now() + 120000;
      setWatch(true);
      await client.invalidateQueries({ queryKey: ['runs', siteId] });
      await client.invalidateQueries({ queryKey: ['sources', siteId] });
      await client.invalidateQueries({ queryKey: ['violations', siteId] });
    },
  });
  const stop = useMutation({
    mutationFn: () => post(`${path}/sources/${encodeURIComponent(source.data!.id)}/stop`),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['sources', siteId] });
      await client.invalidateQueries({ queryKey: ['runs', siteId] });
    },
  });
  const active = source.data;
  const metadata = active?.metadata;
  const counts = runs.data?.items.reduce<Record<string, number>>((result, run) => {
    result[run.status] = (result[run.status] ?? 0) + 1;
    return result;
  }, {}) ?? {};

  function refresh() {
    void client.invalidateQueries({ queryKey: ['runs', siteId] });
    void client.invalidateQueries({ queryKey: ['sources', siteId] });
    void client.invalidateQueries({ queryKey: ['violations', siteId] });
  }

  return (
    <div className="space-y-6 pt-4">
      <p>Start detection on the current source and follow its runs.</p>
      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Source</h2>
        {source.isPending && <p role="status">Loading source…</p>}
        {source.isError && <ErrorAlert error={source.error} />}
        {active === null && <p>This site has no source yet. Add a video or a live feed on Site Setup.</p>}
        {active && (
          <>
            <p><StatusBadge value={active.status} prefix="status" /> <StatusBadge value={active.kind} /></p>
            {active.kind === 'video' ? (
              <p>Frames: {metadata?.total_frames?.toLocaleString() || '—'} · FPS: {metadata?.fps?.toFixed(2) || '—'} · Duration: {(metadata?.duration_seconds || 0).toFixed(1)}s</p>
            ) : (
              <>
                <p className="break-all">stream url <code>{active.stream_url}</code></p>
                <p>FPS: {metadata?.fps?.toFixed(2) || '—'}</p>
                <p>A live feed is probed when detection starts, not when it is added: an unreadable feed is refused then, and its frame rate and size are saved.</p>
              </>
            )}
            <p>Source version {active.version}. The calibration and configuration active now are pinned to the session, so attaching new ones later does not change what it judges with.</p>
          </>
        )}
      </section>
      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Start detection</h2>
        <fieldset className="space-y-2">
          <legend>Violation types</legend>
          <p className="text-sm text-muted-foreground">Leave empty to check every type the server has switched on. Asking for a type that is switched off (red light running, until it is validated) is refused.</p>
          {violationTypes.map((type) => (
            <label key={type} className="flex items-center gap-2">
              <input type="checkbox" checked={types.includes(type)} onChange={(event) => setTypes((current) => event.target.checked ? [...current, type] : current.filter((item) => item !== type))} />
              {type.replaceAll('_', ' ')}
            </label>
          ))}
        </fieldset>
        {!types.length && <p>None selected: every switched-on violation type will be checked.</p>}
        <div className="flex gap-3">
          <Button disabled={!active || !(active.kind === 'stream' || metadata?.fps) || start.isPending} onClick={() => start.mutate()}>Start detection</Button>
          {active?.kind === 'stream' && <Button variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}>Stop recording</Button>}
        </div>
        {start.isError && <ErrorAlert error={start.error} />}
        {start.isSuccess && <p role="status">Detection started</p>}
        {stop.isError && (stop.error instanceof ApiError && stop.error.status === 409 ? <p role="status">This feed is not being recorded.</p> : <ErrorAlert error={stop.error} />)}
        {stop.isSuccess && <p role="status">Stopping — the last piece is closed and its windows still run.</p>}
      </section>
      {session && (
        <section className="space-y-3 rounded-lg border p-5">
          <h2 className="text-lg font-semibold">Last session started</h2>
          <p>session id <code>{session.id}</code></p>
          <StatusBadge value={session.status} prefix="status" />
          <p>calibration <code>{session.calibration_id ?? 'none'}</code></p>
          <p>configuration <code>{session.configuration_id ?? 'none'}</code></p>
          <div className="flex flex-wrap gap-2">{session.types.map((type) => <StatusBadge key={type} value={type} />)}</div>
          <p>The status above is as it was when the session started; the runs below are live.</p>
          <details><summary>Technical details</summary><pre className="overflow-auto">{JSON.stringify(session, null, 2)}</pre></details>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Runs</h2>
        <p>One run per window of footage, newest first.</p>
        {runs.isPending && <p role="status">Loading runs…</p>}
        {runs.isError && <ErrorAlert error={runs.error} />}
        <div className="flex flex-wrap gap-2">{Object.entries(counts).map(([status, count]) => <StatusBadge key={status} value={status} label={`${status} ${count}`} />)}</div>
        {historicalSources.map((query, index) => query.isError && <ErrorAlert key={sourceIds[index]} error={query.error} />)}
        {runs.data && (runs.data.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr>{['Created', 'Status', 'Footage', 'Types', 'Finished', 'Error'].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead>
                <tbody>{runs.data.items.map((run) => (
                  <tr key={run.id} className="border-t">
                    <td className="p-2">{ts(run.created_at)}</td>
                    <td className="p-2"><StatusBadge value={run.status} /></td>
                    <td className="p-2">{runSpan(historicalSources[sourceIds.indexOf(run.source_id ?? '')]?.data, run)}</td>
                    <td className="p-2">{run.types.map((type) => type.replaceAll('_', ' ')).join(', ')}</td>
                    <td className="p-2">{ts(run.finished_at)}</td>
                    <td className="p-2">{run.error ?? ''}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {runs.data.total > runs.data.items.length && <p>Showing the latest {runs.data.items.length} of {runs.data.total}.</p>}
          </>
        ) : <p>No runs yet. A session&apos;s runs appear once the ingestion worker cuts the first window.</p>)}
      </section>
      <div className="flex flex-wrap items-center gap-4 border-t pt-4">
        <p>Violations recorded: {violations.data?.total ?? '—'}{before !== null && violations.data && ` (${violations.data.total - before >= 0 ? '+' : ''}${violations.data.total - before})`}</p>
        <Button variant="outline" onClick={refresh}>Refresh</Button>
        <label className="flex items-center gap-2"><input type="checkbox" checked={watch} onChange={(event) => setWatch(event.target.checked)} />Update automatically</label>
        {!!violations.data?.total && <Link className="underline" href={`/sites/${encodeURIComponent(siteId)}/violations`}>Review violations</Link>}
      </div>
      {violations.isError && <ErrorAlert error={violations.error} />}
    </div>
  );
}
