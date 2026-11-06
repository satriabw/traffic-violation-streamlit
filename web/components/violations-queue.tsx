'use client';

import { Loading } from '@/components/loading';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { get, getOrNull } from '@/lib/api';
import { eventTime, runSpan, safeUrl } from '@/lib/format';
import { reviewLabel } from '@/lib/status';
import type { Page, Run, Source, ViolationSummary } from '@/lib/types';
import { Empty, ErrorAlert } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PER_PAGE = 12;

function Thumbnail({ item }: { item: ViolationSummary }) {
  const url = safeUrl(item.thumbnail_url);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Empty message="Image unavailable" />;
  }
  if (!url) {
    return <Empty message="No thumbnail" hint={item.evidence_status === 'pending' ? 'still being prepared' : 'no image'} />;
  }
  // Presigned thumbnails can use external hosts and must retain their exact URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="Violation thumbnail" className="aspect-video w-full rounded object-contain" onError={() => setFailed(true)} />;
}

export function ViolationsQueue({ siteId, runId, showHeader = true }: { siteId: string; runId: string | null; showHeader?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [offset, setOffset] = useState(0);
  const path = `/sites/${encodeURIComponent(siteId)}`;
  const runs = useQuery({
    queryKey: ['runs', siteId, { limit: 20 }],
    queryFn: () => get<Page<Run>>(`${path}/runs?limit=20`),
  });
  const params = new URLSearchParams({ limit: String(PER_PAGE), offset: String(offset) });
  if (runId) {
    params.set('run_id', runId);
  }
  const violations = useQuery({
    queryKey: ['violations', siteId, { runId, offset, limit: PER_PAGE }],
    queryFn: () => get<Page<ViolationSummary>>(`${path}/violations?${params}`),
  });
  const sourceIds = [...new Set([
    ...(runs.data?.items ?? []),
    ...(violations.data?.items ?? []),
  ].flatMap(item => item.source_id ? [item.source_id] : []))];
  const sources = useQueries({
    queries: sourceIds.map(sourceId => ({
      queryKey: ['sources', siteId, sourceId],
      queryFn: () => getOrNull<Source>(`${path}/sources/${encodeURIComponent(sourceId)}`),
    })),
  });
  const sourceOf = (id?: string | null) => sources[sourceIds.indexOf(id ?? '')]?.data;
  const counts = violations.data?.items.reduce<Record<string, number>>((result, item) => {
    result[item.explanation_status] = (result[item.explanation_status] ?? 0) + 1;
    return result;
  }, {}) ?? {};
  const selectedRun = runs.data?.items.find(run => run.id === runId);
  const runLabel = (run: Run) => `${runSpan(sourceOf(run.source_id), run)} · ${run.status}`;

  function changeRun(value: string | null) {
    const next = new URLSearchParams(search);
    if (value) {
      next.set('run', value);
    } else {
      next.delete('run');
    }
    const query = next.toString();
    router.push(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      {showHeader && <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Violations</h1>
        <p className="text-sm text-muted-foreground">Current violations for this site. Runs judged under a document later marked invalid are left out.</p>
      </header>}
      <div className="space-y-2">
        <label id="run-label" className="text-sm font-medium">Run</label>
        <Select value={runId ?? ''} onValueChange={changeRun}>
          <SelectTrigger aria-labelledby="run-label" className="w-full sm:max-w-xl">
            <SelectValue>{selectedRun ? runLabel(selectedRun) : runId ? `Run ${runId}` : 'All runs'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All runs</SelectItem>
            {runId && !selectedRun && <SelectItem value={runId}>Run {runId}</SelectItem>}
            {runs.data?.items.map(run => <SelectItem key={run.id} value={run.id}>{runLabel(run)}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">One run per window of footage, newest first.</p>
        {runs.data && runs.data.total > runs.data.items.length && <p className="text-xs text-muted-foreground">Showing the latest {runs.data.items.length} of {runs.data.total} runs.</p>}
      </div>
      {runs.isPending && <Loading label="Loading runs…" />}
      {runs.isError && <ErrorAlert error={runs.error} />}
      {sources.map((source, index) => source.isError && <ErrorAlert key={sourceIds[index]} error={source.error} />)}
      {violations.isPending && <Loading variant="cards" label="Loading violations…" />}
      {violations.isError && <ErrorAlert error={violations.error} />}
      {violations.data && (violations.data.items.length ? (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Review counts on this page">
            {Object.entries(counts).map(([status, count]) => <StatusBadge key={status} value={status} label={`${reviewLabel(status)} ${count}`} />)}
          </div>
          <p className="text-sm text-muted-foreground">Showing {violations.data.offset + 1}–{violations.data.offset + violations.data.items.length} of {violations.data.total}</p>
          <div className="grid gap-4 md:grid-cols-3">
            {violations.data.items.map(item => (
              <article key={item.id} className="flex flex-col gap-3 rounded-xl border bg-background p-4 transition-shadow hover:shadow-sm">
                <Thumbnail key={`${item.id}:${item.thumbnail_url}`} item={item} />
                <h2 className="text-sm font-medium">{item.type.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase())}</h2>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge value={item.explanation_status} label={reviewLabel(item.explanation_status)} />
                  <StatusBadge value={item.evidence_status} />
                </div>
                <p className="text-sm text-muted-foreground">{eventTime(sourceOf(item.source_id), item.frame_index, item.detected_at)}</p>
                <Button variant="outline" className="mt-auto w-full justify-between" render={<Link href={`${path}/violations/${encodeURIComponent(item.id)}`} />}>Review violation<ArrowUpRight className="size-4" /></Button>
              </article>
            ))}
          </div>
        </>
      ) : (
        <Empty message={runId ? 'No violations recorded for this run.' : 'No violations recorded for this site.'} hint="Start a run on the Detection page." />
      ))}
      {violations.data && (violations.data.items.length > 0 || offset > 0) && (
        <div className="flex justify-between gap-4">
          <Button variant="outline" disabled={violations.data.offset === 0} onClick={() => setOffset(Math.max(0, violations.data.offset - PER_PAGE))}>Previous</Button>
          <Button variant="outline" disabled={violations.data.offset + violations.data.items.length >= violations.data.total} onClick={() => setOffset(violations.data.offset + PER_PAGE)}>Next</Button>
        </div>
      )}
    </div>
  );
}

