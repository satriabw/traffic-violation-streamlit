'use client';

import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, getOrNull, post } from '@/lib/api';
import { bytesHuman, safeUrl, ts } from '@/lib/format';
import type { Doc, FileRow } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { UploadForm } from '@/components/upload-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function DocumentCard({ siteId, resource, title, blurb }: {
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

  return (
    <section className="space-y-4 rounded-lg border p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{blurb}</p>
      {active.isPending && <p role="status">Loading active version…</p>}
      {active.isError && <ErrorAlert error={active.error} />}
      {active.data && (
        <div className="space-y-2">
          <p>Active version <strong>v{active.data.version}</strong> · attached {ts(active.data.created_at, false)}</p>
          <p className="text-sm break-all">file <code>{active.data.file_id}</code> · doc <code>{active.data.id}</code></p>
          {file.data && <p>{file.data.name} · {bytesHuman(file.data.size_bytes)}</p>}
          {download && <a className="underline" href={download} download>Download {file.data?.name}</a>}
          {file.isError && <ErrorAlert error={file.error} />}
          <details className="space-y-3">
            <summary className="cursor-pointer">Invalidate this version&apos;s runs</summary>
            <p>Found v{active.data.version} wrong? Marks every run judged under this version invalid: they leave the run list and their violations leave the review queue. The version itself stays — upload a corrected one and run detection again.</p>
            <Label htmlFor={id}>Reason</Label>
            <Input id={id} value={reason} onChange={(event) => setReason(event.target.value)} />
            <Button disabled={!reason.trim() || invalidate.isPending} onClick={() => invalidate.mutate()}>Invalidate its runs</Button>
            {invalidate.isError && <ErrorAlert error={invalidate.error} />}
            {invalidate.data && <p role="status">{invalidate.data.invalidated} runs marked invalid</p>}
          </details>
        </div>
      )}
      {active.data === null && <p>No {resource.slice(0, -1)} attached yet.</p>}
      <p>Upload a new {resource.slice(0, -1)} · attach as v{(active.data?.version ?? 0) + 1}</p>
      <UploadForm types={[resource === 'calibrations' ? 'calibration' : 'configuration']} accept={resource === 'calibrations' ? '.yml,.yaml,.xml,.json' : '.json'} onUploaded={(row) => attach.mutate(row)} />
      {attach.isPending && <p role="status">Attaching it to the site…</p>}
      {attach.isError && <ErrorAlert error={attach.error} />}
      {attach.isSuccess && <p role="status">Done.</p>}
    </section>
  );
}
