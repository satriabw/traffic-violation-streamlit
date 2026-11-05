import { streamEvents } from './api';
import { emptyProgress, fold, type Progress } from './progress';

export const LOST_REVIEW_STREAM = "Lost the review's stream. The review goes on without this page; reload to follow it again.";

// Keep every event, but coalesce visual updates. The final state is always flushed.
export async function followReview(path: string, signal: AbortSignal, render: (progress: Progress) => void): Promise<Progress> {
  let current = emptyProgress();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPaint = -Infinity;
  const paint = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!signal.aborted) render(current);
    lastPaint = Date.now();
  };
  try {
    await streamEvents(path, event => {
      current = fold(current, event);
      if (Date.now() - lastPaint >= 250) paint();
      else if (!timer) timer = setTimeout(paint, 250 - (Date.now() - lastPaint));
    }, signal);
    if (!current.events.some(event => event.type === 'done' || event.type === 'error')) current = { ...current, broken: LOST_REVIEW_STREAM };
  } catch {
    if (!signal.aborted) current = { ...current, broken: LOST_REVIEW_STREAM };
  } finally {
    if (timer) clearTimeout(timer);
    if (!signal.aborted) paint();
  }
  return current;
}
