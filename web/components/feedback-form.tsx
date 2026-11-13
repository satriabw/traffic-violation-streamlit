'use client';

import { useId, useState } from 'react';
import { Check, MessageSquare } from 'lucide-react';
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
  return <fieldset className="min-w-0 space-y-2.5">
    <legend className="text-sm font-medium leading-5">{question}</legend>
    <div className="grid grid-cols-5 gap-2">{SCORES.map(score => <Button key={score} type="button" size="sm" variant={value === score ? 'default' : 'outline'}
      className="h-10 w-full tabular-nums" aria-label={`${score} out of 5`} aria-pressed={value === score} onClick={() => onChange(score)}>{score}</Button>)}</div>
    <p className="text-xs leading-5 text-muted-foreground">{caption}</p>
  </fieldset>;
}

// An expert's rating of the violation itself (no runId) or of one agent run's answer about it.
export function FeedbackForm({ siteId, violationId, runId = null }: { siteId: string; violationId: string; runId?: string | null }) {
  const client = useQueryClient();
  const suggestionId = useId();
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
  return <form className="@container overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm" onSubmit={event => { event.preventDefault(); if (satisfied && sure) send.mutate(); }}>
    <div className="flex items-start gap-3 border-b bg-muted/25 px-4 py-4 @sm:px-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"><MessageSquare aria-hidden="true" className="size-4" /></span>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Your feedback</h3>
        <p className="text-xs leading-5 text-muted-foreground">Rate the answer and share any suggestions.</p>
      </div>
    </div>
    <div className="space-y-5 p-4 @sm:p-5">
      <div className="grid gap-5 @lg:grid-cols-2 @lg:gap-6">
        <Scale question="How satisfied are you with the answer?" caption="(1 = not satisfied, 5 = very satisfied)" value={satisfied} onChange={setSatisfied} />
        <Scale question="How sure are you of this evaluation?" caption="(1 = not at all, 5 = completely (expert))" value={sure} onChange={setSure} />
      </div>
      <div className="space-y-2">
        <label htmlFor={suggestionId} className="flex items-baseline gap-2 text-sm font-medium">Suggestion <span className="text-xs font-normal text-muted-foreground">Optional</span></label>
        <textarea id={suggestionId} aria-label="Suggestion" placeholder="Suggestion..." rows={3} value={suggestion} onChange={event => setSuggestion(event.target.value)}
          className="min-h-24 w-full resize-y rounded-lg border bg-background px-3 py-2.5 text-sm leading-6 outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" />
      </div>
      {send.isError && <ErrorAlert error={send.error} />}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/25 px-4 py-3 @sm:px-5">
      <div className="text-xs leading-5 text-muted-foreground" role="status">
        {send.isSuccess ? <span className="inline-flex items-center gap-1.5"><Check aria-hidden="true" className="size-3.5" />Feedback saved</span>
          : last ? <span>Last saved: satisfied {last.satisfied}, sure {last.sure}</span>
          : <span>Select both ratings to save.</span>}
      </div>
      <Button type="submit" disabled={!satisfied || !sure || send.isPending}>{send.isPending ? 'Saving…' : 'Save feedback'}</Button>
    </div>
  </form>;
}
