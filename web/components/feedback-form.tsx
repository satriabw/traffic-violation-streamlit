'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import type { Feedback, StreamEvent } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { Button } from '@/components/ui/button';

const SCORES = [1, 2, 3, 4, 5];

// The run an answer came from, as its first event names it.
export function runIdOf(events: StreamEvent[]): string | null {
  return events.find(event => event.type === 'manifest')?.data?.run_id ?? null;
}

function Scale({ question, caption, value, onChange }: {
  question: string; caption: string; value: number | null; onChange: (score: number) => void;
}) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-medium">{question}</legend>
    <div className="flex gap-2">{SCORES.map(score => <Button key={score} type="button" size="sm" variant={value === score ? 'default' : 'outline'}
      aria-pressed={value === score} onClick={() => onChange(score)}>{score}</Button>)}</div>
    <p className="text-xs text-muted-foreground">{caption}</p>
  </fieldset>;
}

// An expert's rating of the violation itself (no runId) or of one agent run's answer about it.
export function FeedbackForm({ siteId, violationId, runId = null }: { siteId: string; violationId: string; runId?: string | null }) {
  const client = useQueryClient();
  const path = `/sites/${encodeURIComponent(siteId)}/violations/${encodeURIComponent(violationId)}/feedback`;
  const [satisfied, setSatisfied] = useState<number | null>(null);
  const [sure, setSure] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState('');
  const saved = useQuery({ queryKey: ['feedback', siteId, violationId], queryFn: () => get<Feedback[]>(path) });
  const send = useMutation({
    mutationFn: () => post<Feedback>(path, { run_id: runId, satisfied, sure, suggestion: suggestion.trim() || null }),
    onSuccess: () => {
      setSatisfied(null); setSure(null); setSuggestion('');
      void client.invalidateQueries({ queryKey: ['feedback', siteId, violationId] });
    },
  });
  const last = saved.data?.filter(item => item.run_id === runId).at(-1);
  return <form className="space-y-4 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); if (satisfied && sure) send.mutate(); }}>
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your feedback</h3>
    <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
      <div className="space-y-4">
        <Scale question="How satisfied are you with the answer?" caption="(1 = not satisfied, 5 = very satisfied)" value={satisfied} onChange={setSatisfied} />
        <Scale question="How sure are you of this evaluation?" caption="(1 = not at all, 5 = completely (expert))" value={sure} onChange={setSure} />
      </div>
      <textarea aria-label="Suggestion" placeholder="Suggestion..." value={suggestion} onChange={event => setSuggestion(event.target.value)}
        className="min-h-28 w-full resize-y rounded-md border bg-transparent p-2 text-sm outline-none placeholder:text-muted-foreground" />
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" disabled={!satisfied || !sure || send.isPending}>{send.isPending ? 'Saving…' : 'Save feedback'}</Button>
      {send.isSuccess && <span className="text-sm text-muted-foreground">Saved.</span>}
      {last && <span className="text-sm text-muted-foreground">Last saved: satisfied {last.satisfied}, sure {last.sure}</span>}
    </div>
    {send.isError && <ErrorAlert error={send.error} />}
  </form>;
}
