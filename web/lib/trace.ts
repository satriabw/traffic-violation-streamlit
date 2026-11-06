import type { StreamEvent } from './types';

// Backend event/review payloads have different schemas; retain their complete fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TraceData = Record<string, any>;
const dataOf = (event: StreamEvent): TraceData => event.data && typeof event.data === 'object' ? event.data : {};
const array = (value: unknown): TraceData[] => Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
const text = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : String(value);
export function articles(value: string): string[] {
  return [...new Set([...value.matchAll(/\bArt(?:icle)?s?\.?\s*\d+(?:\.\d+)*(?:\s*,?\s*§\s*\d+)?(?:\s*,?\s*\d+°)?/gi)].map(m => m[0].replace(/\s+/g, ' ').trim()))];
}
export const articleKey = (value: string) => value.toLowerCase().replace(/^art(?:icle)?s?\.?|[\s,]/g, '');
const norm = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const turnKey = (data: TraceData) => JSON.stringify([data.tool ?? null, data.turn ?? null]);
const turnName = (data: TraceData) => `${data.tool || 'Legal source'} · turn ${data.turn ?? '—'}`;
const documents = (references: unknown) => [...new Set((Array.isArray(references) ? references : []).map(r => text(r).split(' (part:')[0].trim()))];

export type CitationRow = { turn: string; goal: string; articles: string[]; carried: string[]; documents: string[] };
export type BasisRow = { title: string; text: string; lines: string[] };
export type ProcessEntry = StreamEvent & { last_sequence?: number; last_elapsed?: number; count: number };

export function processEntries(events: StreamEvent[]): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const event of events) {
    const data = dataOf(event);
    const last = entries.at(-1);
    // Join adjacent text deltas for readability; the Raw events tab preserves every boundary.
    if (last && ['thinking', 'text', 'writing'].includes(event.type) && last.type === event.type &&
      last.data?.field === data.field && last.data?.index === data.index && typeof data.text === 'string') {
      last.data = { ...last.data, text: (last.data?.text ?? '') + data.text };
      last.last_sequence = event.sequence; last.last_elapsed = event.elapsed_seconds; last.count++;
    } else entries.push({ ...event, data: { ...data }, count: 1, last_sequence: event.sequence, last_elapsed: event.elapsed_seconds });
  }
  return entries;
}

export function buildTrace(events: StreamEvent[]) {
  const questions = new Map<string, TraceData>();
  const answers = new Map<string, TraceData>();
  let review: TraceData | null = null;
  let facts: TraceData[] | null = null;
  for (const event of events) {
    const data = dataOf(event);
    if (event.type === 'question') questions.set(turnKey(data), data);
    if (event.type === 'answer' && !data.error) answers.set(turnKey(data), data);
    if (event.type === 'review') review = data.review ?? null;
    if (event.type === 'facts') facts = array(data.facts);
  }
  const legal = array(review?.legal_candidates);
  const kept = new Set(articles(legal.map(c => `${c.article ?? ''} ${c.source_as_cited ?? ''} ${c.rule ?? ''}`).join(' ')).map(articleKey));
  const citations: CitationRow[] = [...answers].map(([key, answer]) => {
    const named = articles(text(answer.answer));
    return { turn: turnName(answer), goal: text(answer.goal || questions.get(key)?.goal), articles: named, carried: named.filter(a => kept.has(articleKey(a))), documents: documents(answer.references) };
  });
  const factMap = new Map((facts ?? []).map(f => [f.id, f]));
  const basis: BasisRow[] = [];
  const show = (title: string, description: unknown, item: TraceData) => {
    const lines: string[] = [];
    for (const id of item.tracking_facts ?? []) {
      const fact = factMap.get(id);
      lines.push(fact ? `${id} · ${fact.group}: ${fact.statement}` : `${id} · no such tracking fact`);
    }
    if (item.picture) lines.push('Uses the evidence picture.');
    const source = item.source;
    const answer = source ? answers.get(turnKey(source)) : undefined;
    const answerText = text(answer?.answer);
    if (source) {
      lines.push(`Legal source: ${turnName(source)}${answer ? '' : ' · answer missing'}`);
      if ('quote' in item) lines.push(item.quote ? `Quote: “${item.quote}” · ${norm(answerText).includes(norm(text(item.quote))) ? 'found in the answer' : 'not found in the answer'}` : 'No legal quote provided.');
      lines.push(`Articles in this answer: ${articles(answerText).join(', ') || 'none'}`);
    }
    if ('article' in item) {
      const named = new Set(articles(answerText).map(articleKey));
      const cited = articles(text(item.article));
      lines.push(item.article ? `Article: ${item.article} · ${cited.length && cited.every(a => named.has(articleKey(a))) ? 'named in the linked answer' : 'not named in the linked answer'}` : 'No article provided.');
    }
    if ('source_as_cited' in item) {
      const cited = text(item.source_as_cited);
      lines.push(`Source as cited: “${cited}” · ${cited && answer && norm(answerText).includes(norm(cited)) ? 'found in the answer' : 'not found in the answer'}`);
      if (answer) lines.push(`Retrieved documents: ${documents(answer.references).join(', ') || 'none'}`);
    }
    if (!lines.length) lines.push('No supporting evidence linked.');
    basis.push({ title, text: text(description), lines });
  };
  if (review?.flag_check) show(`Flag check · ${review.flag_check.status}`, review.flag_check.seen, review.flag_check);
  array(review?.clerk_recommendation?.justification).forEach((point, i) => show(`Clerk basis ${i + 1}`, point.point, point));
  for (const [title, key] of [['Driver', 'driver_recommendations'], ['Site', 'site_recommendations']]) {
    for (const item of array(review?.[key])) {
      const points = array(item.justification);
      if (points.length) points.forEach(point => show(title, `${item.text} — ${point.point}`, point));
      else show(title, item.text, item);
    }
  }
  legal.forEach(item => show('Candidate rule', item.rule, item));
  return { citations, basis, facts, review, process: processEntries(events) };
}

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
export function traceReport(name: string, events: StreamEvent[]) {
  const trace = buildTrace(events);
  const parts = [`# Debug trace · ${name}`, `Events: ${events.length}`, '## Articles per legal turn',
    '| Turn | Goal | Articles named | Carried into review | Documents |', '|---|---|---|---|---|',
    ...trace.citations.map(row => `| ${[row.turn, row.goal, row.articles.join(', ') || 'none', row.carried.join(', ') || '—', row.documents.join(', ') || 'none'].map(cell).join(' | ')} |`),
    '## What each point rests on', ...trace.basis.map(row => `### ${row.title}\n\n${row.text}\n\n${row.lines.map(line => `- ${line}`).join('\n')}`),
    '## Tracking facts', ...(trace.facts ?? []).map(f => `- ${f.id} · ${f.group}: ${f.statement}`), '## Complete process'];
  for (const event of trace.process) {
    // Fence longer than any backtick run in a payload, preserving arbitrary text safely.
    const json = JSON.stringify(event.data, null, 2);
    const fence = '`'.repeat(Math.max(3, ...[...json.matchAll(/`+/g)].map(m => m[0].length + 1)));
    parts.push(`### ${event.sequence ?? '—'}${event.last_sequence !== event.sequence ? `–${event.last_sequence}` : ''} · ${event.type} · ${event.elapsed_seconds ?? 0}s\n\n${fence}json\n${json}\n${fence}`);
  }
  return parts.join('\n\n') + '\n';
}
