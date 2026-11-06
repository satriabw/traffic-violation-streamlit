'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Download } from 'lucide-react';
import { buildTrace, traceReport, type ProcessEntry } from '@/lib/trace';
import { collect, totals } from '@/lib/progress';
import type { StreamEvent } from '@/lib/types';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function TraceView({ events, name }: { events: StreamEvent[]; name: string }) {
  const trace = useMemo(() => buildTrace(events), [events]);
  const progress = useMemo(() => collect(events), [events]);
  const markdown = useRef<HTMLAnchorElement>(null);
  const json = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const reportUrl = URL.createObjectURL(new Blob([traceReport(name, events)], { type: 'text/markdown' }));
    const jsonUrl = URL.createObjectURL(new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' }));
    if (markdown.current) markdown.current.href = reportUrl;
    if (json.current) json.current.href = jsonUrl;
    return () => { URL.revokeObjectURL(reportUrl); URL.revokeObjectURL(jsonUrl); };
  }, [events, name]);
  return <section aria-label="Detailed debug trace" className="min-w-0 space-y-4 rounded-xl border bg-background p-4 text-sm">
    <header className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Detailed trace</h3><span className="text-xs text-muted-foreground">{events.length} events · {progress.elapsed.toFixed(1)}s</span></div><p className="break-words text-xs leading-relaxed text-muted-foreground">{progress.done ? totals(progress) : progress.model ? `Model: ${progress.model}` : 'Recorded events from the backend.'}</p></header>
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" render={<a ref={markdown} download={`${name}-debug.md`} />}><Download className="size-3.5" />Download debug trace (Markdown)</Button><Button variant="outline" size="sm" render={<a ref={json} download={`${name}-steps.json`} />}><Download className="size-3.5" />Download the steps (JSON)</Button></div>
    <Tabs defaultValue="process" className="min-w-0"><TabsList className="h-auto max-w-full flex-wrap justify-start"><TabsTrigger value="process">Process</TabsTrigger><TabsTrigger value="citations">Citations</TabsTrigger><TabsTrigger value="basis">Evidence basis</TabsTrigger><TabsTrigger value="facts">Tracking facts</TabsTrigger><TabsTrigger value="raw">Raw events</TabsTrigger></TabsList>
      <TabsContent value="process" className="min-w-0 space-y-3 pt-3">{trace.process.length ? trace.process.map((entry, i) => <Process key={i} event={entry} />) : <p className="text-muted-foreground">No process events recorded yet.</p>}</TabsContent>
      <TabsContent value="citations" className="min-w-0 pt-3">{trace.citations.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow>{['Legal turn', 'Goal', 'Articles named', 'Carried into review', 'Documents'].map(title => <TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader><TableBody>{trace.citations.map((row, i) => <TableRow key={i}><TableCell className="align-top">{row.turn}</TableCell><TableCell className="align-top">{row.goal || '—'}</TableCell><TableCell className="align-top">{row.articles.join(', ') || 'none'}</TableCell><TableCell className="align-top">{row.carried.join(', ') || '—'}</TableCell><TableCell className="align-top">{row.documents.join(', ') || 'none'}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-muted-foreground">No answered legal turns recorded.</p>}</TabsContent>
      <TabsContent value="basis" className="space-y-5 pt-3">{trace.basis.length ? trace.basis.map((point, i) => <article key={i} className="space-y-2"><h4 className="font-medium">{point.title}</h4><Markdown text={point.text} /><ul className="list-disc space-y-1 break-words pl-5 text-xs leading-relaxed text-muted-foreground">{point.lines.map((line, j) => <li key={j}>{line}</li>)}</ul></article>) : <p className="text-muted-foreground">No submitted review with linked evidence is recorded.</p>}</TabsContent>
      <TabsContent value="facts" className="space-y-3 pt-3">{trace.facts?.length ? trace.facts.map((fact, i) => <div key={i} className="space-y-2 rounded-lg bg-muted/40 p-3"><p className="font-medium">{fact.id} · {fact.group}</p><Markdown text={String(fact.statement ?? '')} /><details><summary className="cursor-pointer text-xs text-muted-foreground">All fact fields</summary><Payload value={fact} /></details></div>) : <p className="text-muted-foreground">No tracking facts recorded.</p>}</TabsContent>
      <TabsContent value="raw" className="min-w-0 space-y-2 pt-3"><p className="text-xs text-muted-foreground">Every event as received, including individual text deltas. No events or payload fields are truncated.</p>{events.map((event, i) => <details key={i} className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer text-xs">#{event.sequence ?? i} · {event.type} · {event.elapsed_seconds ?? 0}s</summary><Payload value={event} /></details>)}</TabsContent>
    </Tabs>
  </section>;
}
function Payload({ value }: { value: unknown }) { return <pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>; }
function Process({ event }: { event: ProcessEntry }) {
  const data = event.data ?? {};
  const usage = data.usage ?? data.tokens;
  const body = ['thinking', 'text', 'writing', 'step'].includes(event.type) ? data.text : event.type === 'answer' ? data.answer : event.type === 'question' ? data.question : event.type === 'status' ? data.detail : null;
  return <article className="min-w-0 space-y-3 rounded-lg border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium capitalize">{event.type.replaceAll('_', ' ')}{data.tool ? ` · ${data.tool}` : ''}{data.turn != null ? ` · turn ${data.turn}` : ''}{data.field ? ` · ${data.field}` : ''}</h4><span className="text-xs text-muted-foreground">#{event.sequence ?? '—'}{event.count > 1 ? `–${event.last_sequence} · ${event.count} deltas` : ''} · {(event.elapsed_seconds ?? 0).toFixed(1)}s</span></div>
    {data.phase && <p className="text-xs text-muted-foreground">Phase: {data.phase}</p>}
    {data.goal && <p className="text-xs text-muted-foreground">Goal: {data.goal}{data.for_question ? ` · open question ${data.for_question}` : ''}{data.attach_frame ? ' · picture attached' : ''}</p>}
    {body && <div className="text-sm leading-relaxed"><Markdown text={String(body)} /></div>}
    {data.error && <p className="text-destructive">{String(data.error)}</p>}
    {data.message && <p>{String(data.message)}</p>}
    {data.model && <p className="break-words text-xs text-muted-foreground">{data.model}{data.call != null ? ` · call ${data.call}` : ''}{data.stop_reason ? ` · ${data.stop_reason}` : ''}{data.seconds != null ? ` · ${data.seconds}s` : ''}{data.request_id ? ` · request ${data.request_id}` : ''}</p>}
    {usage && <p className="text-xs text-muted-foreground">Tokens: input {usage.input ?? 0} · output {usage.output ?? 0} · cache read {usage.cache_read ?? 0}{usage.cache_write != null ? ` · cache write ${usage.cache_write}` : ''}</p>}
    {data.tools?.length > 0 && <p className="text-xs text-muted-foreground">Tools: {data.tools.join(', ')}</p>}
    {data.references?.length > 0 && <div><p className="text-xs font-medium">Documents retrieved</p><ul className="mt-2 list-disc space-y-1 break-words pl-5 text-xs text-muted-foreground">{data.references.map((reference: unknown, i: number) => <li key={i}>{String(reference)}</li>)}</ul></div>}
    {data.revised_query && <div className="space-y-1"><p className="text-xs font-medium">Revised query</p><Markdown text={String(data.revised_query)} /></div>}
    <details open={!body && !data.model && !data.references}><summary className="cursor-pointer text-xs text-muted-foreground">Complete event data</summary><Payload value={data} /></details>
  </article>;
}
