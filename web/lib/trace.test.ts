import { describe, expect, it } from 'vitest';
import { articles, articleKey, buildTrace, processEntries, traceReport } from './trace';
import type { StreamEvent } from './types';
const events: StreamEvent[] = [
  { sequence: 0, type: 'facts', data: { facts: [{ id: 'veh1', group: 'vehicle', statement: 'Speed was 5 m/s.' }] } },
  { sequence: 1, type: 'question', data: { tool: 'law', turn: 1, goal: 'driver', question: 'Which rule?' } },
  { sequence: 2, elapsed_seconds: 4, type: 'answer', data: { tool: 'law', turn: 1, answer: 'Article 11 §3, 5° requires yielding. Art. 40.4.1 also applies.', references: ['WEGCODE.pdf (part: 1)', 'WEGCODE.pdf (part: 2)'] } },
  { sequence: 3, type: 'review', data: { review: {
    clerk_recommendation: { justification: [{ point: 'Check the crossing.', tracking_facts: ['veh1', 'missing'], picture: true, source: { tool: 'law', turn: 1 }, quote: 'requires yielding' }] },
    legal_candidates: [{ rule: 'Yield', article: 'Art. 11, §3, 5°', source_as_cited: 'requires yielding', source: { tool: 'law', turn: 1 } }],
  } } },
];
describe('detailed review trace', () => {
  it('normalizes equivalent article citations without treating different articles as equivalent', () => {
    expect(articles('Art. 40.4.1 and Article 11, §3, 5°; Art. 40.4.1')).toEqual(['Art. 40.4.1', 'Article 11, §3, 5°']);
    expect(articleKey('Art. 11, §3, 5°')).toBe(articleKey('Article 11 §3, 5°'));
    expect(articleKey('Article 11')).not.toBe(articleKey('Art. 12'));
  });
  it('links legal turns to their question goal, retained articles and unique documents', () => {
    const trace = buildTrace(events);
    expect(trace.citations[0]).toEqual({ turn: 'law · turn 1', goal: 'driver', articles: ['Article 11 §3, 5°', 'Art. 40.4.1'], carried: ['Article 11 §3, 5°'], documents: ['WEGCODE.pdf'] });
    expect(trace.basis[0].lines).toContain('veh1 · vehicle: Speed was 5 m/s.');
    expect(trace.basis[0].lines).toContain('missing · no such tracking fact');
    expect(trace.basis[0].lines.join('\n')).toContain('found in the answer');
    expect(trace.basis[1].lines.join('\n')).toContain('named in the linked answer');
  });
  it('does not falsely validate quotes or citations from another tool', () => {
    const clone = structuredClone(events);
    clone[3].data.review.legal_candidates[0].source.tool = 'another';
    const point = buildTrace(clone).basis[1];
    expect(point.lines.join('\n')).toContain('answer missing');
    expect(point.lines.join('\n')).toContain('not found in the answer');
    expect(point.lines.join('\n')).toContain('not named in the linked answer');
  });
  it('groups consecutive text deltas without truncating text or merging separate fields', () => {
    const text = 'Full text '.repeat(300);
    const input: StreamEvent[] = [{ sequence: 1, type: 'thinking', data: { text } }, { sequence: 2, type: 'thinking', data: { text: 'end' } }, { sequence: 3, type: 'writing', data: { field: 'summary', text: 'summary' } }, { sequence: 4, type: 'writing', data: { field: 'rule', text: 'rule' } }];
    const result = processEntries(input);
    expect(result).toHaveLength(3); expect(result[0].data.text).toBe(text + 'end');
    expect(result[0].count).toBe(2); expect(result[0].last_sequence).toBe(2);
    expect(input[0].data.text).toBe(text);
    const report = traceReport('test', input);
    expect(report).toContain(text + 'end'); expect(report).toContain('summary'); expect(report).toContain('rule');
  });
  it('preserves unknown event fields, usage and failures in the downloadable report', () => {
    const report = traceReport('sample', [...events, { sequence: 4, type: 'turn', data: { model: 'm', usage: { input: 123, output: 45 }, request_id: 'request-abc' } }, { sequence: 5, type: 'error', data: { message: 'failed ``` safely' } }]);
    expect(report).toContain('request-abc'); expect(report).toContain('123'); expect(report).toContain('failed ``` safely'); expect(report).toContain('````json');
    expect(report).toContain('What each point rests on'); expect(report).toContain('Tracking facts');
  });
});
