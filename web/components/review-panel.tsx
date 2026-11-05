'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrNull, post, readEvents } from '@/lib/api';
import { collect, emptyProgress } from '@/lib/progress';
import { followReview } from '@/lib/review-stream';
import type { Recommendation, ReviewDoc, ReviewState } from '@/lib/types';
import { Markdown } from '@/components/markdown';
import { ErrorAlert } from '@/components/notice';
import { ProgressSteps } from '@/components/progress-steps';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

export function ReviewPanel({ siteId, violationId, status, updatedAt }: {
  siteId: string; violationId: string; status: string; updatedAt: string;
}) {
  const client = useQueryClient();
  const path = `/sites/${encodeURIComponent(siteId)}/violations/${encodeURIComponent(violationId)}/review`;
  const [started, setStarted] = useState(0);
  const [progress, setProgress] = useState(emptyProgress);
  const [following, setFollowing] = useState(status === 'pending');
  const [showSteps, setShowSteps] = useState(false);
  const download = useRef<HTMLAnchorElement>(null);
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
    queryFn: () => readEvents(`${path}/events?after=-1`),
    enabled: showSteps && !following && (review.data?.status === 'completed' || review.data?.status === 'failed'),
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

  useEffect(() => {
    if (!steps.data || !showSteps) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(steps.data, null, 2)], { type: 'application/json' }));
    const anchor = download.current;
    if (anchor) anchor.href = url;
    return () => URL.revokeObjectURL(url);
  }, [steps.data, showSteps]);

  const completed = !following && (review.data?.review ?? progress.review);
  const failed = !following && (review.data?.status === 'failed' || !!progress.error);
  return <section className="space-y-4">
    <h2 className="text-xl font-semibold">Evidence review</h2>
    {following && <div role="status" className="space-y-3 rounded-lg border p-4"><p className="font-medium">The review is running…</p><ProgressSteps progress={progress} /></div>}
    {progress.broken && <p role="alert" className="rounded-lg border p-4">{progress.broken}</p>}
    {review.isError && <ErrorAlert error={review.error} />}
    {review.isPending && !following && <p role="status">Loading review…</p>}
    {completed && <FinishedReview review={completed} />}
    {failed && <div role="alert"><p>The last review failed and is not retried automatically. Press the button below to try again.</p><p>{review.data?.error || progress.error}</p></div>}
    {!following && !completed && !failed && review.isSuccess && <p>{review.data?.status === 'running' || status === 'pending' ? 'The review is still running.' : 'Not reviewed yet. This violation has not been sent for review.'}</p>}
    {!following && (['detected', 'failed'].includes(status) || failed) && <div className="space-y-2">
      <Button disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : status === 'failed' || failed ? 'Review again' : 'Start the review'}</Button>
      <p className="text-sm text-muted-foreground">Safe to press more than once: a violation is only reviewed once at a time, and a finished review is simply shown again.</p>
    </div>}
    {start.isError && <ErrorAlert error={start.error} />}
    {!following && (completed || failed) && <label className="flex items-center gap-2"><Switch checked={showSteps} onCheckedChange={setShowSteps} />Show the steps it took</label>}
    {showSteps && <div className="space-y-3">
      {steps.isFetching && <p role="status">Reading the review’s steps…</p>}
      {steps.isError && <ErrorAlert error={steps.error} />}
      {steps.data && <ProgressSteps progress={collect(steps.data)} />}
      {steps.data && <a ref={download} download={`${violationId}-steps.json`} className="underline">Download the steps (JSON)</a>}
    </div>}
  </section>;
}

function Advice({ title, items }: { title: string; items?: Recommendation[] }) {
  if (!items?.length) return null;
  return <div className="space-y-2"><h3 className="font-semibold">{title}</h3><ul className="list-disc space-y-2 pl-5">{items.map((item, i) => <li key={i}><Markdown text={item.text} /></li>)}</ul></div>;
}

export function FinishedReview({ review }: { review: ReviewDoc }) {
  const clerk = review.clerk_recommendation;
  const flag = review.flag_check;
  return <div className="space-y-5">
    {flag && flag.status !== 'on_foot' && <div className="rounded-lg border p-4"><strong>{flag.status === 'riding' ? 'The person was riding, not walking — the flag likely does not stand.' : 'Whether the person was on foot cannot be told from the evidence.'}</strong><Markdown text={flag.seen} /></div>}
    {clerk && <div className="space-y-3 rounded-lg border p-4"><h3 className="font-semibold">Recommended next step</h3><Markdown text={clerk.text} />{clerk.justification?.length > 0 && <><h4 className="font-medium">Basis</h4><ol className="list-decimal space-y-2 pl-5">{clerk.justification.map((point, i) => <li key={i}><Markdown text={point.point} /></li>)}</ol></>}<p className="text-sm text-muted-foreground">Guidance only: the clerk decides.</p></div>}
    {review.summary && <Markdown text={review.summary} />}
    <Advice title="For the driver" items={review.driver_recommendations} />
    <Advice title="For the site" items={review.site_recommendations} />
    {review.legal_candidates?.length > 0 && <div className="space-y-2"><h3 className="font-semibold">Rules that may apply</h3><ul className="list-disc space-y-2 pl-5">{review.legal_candidates.map((candidate, i) => <li key={i}><strong>{candidate.article || 'article not given by the legal source'}</strong> · <Markdown text={candidate.rule} /></li>)}</ul><p className="text-sm text-muted-foreground">Candidates as the legal source cited them, not a legal finding: the clerk decides.</p></div>}
    {review.still_unsure?.length > 0 && <div><h3 className="font-semibold">Still unsure</h3><ul className="list-disc space-y-2 pl-5">{review.still_unsure.map((text, i) => <li key={i}><Markdown text={text} /></li>)}</ul></div>}
  </div>;
}
