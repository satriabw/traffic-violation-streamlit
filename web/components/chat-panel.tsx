'use client';

import { Loading } from '@/components/loading';
import { ArrowUp, ChevronDown, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, del, get, post, readEvents } from '@/lib/api';
import { collect } from '@/lib/progress';
import type { Chat, ChatSummary, ChatTurn, StreamEvent } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { Markdown } from '@/components/markdown';
import { TraceView } from '@/components/trace-view';
import { ProgressSteps } from '@/components/progress-steps';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ChatPanel({ siteId, violationId, heading = true }: { siteId: string; violationId: string; heading?: boolean }) {
  const client = useQueryClient();
  const path = `/sites/${encodeURIComponent(siteId)}/violations/${encodeURIComponent(violationId)}/chats`;
  const listKey = ['chats', siteId, violationId];
  const [selected, setSelected] = useState('new');
  const [text, setText] = useState('');
  const chats = useQuery({ queryKey: listKey, queryFn: () => get<ChatSummary[]>(path), retry: false });
  const chat = useQuery({
    queryKey: [...listKey, selected],
    queryFn: () => get<Chat>(`${path}/${encodeURIComponent(selected)}`),
    enabled: selected !== 'new',
    refetchInterval: query => query.state.data?.status === 'answering' ? 1500 : false,
  });
  const current = selected !== 'new' ? chat.data : undefined;
  const busy = current?.status === 'answering';
  const full = (current?.questions ?? 0) >= 5;
  const ask = useMutation({
    mutationFn: async () => {
      const target = selected === 'new' ? await post<Chat>(path) : current;
      if (!target) throw new Error('Load the chat before asking a question.');
      setSelected(target.id);
      return post<Chat>(`${path}/${encodeURIComponent(target.id)}/messages`, { text: text.trim() });
    },
    onSuccess: async () => {
      setText('');
      await client.invalidateQueries({ queryKey: listKey });
    },
    onError: async error => {
      if (error instanceof ApiError && error.status === 409) await client.invalidateQueries({ queryKey: listKey });
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`${path}/${encodeURIComponent(selected)}`),
    onSuccess: async () => {
      client.removeQueries({ queryKey: [...listKey, selected] });
      setSelected('new');
      await client.invalidateQueries({ queryKey: listKey });
    },
  });
  const first = current?.turns.at(-1)?.first_event ?? 0;
  const events = useQuery({
    queryKey: ['chat-events', siteId, violationId, selected, busy ? 'answering' : current?.updated_at, busy ? first : -1],
    queryFn: () => readEvents(`${path}/${encodeURIComponent(selected)}/events?after=${busy ? first - 1 : -1}&paced=false`),
    enabled: !!current,
    refetchInterval: busy ? 1500 : false,
    staleTime: busy ? 0 : Infinity,
  });
  const progress = collect(events.data ?? []);
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [selected, current?.turns.length, busy]);
  const disabled = busy || full || ask.isPending || remove.isPending || (selected !== 'new' && !current);
  return <section aria-label="Violation conversation" className="flex min-h-[32rem] min-w-0 flex-col lg:h-full lg:min-h-0">
    {heading && <h2 className="text-xl font-semibold">Ask about this violation</h2>}
    {chats.error instanceof ApiError && chats.error.status === 404
      ? <p>The chat is off on this backend: set CHAT_ENABLED for site-service.</p>
      : <>
        {chats.isError && <ErrorAlert error={chats.error} />}
        {chats.isPending && <Loading variant="panel" label="Loading chats…" />}
        {chats.isSuccess && <>
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            <Select value={selected} onValueChange={value => { setSelected(value ?? 'new'); setText(''); }} disabled={ask.isPending || remove.isPending}>
              <SelectTrigger aria-label="Chat" className="min-w-0 flex-1 border-0 bg-transparent shadow-none"><SelectValue>{selected === 'new' ? 'New chat' : `${chats.data.find(c => c.id === selected)?.title || 'Untitled'} · ${current?.questions ?? 0} questions`}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="new">New chat</SelectItem>{chats.data.map(c => <SelectItem key={c.id} value={c.id}>{c.title || 'Untitled'} · {c.questions} questions</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="ghost" size="icon" aria-label="New chat" disabled={ask.isPending || remove.isPending} onClick={() => { setSelected('new'); setText(''); }}><Plus className="size-4" /></Button>
            {selected !== 'new' && <Button variant="ghost" size="icon" aria-label="Delete chat" disabled={remove.isPending || ask.isPending} onClick={() => remove.mutate()}><Trash2 className="size-4" /></Button>}
          </div>
          <div ref={thread} role="log" aria-label="Messages" className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-5 py-8 sm:px-8">
          {selected === 'new' && <div className="flex h-full min-h-52 flex-col items-center justify-center text-center"><MessageSquare className="mb-4 size-7 text-muted-foreground" /><h2 className="text-xl font-semibold tracking-tight">Let’s look at the evidence</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Watch the clip, then ask about what happened and the rules that may apply.</p><div className="mt-6 flex flex-wrap justify-center gap-2">{['What happened in this clip?', 'What supports this detection?', 'Which rules may apply?'].map(prompt => <Button key={prompt} variant="outline" size="sm" className="h-auto whitespace-normal rounded-full py-2" onClick={() => setText(prompt)}>{prompt}</Button>)}</div></div>}
          {selected !== 'new' && chat.isPending && <Loading variant="panel" label="Loading conversation…" />}
          {selected !== 'new' && chat.isError && <ErrorAlert error={chat.error} />}
          {current?.turns.map(turn => <Turn key={turn.question} turn={turn} events={events.data ?? []} />)}
          {busy && <div role="status" className="space-y-2 rounded-lg border p-4"><Loading label="Answering…" /><ProgressSteps progress={progress} />{progress.exchanges.at(-1)?.answer === null && <p>Waiting for the legal source; it usually takes 25 to 35 s.</p>}</div>}
          {events.isError && <ErrorAlert error={events.error} />}
          </div>
          <div className="sticky bottom-0 shrink-0 bg-background px-4 pb-4 pt-3 sm:px-6">
          <form className="rounded-2xl border bg-muted/40 p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring/30" onSubmit={event => { event.preventDefault(); if (!disabled && text.trim()) ask.mutate(); }}>
            <textarea rows={2} aria-label="Ask about this violation" placeholder={full ? 'This chat has had its five questions; start a new chat.' : 'Ask about this violation…'} disabled={disabled} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!disabled && text.trim()) ask.mutate(); } }} className="max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50" />
            <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{current?.questions ?? 0} / 5 questions</span><Button type="submit" size="icon" aria-label="Send" className="rounded-full" disabled={disabled || !text.trim()}><ArrowUp className="size-4" /></Button></div>
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">Check answers against the evidence and the cited sources.</p>
          </div>
          {ask.isError && <ErrorAlert error={ask.error instanceof ApiError && ask.error.status === 409 ? new Error('This chat is still answering. Wait for its reply before asking again.') : ask.error} />}
          {remove.isError && <ErrorAlert error={remove.error} />}
        </>}
      </>}
  </section>;
}

function Turn({ turn, events }: { turn: ChatTurn; events: StreamEvent[] }) {
  const progress = collect(events.filter(event => event.sequence != null && event.sequence >= turn.first_event && event.sequence <= turn.last_event));
  return <article className="mx-auto max-w-2xl space-y-5">
    <div className="flex justify-end"><div className="max-w-[90%] rounded-2xl bg-muted px-4 py-3 text-sm"><span className="sr-only">You: </span><Markdown text={turn.text} /></div></div>
    {turn.reply != null && <div className="space-y-3 text-sm leading-7"><p className="text-xs font-medium text-muted-foreground">Assistant</p><Markdown text={turn.reply} /></div>}
    {turn.error && <p role="alert" className="text-sm text-destructive">{turn.error}</p>}
    {(turn.reply != null || turn.error) && progress.events.length > 0 && <Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>How it answered: steps<ChevronDown className="size-4" /></CollapsibleTrigger>
      <CollapsibleContent className="pt-3"><TraceView events={progress.events} name={`chat-question-${turn.question}`} /></CollapsibleContent>
    </Collapsible>}
  </article>;
}
