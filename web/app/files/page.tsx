'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { bytesHuman, safeUrl, ts } from '@/lib/format';
import type { FileRow, FileType } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { UploadForm } from '@/components/upload-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const FILE_TYPES: FileType[] = ['calibration', 'configuration', 'video', 'evidence_frame'];

export default function FilesPage() {
  const [recent, setRecent] = useState<FileRow[]>([]);
  const [fileId, setFileId] = useState('');
  const id = fileId.trim();
  const lookup = useQuery({
    queryKey: ['files', id],
    queryFn: () => get<FileRow>(`/files/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
    retry: false,
  });
  const file = lookup.data;
  const downloadUrl = safeUrl(file?.download_url);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">Setup</p>
        <h1 className="text-2xl font-semibold">Files</h1>
        <p className="text-muted-foreground">Upload files without attaching them, or look one up by id.</p>
      </header>
      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="lookup">Find by ID</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="space-y-6 pt-4">
          <UploadForm types={FILE_TYPES} onUploaded={(row) => {
            setRecent((rows) => [row, ...rows].slice(0, 12));
          }} />
          {recent.length > 0 && (
            <section className="space-y-3 border-t pt-6">
              <h2 className="text-lg font-semibold">Uploaded in this session</h2>
              <p className="text-sm text-muted-foreground">Only files uploaded since this page was opened are listed here.</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Any file</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>status</TableHead>
                    <TableHead>size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((row, index) => (
                    <TableRow key={`${row.id}-${index}`}>
                      <TableCell><p className="font-semibold">{row.name}</p><code className="text-xs text-muted-foreground">{row.id}</code></TableCell>
                      <TableCell><StatusBadge value={row.type} /></TableCell>
                      <TableCell><StatusBadge value={row.status} /></TableCell>
                      <TableCell>{bytesHuman(row.size_bytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </TabsContent>
        <TabsContent value="lookup" className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="file-id">File id</Label>
            <Input id="file-id" placeholder="f80b2b35-2cf9-477c-8b49-45c576752f11" value={fileId} onChange={(event) => setFileId(event.target.value)} />
          </div>
          {id && lookup.isError && <ErrorAlert error={lookup.error} />}
          {id && file && (
            <section className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-4">
                <h2 className="font-semibold">{file.name}</h2>
                <StatusBadge value={file.type} prefix="type" />
                <StatusBadge value={file.status} prefix="status" />
                <span className="text-sm text-muted-foreground">{bytesHuman(file.size_bytes)}</span>
              </div>
              <p className="text-sm text-muted-foreground">key <code>{file.url}</code> · created {ts(file.created_at)}</p>
              <p className="text-sm text-muted-foreground"><code>url</code> is where the file is stored, not a web link. Use the button below to download it.</p>
              {downloadUrl && (
                <>
                  <Button render={<a href={downloadUrl} />}>Download file</Button>
                  {file.type === 'video' && <video className="max-h-[70vh] w-full" src={downloadUrl} controls />}
                </>
              )}
              <details>
                <summary className="cursor-pointer">JSON</summary>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{JSON.stringify(file, null, 2)}</pre>
              </details>
            </section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
