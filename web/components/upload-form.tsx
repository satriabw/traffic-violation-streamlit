'use client';

import { Loading } from '@/components/loading';
import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { upload } from '@/lib/api';
import { bytesHuman } from '@/lib/format';
import type { FileRow, FileType } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function UploadForm({ types, accept, onUploaded, compact = false }: {
  compact?: boolean;
  types: FileType[];
  accept?: string;
  onUploaded: (file: FileRow) => void;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [selectedType, setSelectedType] = useState<FileType | null>(null);
  const type = selectedType && types.includes(selectedType) ? selectedType : types[0];
  const mutation = useMutation({
    mutationFn: ({ file, type }: { file: File; type: FileType }) => upload(file, type),
    onSuccess: (row) => {
      toast.success(compact ? 'File uploaded' : `File id \`${row.id}\` — status \`${row.status}\``);
      onUploaded(row);
    },
  });

  return (
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault();
      if (file && type && !mutation.isPending) {
        mutation.mutate({ file, type });
      }
    }}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-file`}>{types.length === 1 ? (types[0] === 'video' ? 'Video file' : `${types[0][0].toUpperCase()}${types[0].slice(1)} file`) : 'File'}</Label>
        <Input
          id={`${id}-file`}
          type="file"
          accept={accept}
          disabled={mutation.isPending}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            mutation.reset();
          }}
        />
      </div>
      {types.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-type`}>Type</Label>
          <Select value={type} disabled={mutation.isPending} onValueChange={(value) => {
            setSelectedType(value);
            mutation.reset();
          }}>
            <SelectTrigger id={`${id}-type`} aria-describedby={`${id}-help`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
            </SelectContent>
          </Select>
          <p id={`${id}-help`} className="text-sm text-muted-foreground">
            Choose what the file is. It must match how the file will be used — for example, a file marked as video cannot be used as a configuration.
          </p>
        </div>
      )}
      {file && <p className="text-sm text-muted-foreground">{file.name} · {bytesHuman(file.size)} · <code>{file.type || 'unknown'}</code></p>}
      <Button type="submit" disabled={!file || !type || mutation.isPending}>
        {mutation.isPending ? 'Uploading…' : compact ? 'Upload and attach' : 'Upload'}
      </Button>
      {mutation.isPending && <Loading label="Uploading" />}
      {mutation.isError && <ErrorAlert error={mutation.error} />}
      {mutation.data && !compact && (
        <div role="status" className="space-y-2">
          <p>File id <code>{mutation.data.id}</code> — status <code>{mutation.data.status}</code></p>
          <pre className="overflow-auto rounded border p-3">{mutation.data.id}</pre>
        </div>
      )}
    </form>
  );
}
