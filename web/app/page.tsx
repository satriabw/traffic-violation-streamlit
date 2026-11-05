'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { allSites, get } from '@/lib/api';
import { summarise } from '@/lib/overview';
import { runSpan, ts } from '@/lib/format';
import type { Page, Run, Site, Source, ViolationSummary } from '@/lib/types';
import { Empty, ErrorAlert } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SERIES = ['#2a78d6'];
const chartConfig = { count: { label: 'Violations', color: SERIES[0] } };

async function loadOverview() {
  const sites = await allSites();
  const violations: ViolationSummary[] = [];
  const runs: Run[] = [];
  for (const site of sites) {
    const sitePath = `/sites/${encodeURIComponent(site.id)}`;
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await get<Page<ViolationSummary>>(`${sitePath}/violations?limit=100&offset=${offset}`);
      violations.push(...page.items.slice(0, 500 - offset));
      if (!page.items.length || offset + 100 >= page.total) break;
    }
    runs.push(...(await get<Page<Run>>(`${sitePath}/runs?limit=20`)).items);
  }
  return { sites, violations, runs, at: new Date().toISOString() };
}

function RunRow({ run, site }: { run: Run; site?: Site }) {
  const sourceId = run.source_id;
  const source = useQuery({
    queryKey: ['source', run.site_id, sourceId],
    queryFn: () => get<Source>(`/sites/${encodeURIComponent(run.site_id)}/sources/${encodeURIComponent(sourceId!)}`),
    enabled: Boolean(sourceId && site?.source?.id !== sourceId),
    retry: false,
  });
  const runSource = site?.source?.id === sourceId ? site?.source : source.data;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{ts(run.created_at)}</TableCell>
      <TableCell>{site?.name ?? run.site_id}</TableCell>
      <TableCell><StatusBadge value={run.status} /></TableCell>
      <TableCell>
        {runSpan(runSource, run)}
        {source.isError && <ErrorAlert error={source.error} />}
      </TableCell>
      <TableCell>{run.types.map(type => type.replaceAll('_', ' ')).join(', ')}</TableCell>
      <TableCell>{run.error || ''}</TableCell>
    </TableRow>
  );
}

export default function OverviewPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['overview'], queryFn: loadOverview, staleTime: 30000, retry: false,
  });
  const data = query.data;
  const summary = data ? summarise(data.sites, data.violations, data.runs) : null;
  const tiles = summary?.tiles;
  const figures = tiles ? [
    { label: 'Sites', value: tiles.sites, help: `${tiles.streams} with a live feed` },
    { label: 'Violations', value: tiles.violations },
    { label: 'Awaiting review', value: tiles.awaiting, help: 'Detected, not yet sent for the evidence review' },
    { label: 'Reviewed', value: tiles.reviewed, help: `${tiles.pending} in progress, ${tiles.failed} failed` },
    { label: 'Runs in progress', value: tiles.busy, help: `Among each site's 20 latest runs; ${tiles.failedRuns} failed` },
  ] : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Monitoring</p>
          <h1 className="text-2xl font-semibold">Overview</h1>
          {data && <p className="text-muted-foreground">All sites · updated {ts(data.at).split(', ')[1]}</p>}
        </div>
        <Button variant="outline" disabled={query.isFetching}
          onClick={() => client.invalidateQueries({ queryKey: ['overview'] })}>Refresh</Button>
      </header>
      {query.isPending && <p role="status">Loading sites…</p>}
      {query.isError && <ErrorAlert error={query.error} />}
      {data && !data.sites.length && (
        <Empty message="No sites yet." hint="Create one under Setup > Sites, then give it a source on Site setup." />
      )}
      {data && summary && data.sites.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {figures.map(figure => (
              <div key={figure.label} className="space-y-2 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">{figure.label}</p>
                <p className="text-3xl font-semibold tabular-nums">{figure.value.toLocaleString()}</p>
                {figure.help && <p className="text-xs text-muted-foreground">{figure.help}</p>}
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <section className="min-w-0 space-y-4 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">Violations detected per day</h2>
              {!summary.perDay.length ? <Empty message="No violations yet." /> : (
                <ChartContainer config={chartConfig} className="h-[260px] w-full">
                  <BarChart accessibilityLayer data={summary.perDay}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false}
                      tickFormatter={day => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ChartContainer>
              )}
            </section>
            <section className="min-w-0 space-y-4 rounded-lg border p-4">
              <h2 className="text-lg font-semibold">Violations by site</h2>
              <ChartContainer config={chartConfig} className="h-[260px] w-full">
                <BarChart accessibilityLayer layout="vertical" data={[...summary.bySite].sort((a, b) => b.count - a.count)}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis dataKey="site" type="category" width={120} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ChartContainer>
            </section>
          </div>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Sites</h2>
            <p className="text-sm text-muted-foreground">Select a row to review that site&apos;s violations.</p>
            <Table>
              <TableHeader><TableRow>
                {['Site', 'Source', 'Source status', 'Violations', 'Awaiting review', 'Reviewed', 'Last detected', 'Created'].map(label => <TableHead key={label}>{label}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {data.sites.map(site => {
                  const mine = data.violations.filter(item => item.site_id === site.id);
                  const latest = mine.map(item => item.detected_at).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
                  return (
                    <TableRow key={site.id}>
                      <TableCell><Link className="font-semibold underline underline-offset-4" href={`/sites/${encodeURIComponent(site.id)}?tab=view`}>{site.name}</Link></TableCell>
                      <TableCell>{site.source ? site.source.kind === 'stream' ? 'Live feed' : 'Video' : 'None'}</TableCell>
                      <TableCell>{site.source?.status ? <StatusBadge value={site.source.status} /> : '—'}</TableCell>
                      <TableCell>{mine.length}</TableCell>
                      <TableCell>{mine.filter(item => item.explanation_status === 'detected').length}</TableCell>
                      <TableCell>{mine.filter(item => item.explanation_status === 'explained').length}</TableCell>
                      <TableCell className="whitespace-nowrap">{ts(latest, false)}</TableCell>
                      <TableCell className="whitespace-nowrap">{ts(site.created_at, false).split(', ')[0]}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Recent detection runs</h2>
            {!data.runs.length ? <Empty message="No detection runs yet." hint="Start one under Operations > Detection." /> : (
              <Table>
                <TableHeader><TableRow>
                  {['Started', 'Site', 'Status', 'Footage', 'Types', 'Error'].map(label => <TableHead key={label}>{label}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {[...data.runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 12).map(run => (
                    <RunRow key={run.id} run={run} site={data.sites.find(site => site.id === run.site_id)} />
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
