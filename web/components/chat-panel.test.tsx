import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { ChatPanel } from './chat-panel';

function renderList(error?: ApiError) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  if (error) {
    const query = client.getQueryCache().build(client, { queryKey: ['chats', 'site', 'violation'] });
    query.setState({ status: 'error', error, fetchStatus: 'idle' });
  } else client.setQueryData(['chats', 'site', 'violation'], []);
  return renderToStaticMarkup(<QueryClientProvider client={client}><ChatPanel siteId="site" violationId="violation" /></QueryClientProvider>);
}

describe('chat availability', () => {
  it('explains only list 404 as chat disabled', () => {
    expect(renderList(new ApiError(404, 'disabled'))).toContain('The chat is off on this backend');
    const error = renderList(new ApiError(502, 'API unavailable'));
    expect(error).toContain('API unavailable');
    expect(error).not.toContain('The chat is off');
  });
  it('offers a new chat and question input when no chats exist', () => {
    const html = renderList();
    expect(html).toContain('New chat');
    expect(html).toContain('Ask about this violation');
    expect(html).toContain('Send');
  });
});
