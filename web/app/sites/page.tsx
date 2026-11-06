'use client';

import { Loading } from '@/components/loading';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { ts } from '@/lib/format';
import type { FileRow, Page, Site, Source } from '@/lib/types';
import { Empty, ErrorAlert } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { CreateSiteDialog } from '@/components/create-site-dialog';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function SourceSummary({ source }: { source?: Source | null }) {
  const fileId = source?.kind === 'video' ? source.file_id : null;
  const file = useQuery({
    queryKey: ['files', fileId],
    queryFn: () => get<FileRow>(`/files/${encodeURIComponent(fileId!)}`),
    enabled: Boolean(fileId),
    retry: false,
  });

  if (!source) return <span className="text-muted-foreground">No source attached</span>;

  const label = source.kind === 'stream'
    ? `Live feed · ${source.stream_url || '—'}`
    : `Video · ${file.data?.name || source.file_id || '—'}`;

  return (
    <div className="space-y-1">
      <StatusBadge value={source.status} prefix="source" />
      <p className="max-w-md break-all text-sm">{label} · v{source.version}</p>
      {file.isError && <ErrorAlert error={file.error} />}
    </div>
  );
}

export default function SitesPage() {
  const [kind, setKind] = useState('');
  const [offset, setOffset] = useState(0);
  const sites = useQuery({
    queryKey: ['sites', { kind, offset }],
    queryFn: () => get<Page<Site>>(`/sites?limit=20&offset=${offset}${kind ? `&kind=${kind}` : ''}`),
    retry: false,
  });
  const page = sites.data;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Setup</p>
        <h1 className="text-2xl font-semibold">Sites</h1>
        <p className="text-muted-foreground">Fixed camera locations and the source each one reads from.</p>
      </header>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Label htmlFor="source-kind">Source</Label>
          <Select value={kind} onValueChange={value => { setKind(value ?? ''); setOffset(0); }}>
            <SelectTrigger id="source-kind" className="w-48" aria-describedby="source-kind-help"><SelectValue>{kind === 'video' ? 'Video' : kind === 'stream' ? 'Live feed' : 'All sources'}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="">All sources</SelectItem><SelectItem value="video">Video</SelectItem><SelectItem value="stream">Live feed</SelectItem></SelectContent>
          </Select>
          <p id="source-kind-help" className="text-sm text-muted-foreground">Filters on the source each site uses now.</p>
        </div>
        <CreateSiteDialog onCreated={() => setOffset(0)} />
      </div>
      {sites.isPending && <Loading variant="table" label="Loading sites…" />}
      {sites.isError && <ErrorAlert error={sites.error} />}
      {page && (
        <>
          {page.items.length === 0 ? (
            <Empty message="No sites match." hint="Clear the filter, or create one above." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((site) => {
                  const path = `/sites/${encodeURIComponent(site.id)}`;
                  return (
                    <TableRow key={site.id}>
                      <TableCell>
                        <Link className="font-medium transition-colors hover:text-primary hover:underline hover:underline-offset-4" href={`${path}?tab=view`}>{site.name}</Link>

                      </TableCell>
                      <TableCell><SourceSummary source={site.source} /></TableCell>
                      <TableCell className="whitespace-nowrap">{ts(site.created_at, false)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button size="sm" variant="outline" render={<Link href={`${path}?tab=view`} />}>View</Button>
                          <Button size="sm" variant="outline" render={<Link href={`${path}?tab=setup`} />}>Set up</Button>
                          <DeleteSiteDialog site={site} onDeleted={() => setOffset(0)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {page.items.length ? `${page.offset + 1}–${page.offset + page.items.length}` : '0'} of {page.total}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={offset === 0 || sites.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</Button>
              <Button variant="outline" disabled={page.offset + page.items.length >= page.total || !page.items.length || sites.isFetching}
                onClick={() => setOffset(offset + 20)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
