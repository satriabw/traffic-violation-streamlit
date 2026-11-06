import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe('stored model Markdown', () => {
  it('decodes unicode and keeps safe links', () => {
    const html = renderToStaticMarkup(<Markdown text={'Hello \\u00e9 [source](https://example.com/rule)'} />);
    expect(html).toContain('Hello é');
    expect(html).toContain('href="https://example.com/rule"');
    expect(html).toContain('noopener noreferrer');
  });
  it('does not render raw HTML or unsafe links and images', () => {
    const html = renderToStaticMarkup(<Markdown text={'<script>alert(1)</script>\n\n[bad](javascript:alert) ![bad](data:image/png;base64,AAAA)'} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img');
  });
});
