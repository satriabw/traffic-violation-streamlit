import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

type LoadingVariant = 'inline' | 'page' | 'panel' | 'table' | 'video' | 'chat' | 'cards' | 'setup' | 'dashboard' | 'navigation' | 'heading';

function Lines({ short = false }: { short?: boolean }) {
  return <div className="space-y-2.5"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-[88%]" /><Skeleton className={cn('h-3', short ? 'w-2/5' : 'w-3/5')} /></div>;
}
function VideoSkeleton() {
  return <div className="relative aspect-video overflow-hidden rounded-xl bg-muted/60">
    <Skeleton className="absolute inset-0 rounded-xl" />
    <div className="absolute inset-0 flex items-center justify-center"><div className="size-14 rounded-full border border-background/70 bg-background/50 p-4"><Skeleton className="size-full rounded-sm bg-foreground/10" /></div></div>
    <div className="absolute inset-x-5 bottom-5 flex items-center gap-3"><Skeleton className="size-3 rounded-sm bg-foreground/10" /><Skeleton className="h-1.5 flex-1 rounded-full bg-foreground/10" /><Skeleton className="h-2 w-10 bg-foreground/10" /></div>
  </div>;
}
function TableSkeleton() {
  return <div className="overflow-hidden rounded-xl border"><div className="flex gap-8 border-b bg-muted/25 px-5 py-4"><Skeleton className="h-3 w-1/4" /><Skeleton className="h-3 w-1/3" /><Skeleton className="ml-auto h-3 w-16" /></div>{Array.from({ length: 5 }, (_, i) => <div key={i} className="flex items-center gap-5 border-b px-5 py-5 last:border-b-0"><Skeleton className="size-9 shrink-0 rounded-lg" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-2.5 w-1/2" /></div><Skeleton className="hidden h-5 w-16 rounded-full sm:block" /><Skeleton className="h-7 w-16 rounded-md" /></div>)}</div>;
}
function PanelSkeleton() {
  return <div className="space-y-6 rounded-xl border p-5"><div className="flex items-center gap-3"><Skeleton className="size-9 rounded-lg" /><div className="space-y-2"><Skeleton className="h-3.5 w-36" /><Skeleton className="h-2.5 w-24" /></div></div><Lines /><div className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-9 w-full" /></div><Skeleton className="h-8 w-28" /></div>;
}
function ChatSkeleton() {
  return <div className="grid overflow-hidden rounded-2xl border lg:grid-cols-2"><div className="space-y-5 border-b bg-muted/10 p-5 lg:border-r lg:border-b-0"><div className="flex items-center justify-between"><Skeleton className="h-3.5 w-20" /><Skeleton className="h-3 w-24" /></div><VideoSkeleton /><Skeleton className="h-5 w-2/3" /><div className="flex gap-2"><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div><Lines short /></div><div className="flex min-h-[28rem] flex-col"><div className="flex items-center justify-between border-b p-5"><Skeleton className="h-3.5 w-28" /><Skeleton className="size-5 rounded-full" /></div><div className="flex-1 space-y-8 p-6"><div className="ml-auto w-3/4 rounded-2xl bg-muted/40 p-4"><Lines short /></div><div className="space-y-4"><Skeleton className="size-6 rounded-full" /><Lines /><Skeleton className="h-3 w-4/5" /></div></div><div className="p-5"><div className="space-y-5 rounded-2xl border bg-muted/20 p-4"><Skeleton className="h-3 w-2/3" /><div className="flex justify-between"><Skeleton className="h-2.5 w-16" /><Skeleton className="size-7 rounded-full" /></div></div></div></div></div>;
}
function CardsSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="space-y-4 rounded-xl border p-4"><VideoSkeleton /><Skeleton className="h-4 w-3/4" /><div className="flex gap-2"><Skeleton className="h-4 w-16 rounded-full" /><Skeleton className="h-4 w-12 rounded-full" /></div><Skeleton className="h-3 w-1/2" /><Skeleton className="h-8 w-full" /></div>)}</div>;
}

export function Loading({ label = 'Loading…', className, variant = 'inline' }: { label?: string; className?: string; variant?: LoadingVariant }) {
  if (variant === 'inline') return <div role="status" aria-live="polite" className={cn('inline-flex items-center gap-2.5 py-2 text-xs text-muted-foreground', className)}><LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.75} /><span>{label}</span></div>;
  return <div role="status" aria-live="polite" aria-busy="true" className={cn('w-full min-w-0', className)}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true" className="space-y-6">
      {variant === 'heading' ? <Skeleton className="h-4 w-32" />
        : variant === 'navigation' ? <div className="space-y-8 p-4"><div className="flex gap-3"><Skeleton className="size-8 rounded-lg" /><div className="space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-2.5 w-20" /></div></div><Skeleton className="h-8 w-full" />{Array.from({ length: 3 }, (_, i) => <div key={i} className="space-y-5"><Skeleton className="h-2 w-16" />{Array.from({ length: 3 }, (_, j) => <div key={j} className="flex gap-3"><Skeleton className="size-4 rounded-sm" /><Skeleton className="h-3 w-28" /></div>)}</div>)}</div>
        : variant === 'video' ? <><VideoSkeleton /><div className="max-w-lg"><Lines short /></div></>
        : variant === 'table' ? <TableSkeleton />
        : variant === 'cards' ? <CardsSkeleton />
        : variant === 'chat' ? <ChatSkeleton />
        : variant === 'panel' ? <PanelSkeleton />
        : variant === 'setup' ? <><div className="flex gap-6 border-b pb-4"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-36" /><Skeleton className="hidden h-4 w-32 sm:block" /></div><div className="grid gap-6 lg:grid-cols-[3fr_2fr]"><PanelSkeleton /><div className="space-y-5 self-start rounded-xl bg-muted/20 p-5"><Skeleton className="h-3.5 w-24" /><Lines /><Skeleton className="h-3 w-32" /><Lines short /></div></div></>
        : <><div className="space-y-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-48" /><Skeleton className="h-3 w-72 max-w-full" /></div>{variant === 'dashboard' && <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="space-y-4 rounded-xl border p-5"><Skeleton className="h-3 w-24" /><Skeleton className="h-8 w-20" /><Skeleton className="h-2.5 w-32" /></div>)}</div>}<TableSkeleton /></>}
    </div>
  </div>;
}
