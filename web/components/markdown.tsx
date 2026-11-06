'use client';

import ReactMarkdown from 'react-markdown';
import { safeUrl, unescapeText } from '@/lib/format';

export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2 break-words [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc [&_a]:underline [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3">
    <ReactMarkdown urlTransform={url => safeUrl(url) ?? ''} components={{
      a: ({ href, children }) => {
        const url = safeUrl(href);
        return url ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
      },
      img: ({ src, alt }) => {
        const url = typeof src === 'string' ? safeUrl(src) : undefined;
        // eslint-disable-next-line @next/next/no-img-element
        return url ? <img src={url} alt={alt ?? ''} className="max-w-full" /> : <span>{alt}</span>;
      },
    }}>{unescapeText(text)}</ReactMarkdown>
  </div>;
}
