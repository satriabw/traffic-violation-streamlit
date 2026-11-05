'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, del, get, post, readEvents } from '@/lib/api';
import { collect } from '@/lib/progress';
import type { Chat, ChatSummary, ChatTurn, StreamEvent } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { Markdown } from '@/components/markdown';
import { ProgressSteps } from '@/components/progress-steps';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ChatPanel({ siteId, violationId }: { siteId: string; violationId: string }) {
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
  const disabled = busy || full || ask.isPending || remove.isPending || (selected !== 'new' && !current);
  return <section className="space-y-4 border-t pt-6">
    <h2 className="text-xl font-semibold">Ask about this violation</h2>
    <p className="text-sm text-muted-foreground">For the team, not the clerk: answers give numbers and name the tools and road users they rest on. Five questions per chat; a new chat starts from the violation again.</p>
    {chats.error instanceof ApiError && chats.error.status === 404
      ? <p>The chat is off on this backend: set CHAT_ENABLED for site-service.</p>
      : <>
        {chats.isError && <ErrorAlert error={chats.error} />}
        {chats.isPending && <p role="status">Loading chats…</p>}
        {chats.isSuccess && <>
          <div className="flex items-center gap-3">
            <Select value={selected} onValueChange={value => { setSelected(value ?? 'new'); setText(''); }} disabled={ask.isPending || remove.isPending}>
              <SelectTrigger aria-label="Chat" className="max-w-full"><SelectValue>{selected === 'new' ? 'New chat' : `${chats.data.find(c => c.id === selected)?.title || 'Untitled'} · ${current?.questions ?? 0} questions`}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="new">New chat</SelectItem>{chats.data.map(c => <SelectItem key={c.id} value={c.id}>{c.title || 'Untitled'} · {c.questions} questions</SelectItem>)}</SelectContent>
            </Select>
            {selected !== 'new' && <Button variant="outline" disabled={remove.isPending || ask.isPending} onClick={() => remove.mutate()}>Delete</Button>}
          </div>
          {selected !== 'new' && chat.isError && <ErrorAlert error={chat.error} />}
          {current?.turns.map(turn => <Turn key={turn.question} turn={turn} events={events.data ?? []} />)}
          {busy && <div role="status" className="space-y-2 rounded-lg border p-4"><p className="font-medium">Answering…</p><ProgressSteps progress={progress} />{progress.exchanges.at(-1)?.answer === null && <p>Waiting for the legal source; it usually takes 25 to 35 s.</p>}</div>}
          {events.isError && <ErrorAlert error={events.error} />}
          <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (!disabled && text.trim()) ask.mutate(); }}>
            <Input aria-label="Ask about this violation" placeholder={full ? 'This chat has had its five questions; start a new chat.' : 'Ask about this violation'} disabled={disabled} value={text} onChange={event => setText(event.target.value)} />
            <Button type="submit" disabled={disabled || !text.trim()}>Send</Button>
          </form>
          {ask.isError && <ErrorAlert error={ask.error instanceof ApiError && ask.error.status === 409 ? new Error('This chat is still answering. Wait for its reply before asking again.') : ask.error} />}
          {remove.isError && <ErrorAlert error={remove.error} />}
        </>}
      </>}
  </section>;
}

function Turn({ turn, events }: { turn: ChatTurn; events: StreamEvent[] }) {
  const progress = collect(events.filter(event => event.sequence != null && event.sequence >= turn.first_event && event.sequence <= turn.last_event));
  return <article className="space-y-3 rounded-lg border p-4">
    <p className="text-sm font-semibold">Question {turn.question}</p><Markdown text={turn.text} />
    {turn.reply != null && <div className="border-t pt-3"><Markdown text={turn.reply} /></div>}
    {turn.error && <p role="alert">{turn.error}</p>}
    {(turn.reply != null || turn.error) && progress.events.length > 0 && <details><summary className="cursor-pointer">How it answered: steps</summary><ProgressSteps progress={progress} /></details>}
  </article>;
}
