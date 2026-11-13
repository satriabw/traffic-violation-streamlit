import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { FeedbackForm, runIdOf } from './feedback-form';

function render(runId?: string | null, saved: unknown[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['feedback', 'site', 'violation'], saved);
  return renderToStaticMarkup(<QueryClientProvider client={client}><FeedbackForm siteId="site" violationId="violation" runId={runId} /></QueryClientProvider>);
}

describe('expert feedback', () => {
  it('asks the two questions in the legal source\'s words', () => {
    const html = render();
    expect(html).toContain('How satisfied are you with the answer?');
    expect(html).toContain('(1 = not satisfied, 5 = very satisfied)');
    expect(html).toContain('How sure are you of this evaluation?');
    expect(html).toContain('(1 = not at all, 5 = completely (expert))');
    expect(html).toContain('Suggestion...');
    expect(html).toContain('Is this a real violation?');
    expect(render('run-a')).not.toContain('Is this a real violation?');
  });

  it('shows the latest feedback given on the same answer only', () => {
    const saved = [
      { id: '1', run_id: null, satisfied: 2, sure: 4, suggestion: null, real_violation: false, created_at: '2026-11-12T10:00:00Z' },
      { id: '2', run_id: 'run-a', satisfied: 5, sure: 3, suggestion: null, created_at: '2026-11-12T10:01:00Z' },
    ];
    expect(render('run-a', saved)).toContain('Last saved: satisfied 5, sure 3');
    expect(render(null, saved)).toContain('Last saved: not a violation, satisfied 2, sure 4');
    expect(render('run-b', saved)).not.toContain('Last saved');
  });

  it('finds the run an answer came from on its manifest', () => {
    expect(runIdOf([{ type: 'status' }, { type: 'manifest', data: { run_id: 'abc' } }])).toBe('abc');
    expect(runIdOf([{ type: 'status' }])).toBeNull();
  });
});
