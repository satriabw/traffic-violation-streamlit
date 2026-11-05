import { describe, expect, it } from 'vitest';
import { collect, emptyProgress, fold, totals } from './progress';

describe('review progress', () => {
  it('keeps replay out of events and folds without changing prior state', () => {
    const initial = emptyProgress();
    expect(fold(initial, { type: 'replay' }).replay).toBe(true);
    expect(initial.replay).toBe(false);
    expect(fold(initial, { type: 'replay' }).events).toEqual([]);
  });
  it('counts facts, combines thinking and pairs legal exchanges', () => {
    const p = collect([
      { type: 'facts', data: { facts: [{ id: 'a', group: 'vehicle' }, { id: 'b', group: 'vehicle' }, { id: 'c', group: 'pedestrian' }] } },
      { type: 'thinking', data: { text: 'one ' } }, { type: 'thinking', data: { text: 'two' } },
      { type: 'question', data: { tool: 'law', turn: 1, question: 'Which rule?' } },
      { type: 'answer', data: { tool: 'law', turn: 1, seconds: 31 } },
    ]);
    expect(p.timeline[0]).toBe('The tracking gives 2 vehicle, 1 pedestrian facts');
    expect(p.timeline.filter(line => line.startsWith('Thinking...'))).toEqual(['Thinking... one two']);
    expect(p.exchanges[0].answer?.seconds).toBe(31);
    expect(p.timeline.at(-1)).toBe('The legal source answered in 31 s');
  });
  it('ignores cited-source writing, preserves earlier exchanges and totals done', () => {
    const before = collect([{ type: 'question', data: { tool: 'law', turn: 1 } }]);
    fold(before, { type: 'answer', data: { tool: 'law', turn: 1 } });
    expect(before.exchanges[0].answer).toBeNull();
    const p = collect([
      { type: 'writing', data: { field: 'source_as_cited', text: 'hidden' } },
      { type: 'writing', data: { field: 'summary', index: 0, text: 'Hello' } },
      { type: 'done', elapsed_seconds: 61, data: { model: 'm', model_calls: 3, rag_turns: 2, cost_usd: 0.12, tokens: { input: 1000, output: 234 } } },
    ]);
    expect(p.writing).toEqual({ 'summary:0': 'Hello' });
    expect(p.model).toBe('m');
    expect(totals(p)).toBe('m · 3 model calls · 2 legal turns · $0.12 · 1,234 tokens · 61s');
  });
});
