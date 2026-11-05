'use client';

import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { del } from '@/lib/api';
import type { Site } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';

export function DeleteSiteDialog({ site, onDeleted }: { site: Site; onDeleted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const inputId = useId();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => del(`/sites/${encodeURIComponent(site.id)}`),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['site', site.id] });
      queryClient.removeQueries({ queryKey: ['sites', site.id], exact: true });
      await queryClient.invalidateQueries({ queryKey: ['sites'] });
      toast.success('Deleted.');
      onDeleted?.();
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (remove.isPending) return;
      setOpen(nextOpen);
      if (nextOpen) {
        setConfirm('');
        remove.reset();
      }
    }}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>Delete site</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete site</DialogTitle>
          <DialogDescription>A site that has recorded violations cannot be deleted, so violation records are never removed by accident. Type the site name to confirm.</DialogDescription>
        </DialogHeader>
        <p className="font-medium break-all">{site.name}</p>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (confirm === site.name && !remove.isPending) remove.mutate();
        }}>
          <Label htmlFor={inputId}>Site name</Label>
          <Input id={inputId} placeholder={site.name} value={confirm}
            onChange={(event) => setConfirm(event.target.value)} disabled={remove.isPending} />
          {remove.isError && <ErrorAlert error={remove.error} />}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={confirm !== site.name || remove.isPending}>Delete site</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
