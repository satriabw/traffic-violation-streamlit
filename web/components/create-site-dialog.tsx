'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { post } from '@/lib/api';
import type { Site } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

export function CreateSiteDialog({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [attach, setAttach] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [validation, setValidation] = useState('');
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => post<Site>('/sites', {
      name: name.trim(),
      ...(attach && streamUrl.trim()
        ? { source: { kind: 'stream', stream_url: streamUrl.trim() } }
        : {}),
    }),
    onSuccess: async (site) => {
      await queryClient.invalidateQueries({ queryKey: ['sites'] });
      toast.success(`Created ${site.name} — ${site.id}`);
      onCreated?.();
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (create.isPending) return;
      setOpen(nextOpen);
      if (nextOpen) {
        setName('');
        setAttach(false);
        setStreamUrl('');
        setValidation('');
        create.reset();
      }
    }}>
      <DialogTrigger render={<Button />}>Create a site</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a site</DialogTitle>
          <DialogDescription>You can create a site now and add its video later on Site Setup.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setValidation('A name is required.');
            return;
          }
          setValidation('');
          create.mutate();
        }}>
          <div className="space-y-2">
            <Label htmlFor="site-name">Name</Label>
            <Input id="site-name" placeholder="Jl. Sudirman — north approach" value={name}
              onChange={(event) => setName(event.target.value)} disabled={create.isPending}
              aria-invalid={Boolean(validation)} aria-describedby={validation ? 'site-name-error' : undefined} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="attach-stream" checked={attach} onCheckedChange={setAttach} disabled={create.isPending} />
            <Label htmlFor="attach-stream">Add a live camera feed link now</Label>
          </div>
          {attach && <div className="space-y-2">
            <Label htmlFor="stream-url">Stream URL</Label>
            <Input id="stream-url" placeholder="rtsp://…" value={streamUrl}
              onChange={(event) => setStreamUrl(event.target.value)} disabled={!attach || create.isPending} />
            <p className="text-sm text-muted-foreground">Only a live camera feed can be added here. To use a recorded video, upload it on Site Setup.</p>
          </div>}
          {validation && <p id="site-name-error" role="alert" className="text-sm text-destructive">{validation}</p>}
          {create.isError && <ErrorAlert error={create.error} />}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>Create site</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
