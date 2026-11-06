'use client';

import { Loading } from '@/components/loading';
import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, getOrNull, post } from '@/lib/api';
import { bytesHuman, safeUrl, ts } from '@/lib/format';
import type { Doc, FileRow } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { UploadForm } from '@/components/upload-form';
import { ChevronDown, Download, FileCheck2, Focus, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function DocumentCard({ siteId, resource, title, blurb, children, expanded = false }: {
  expanded?: boolean;
  children?: ReactNode;
  siteId: string;
  resource: 'calibrations' | 'configurations';
  title: string;
  blurb: string;
}) {
  const id = useId();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const path = `/sites/${encodeURIComponent(siteId)}/${resource}`;
  const active = useQuery({ queryKey: [resource, siteId], queryFn: () => getOrNull<Doc>(path) });
  const fileId = active.data?.file_id;
  const file = useQuery({
    queryKey: ['files', fileId],
    queryFn: () => get<FileRow>(`/files/${encodeURIComponent(fileId!)}`),
    enabled: !!fileId,
  });
  const attach = useMutation({
    mutationFn: (row: FileRow) => post<Doc>(path, { file_id: row.id }),
    onSuccess: () => client.invalidateQueries({ queryKey: [resource, siteId] }),
  });
  const invalidate = useMutation({
    mutationFn: () => post<{ invalidated: number }>(`${path}/${encodeURIComponent(active.data!.id)}/invalidate`, { reason: reason.trim() }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['runs', siteId] });
      await client.invalidateQueries({ queryKey: ['violations', siteId] });
    },
  });
  const download = safeUrl(file.data?.download_url);

  const Icon = resource === 'calibrations' ? Focus : SlidersHorizontal;
  return <details open={expanded || undefined} className="group rounded-xl border bg-background">
    <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-3 [&::-webkit-details-marker]:hidden">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-[18px] text-muted-foreground" /></div>
      <div className="min-w-0 flex-1"><h2 className="text-sm font-medium">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{active.data ? `${file.data?.name || 'Document attached'} · v${active.data.version}` : 'Optional · not attached'}</p></div>
      {active.data && <Badge variant="secondary" className="hidden sm:inline-flex"><FileCheck2 className="size-3" />Attached</Badge>}
      <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-5 border-t px-5 py-5 sm:px-6">
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{blurb}</p>
      {active.isPending && <Loading variant="panel" label="Loading active version…" />}
      {active.isError && <ErrorAlert error={active.error} />}
      {active.data && <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"><div><p className="font-medium">{file.data?.name || `Version ${active.data.version}`}</p><p className="mt-1 text-xs text-muted-foreground">v{active.data.version} · {ts(active.data.created_at, false)}{file.data && ` · ${bytesHuman(file.data.size_bytes)}`}</p></div>{download && <Button size="sm" variant="outline" render={<a href={download} download />}><Download className="size-3.5" />Download</Button>}</div>
        {file.isError && <ErrorAlert error={file.error} />}
      </div>}
      <UploadForm compact types={[resource === 'calibrations' ? 'calibration' : 'configuration']} accept={resource === 'calibrations' ? '.yml,.yaml,.xml,.json' : '.json'} onUploaded={row => attach.mutate(row)} />
      {attach.isPending && <Loading label="Attaching to the site…" />}
      {attach.isError && <ErrorAlert error={attach.error} />}
      {attach.isSuccess && <p role="status" className="text-sm">Document attached.</p>}
      {children}
      {active.data && <details className="border-t pt-4 text-sm"><summary className="cursor-pointer text-muted-foreground">Version details and run management</summary><div className="mt-4 space-y-3">
        <p className="break-all text-xs text-muted-foreground">File {active.data.file_id} · Document {active.data.id}</p>
        <p className="leading-relaxed text-muted-foreground">If this version is wrong, invalidate its runs to remove them and their violations from the queue. Upload a corrected document before running detection again.</p>
        <Label htmlFor={id}>Reason for invalidating runs</Label><Input id={id} value={reason} onChange={event => setReason(event.target.value)} />
        <Button variant="outline" disabled={!reason.trim() || invalidate.isPending} onClick={() => invalidate.mutate()}>Invalidate its runs</Button>
        {invalidate.isError && <ErrorAlert error={invalidate.error} />}{invalidate.data && <p role="status">{invalidate.data.invalidated} runs marked invalid</p>}
      </div></details>}
    </div>
  </details>;
}
