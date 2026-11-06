'use client';

import { Loading } from '@/components/loading';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CHAT_ENABLED, get, getOrNull } from '@/lib/api';
import { safeUrl, ts } from '@/lib/format';
import { reviewLabel } from '@/lib/status';
import { chatHref } from '@/lib/navigation';
import type { Page as ApiPage, Violation, ViolationSummary } from '@/lib/types';
import { VideoPlayer } from '@/components/video-player';
import { ChatPanel } from '@/components/chat-panel';
import { SiteWorkspace } from '@/components/site-workspace';
import { Empty, ErrorAlert } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function violationLabel(row: ViolationSummary) {
  return `${row.type.replaceAll('_', ' ')} · ${ts(row.detected_at)} · ${row.id.slice(0, 8)}`;
}

function ChatWorkspace({ siteId }: { siteId: string }) {
  const router = useRouter();
  const requested = useSearchParams().get('violation');
  const path = `/sites/${encodeURIComponent(siteId)}/violations`;
  const list = useQuery({
    queryKey: ['violations', siteId, { limit: 100 }],
    queryFn: () => get<ApiPage<ViolationSummary>>(`${path}?limit=100`),
  });
  const listed = list.data?.items.find(row => row.id === requested);
  // A direct link may name an older violation outside the latest hundred.
  const pinned = useQuery({
    queryKey: ['violation', siteId, requested],
    queryFn: () => getOrNull<Violation>(`${path}/${encodeURIComponent(requested!)}`),
    enabled: !!requested && list.isSuccess && !listed,
  });
  const selected = requested ? listed ?? pinned.data : list.data?.items[0];
  const options = pinned.data && !listed ? [pinned.data, ...(list.data?.items ?? [])] : list.data?.items ?? [];

  return <div className="space-y-6">
    {list.isPending && <Loading variant="chat" label="Loading violations…" />}
    {list.isError && <ErrorAlert error={list.error} />}
    {pinned.isError && <ErrorAlert error={pinned.error} />}
    {list.isSuccess && options.length > 0 && <div className="max-w-3xl space-y-2">
      <Label htmlFor="chat-violation">Violation</Label>
      <Select value={selected?.id ?? null} onValueChange={id => { if (id) router.push(chatHref(siteId, id)); }}>
        <SelectTrigger id="chat-violation" className="w-full"><SelectValue placeholder="Pick a violation">{selected && violationLabel(selected)}</SelectValue></SelectTrigger>
        <SelectContent>{options.map(row => <SelectItem key={row.id} value={row.id}>{violationLabel(row)}</SelectItem>)}</SelectContent>
      </Select>
      {list.data.total > list.data.items.length && <p className="text-xs text-muted-foreground">Choose from the latest {list.data.items.length} violations. An older record can be opened in Chat from its violation page.</p>}
    </div>}
    {requested && list.isSuccess && !listed && pinned.isPending && <Loading variant="chat" label="Loading the selected violation…" />}
    {requested && pinned.data === null && <Empty message="This violation is no longer available." hint="Choose another violation above." />}
    {list.isSuccess && !requested && !options.length && <Empty message="No violations at this site yet." />}
    {selected && <div className="grid min-w-0 overflow-hidden rounded-2xl border lg:h-[calc(100dvh-18rem)] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Evidence key={selected.id} violation={selected} path={path} />
      <div className="min-h-0 min-w-0"><ChatPanel key={`${siteId}-${selected.id}`} siteId={siteId} violationId={selected.id} heading={false} /></div>
    </div>}

  </div>;
}

function Evidence({ violation, path }: { violation: ViolationSummary; path: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const [failed, setFailed] = useState(false);
  const clip = safeUrl(violation.clip_url);
  const image = safeUrl(violation.thumbnail_url);
  return <section aria-label="Violation evidence" className="min-w-0 border-b bg-muted/25 lg:overflow-y-auto lg:border-r lg:border-b-0">
    <div className="flex items-center justify-between px-5 py-4"><h2 className="text-sm font-medium">Evidence</h2><Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Show clip' : 'Hide clip'}</Button><span className="hidden text-xs text-muted-foreground lg:inline">Violation clip</span></div>
    <div className={`${collapsed ? 'hidden lg:block' : ''} space-y-5 px-5 pb-6`}>
      <div className="overflow-hidden rounded-xl bg-black">
        {clip && !failed ? <VideoPlayer key={clip} src={clip} poster={image} label="Violation evidence clip" onError={() => setFailed(true)} />
          : image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={image} alt="Selected violation evidence" className="aspect-video w-full object-contain" />
            : <div className="flex aspect-video items-center justify-center px-6 text-center text-sm text-white/70">{violation.evidence_status === 'pending' ? 'The evidence is being prepared.' : 'No evidence image is available.'}</div>}
      </div>
      {failed && <p role="alert" className="text-sm text-destructive">The clip could not be played. You can still discuss the evidence image.</p>}
      {!clip && <p className="text-sm text-muted-foreground">{violation.evidence_status === 'pending' ? 'The short clip is still being prepared.' : violation.evidence_status === 'failed' ? 'The evidence clip could not be created.' : 'No clip is available for this record.'}</p>}
      <div className="space-y-3"><h3 className="text-lg font-semibold capitalize tracking-tight">{violation.type.replaceAll('_', ' ')}</h3><p className="text-sm text-muted-foreground">{ts(violation.detected_at)} · frame {violation.frame_index ?? '—'}</p><div className="flex flex-wrap gap-2"><StatusBadge value={violation.explanation_status} label={reviewLabel(violation.explanation_status)} prefix="review" /><StatusBadge value={violation.evidence_status} prefix="evidence" /></div></div>
      <p className="text-sm leading-relaxed text-muted-foreground">{clip ? 'Replay the short clip around the violation as you discuss the evidence.' : 'Discuss this violation using the available evidence.'}</p>
      <Button variant="outline" size="sm" render={<Link href={`${path}/${encodeURIComponent(violation.id)}`} />}>Open violation and review</Button>
    </div>
  </section>;
}

export default function Page() {
  return <Suspense fallback={<Loading variant="chat" label="Loading chat…" />}>
    {CHAT_ENABLED ? <SiteWorkspace title="Chat" group="Monitoring" description="Review the evidence. Ask what happened.">
      {site => <ChatWorkspace key={site.id} siteId={site.id} />}
    </SiteWorkspace> : <Empty message="The chat is off." hint="Set NEXT_PUBLIC_CHAT_ENABLED=1 for this console and CHAT_ENABLED=1 for site-service." />}
  </Suspense>;
}
