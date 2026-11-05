import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from './types';
vi.mock('./api', () => ({ streamEvents: vi.fn() }));
import { streamEvents } from './api';
import { followReview, LOST_REVIEW_STREAM } from './review-stream';

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe('following a review', () => {
  it('coalesces updates and flushes all final events without leaving a timer', async () => {
    vi.useFakeTimers();
    vi.mocked(streamEvents).mockImplementation(async (_path, emit) => {
      emit({ type: 'text', data: { text: 'a' } });
      emit({ type: 'text', data: { text: 'b' } });
      emit({ type: 'done', data: { model: 'm' } });
    });
    const render = vi.fn();
    const p = await followReview('/review/events', new AbortController().signal, render);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls.at(-1)![0].text).toBe('ab');
    expect(p.done?.model).toBe('m');
    expect(p.broken).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports a premature end and a transport error', async () => {
    vi.mocked(streamEvents).mockResolvedValueOnce();
    expect((await followReview('/events', new AbortController().signal, vi.fn())).broken).toBe(LOST_REVIEW_STREAM);
    vi.mocked(streamEvents).mockRejectedValueOnce(new Error('network'));
    expect((await followReview('/events', new AbortController().signal, vi.fn())).broken).toBe(LOST_REVIEW_STREAM);
  });
  it('aborts without repainting or leaking the pending redraw', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    let emit!: (event: StreamEvent) => void;
    let finish!: () => void;
    vi.mocked(streamEvents).mockImplementation((_path, callback) => {
      emit = callback;
      return new Promise(resolve => { finish = resolve; });
    });
    const render = vi.fn();
    const result = followReview('/events', abort.signal, render);
    emit({ type: 'text', data: { text: 'a' } });
    emit({ type: 'text', data: { text: 'b' } });
    abort.abort();
    finish();
    await result;
    expect(render).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
