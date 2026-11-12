'use client';

import { Loading } from '@/components/loading';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrNull, post, readEvents } from '@/lib/api';
import { emptyProgress } from '@/lib/progress';
import { followReview } from '@/lib/review-stream';
import type { Recommendation, ReviewDoc, ReviewState } from '@/lib/types';
import { Markdown } from '@/components/markdown';
import { ErrorAlert } from '@/components/notice';
import { TraceView } from '@/components/trace-view';
import { ProgressSteps } from '@/components/progress-steps';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { FeedbackForm, runIdOf } from '@/components/feedback-form';

export function ReviewPanel({ siteId, violationId, status, updatedAt, stepsContainer }: {
  stepsContainer?: HTMLElement | null;
  siteId: string; violationId: string; status: string; updatedAt: string;
}) {
  const client = useQueryClient();
  const path = `/sites/${encodeURIComponent(siteId)}/violations/${encodeURIComponent(violationId)}/review`;
  const [started, setStarted] = useState(0);
  const [progress, setProgress] = useState(emptyProgress);
  const [following, setFollowing] = useState(status === 'pending');
  const [showSteps, setShowSteps] = useState(false);
  const finished = useRef(false);
  const review = useQuery({
    queryKey: ['review', siteId, violationId, updatedAt],
    queryFn: () => getOrNull<ReviewState>(path, e => e.status === 404 && e.detail.includes('not been reviewed')),
  });
  const start = useMutation({
    mutationFn: () => post(path),
    onSuccess: () => { finished.current = false; setFollowing(true); setStarted(n => n + 1); },
  });
  const steps = useQuery({
    queryKey: ['review-events', siteId, violationId, updatedAt],
    queryFn: () => readEvents(`${path}/events?after=-1&paced=false`),
    // Read once finished: the steps when shown, and the run the feedback form rates.
    enabled: !following && (review.data?.status === 'completed' || review.data?.status === 'failed'),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (finished.current || (status !== 'pending' && !started)) return;
    const abort = new AbortController();
    void followReview(`${path}/events?after=-1`, abort.signal, setProgress).then(() => {
      if (!abort.signal.aborted) {
        finished.current = true;
        setFollowing(false);
        void client.invalidateQueries({ queryKey: ['review', siteId, violationId] });
        void client.invalidateQueries({ queryKey: ['violation', siteId, violationId] });
      }
    });
    return () => abort.abort();
  }, [client, path, siteId, violationId, status, started]);


  const completed = !following && (review.data?.review ?? progress.review);
  const failed = !following && (review.data?.status === 'failed' || !!progress.error);
  const details = (following || completed || failed) ? <section aria-label="Review steps" className="min-w-0 space-y-4 border-t pt-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="space-y-1"><h2 className="text-sm font-medium">Review steps</h2></div><label className="flex items-center gap-2 text-sm"><Switch checked={showSteps} onCheckedChange={setShowSteps} />Show the steps it took</label></div>
    {showSteps && <div className="min-w-0 space-y-3">
      {following ? <TraceView events={progress.events} name={violationId} /> : <>
        {steps.isFetching && <Loading variant="panel" label="Reading the review’s steps…" />}
        {steps.isError && <ErrorAlert error={steps.error} />}
        {steps.data && <TraceView events={steps.data} name={violationId} />}
      </>}
    </div>}
  </section> : null;
  const stepsSlot = stepsContainer === undefined ? details : stepsContainer ? createPortal(details, stepsContainer) : null;
  return <><section className="space-y-4">

    <h2 className="text-base font-medium">Evidence review</h2>
    {following && <div role="status" className="space-y-3 rounded-lg border p-4"><Loading label="The review is running…" /><ProgressSteps progress={progress} /></div>}
    {progress.broken && <p role="alert" className="rounded-lg border p-4">{progress.broken}</p>}
    {review.isError && <ErrorAlert error={review.error} />}
    {review.isPending && !following && <Loading variant="panel" label="Loading review…" />}
    {completed && <FinishedReview review={completed} />}
    {completed && runIdOf(steps.data ?? progress.events) && <FeedbackForm siteId={siteId} violationId={violationId} runId={runIdOf(steps.data ?? progress.events)} />}
    {failed && <div role="alert"><p>The last review failed and is not retried automatically. Press the button below to try again.</p><p>{review.data?.error || progress.error}</p></div>}
    {!following && !completed && !failed && review.isSuccess && <p>{review.data?.status === 'running' || status === 'pending' ? 'The review is still running.' : 'Not reviewed yet. This violation has not been sent for review.'}</p>}
    {!following && (['detected', 'failed'].includes(status) || failed) && <div className="space-y-2">
      <Button disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : status === 'failed' || failed ? 'Review again' : 'Start the review'}</Button>
      <p className="text-sm text-muted-foreground">The review checks the evidence and suggests a next step.</p>
    </div>}
    {start.isError && <ErrorAlert error={start.error} />}

  </section>{stepsSlot}</>;
}

function Advice({ title, items }: { title: string; items?: Recommendation[] }) {
  if (!items?.length) return null;
  return <div className="space-y-2"><h3 className="font-semibold">{title}</h3><ul className="list-disc space-y-2 pl-5">{items.map((item, i) => <li key={i}><Markdown text={item.text} /></li>)}</ul></div>;
}

export function FinishedReview({ review }: { review: ReviewDoc }) {
  const clerk = review.clerk_recommendation;
  const flag = review.flag_check;
  return <div className="space-y-5">
    {flag && flag.status !== 'on_foot' && flag.status !== 'stands' && <div className="rounded-lg border p-4"><strong>{{riding: 'The person was riding, not walking — the flag likely does not stand.', does_not_stand: 'The record does not bear the rule out — the detection likely does not stand.', unclear: 'Whether the detection stands cannot be told from the evidence.'}[flag.status]}</strong><Markdown text={flag.seen} /></div>}
    {clerk && <div className="space-y-3 rounded-lg border p-4"><h3 className="font-semibold">Recommended next step</h3><Markdown text={clerk.text} />{clerk.justification?.length > 0 && <details><summary className="cursor-pointer text-sm text-muted-foreground">Why this recommendation</summary><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{clerk.justification.map((point, i) => <li key={i}><Markdown text={point.point} /></li>)}</ol></details>}<p className="text-sm text-muted-foreground">Guidance only: the clerk decides.</p></div>}
    <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Supporting findings and recommendations</summary><div className="mt-4 space-y-5 text-sm">
    {review.summary && <Markdown text={review.summary} />}
    <Advice title="For the driver" items={review.driver_recommendations} />
    <Advice title="For the site" items={review.site_recommendations} />
    {review.legal_candidates?.length > 0 && <div className="space-y-2"><h3 className="font-semibold">Rules that may apply</h3><ul className="list-disc space-y-2 pl-5">{review.legal_candidates.map((candidate, i) => <li key={i}><strong>{candidate.article || 'article not given by the legal source'}</strong> · <Markdown text={candidate.rule} /></li>)}</ul><p className="text-sm text-muted-foreground">Candidates as the legal source cited them, not a legal finding: the clerk decides.</p></div>}
    {review.still_unsure?.length > 0 && <div><h3 className="font-semibold">Still unsure</h3><ul className="list-disc space-y-2 pl-5">{review.still_unsure.map((text, i) => <li key={i}><Markdown text={text} /></li>)}</ul></div>}
    </div></details>
  </div>;
}
