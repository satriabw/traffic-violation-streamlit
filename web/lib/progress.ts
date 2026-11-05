import type { ReviewDoc, StreamEvent } from './types';

type Question = { id: number; question: string; status: string; goal?: string };
type Fact = { id: string; group: string; [key: string]: unknown };
type Exchange = { tool?: string; turn?: number; question?: string; answer: Record<string, unknown> | null };
type Done = { model?: string; model_calls?: number; rag_turns?: number; cost_usd?: number; tokens?: { input?: number; output?: number } };
export type Progress = {
  events: StreamEvent[];
  step: string;
  timeline: string[];
  facts: Record<string, Fact>;
  questions: Record<number, Question>;
  exchanges: Exchange[];
  thinking: string;
  text: string;
  budget: { used?: number; limit?: number } | null;
  turns: { model?: string }[];
  writing: Record<string, string>;
  review: ReviewDoc | null;
  error: string | null;
  done: Done | null;
  model: string | null;
  replay: boolean;
  broken: string | null;
  elapsed: number;
};

export function emptyProgress(): Progress {
  return { events: [], step: '', timeline: [], facts: {}, questions: {}, exchanges: [], thinking: '', text: '', budget: null, turns: [], writing: {}, review: null, error: null, done: null, model: null, replay: false, broken: null, elapsed: 0 };
}

export function fold(previous: Progress, event: StreamEvent): Progress {
  if (event.type === 'replay') return { ...previous, replay: true };
  const p = { ...previous, events: [...previous.events, event], timeline: [...previous.timeline], elapsed: event.elapsed_seconds ?? previous.elapsed };
  const data = event.data ?? {};
  const line = (text: string) => { if (text) p.timeline.push(text); };
  switch (event.type) {
    case 'manifest': p.model = data.model ?? null; break;
    case 'status': line(data.detail ?? ''); break;
    case 'facts': {
      const facts: Fact[] = data.facts ?? [];
      p.facts = Object.fromEntries(facts.map(f => [f.id, f]));
      const groups = new Map<string, number>();
      facts.forEach(f => groups.set(f.group, (groups.get(f.group) ?? 0) + 1));
      line(`The tracking gives ${[...groups].map(([group, n]) => `${n} ${group}`).join(', ')} facts`);
      break;
    }
    case 'step': p.step = data.text ?? ''; line(`${p.step}…`); break;
    case 'thinking': {
      const text = data.text ?? '';
      p.thinking += text;
      if (p.timeline.at(-1)?.startsWith('Thinking...')) p.timeline[p.timeline.length - 1] += text;
      else line(`Thinking... ${text}`);
      break;
    }
    case 'text': p.text += data.text ?? ''; break;
    case 'questions': {
      const questions: Question[] = data.questions ?? [];
      if (!Object.keys(p.questions).length) line(`Unsure about ${questions.length} things: ${questions.map(q => q.question).join('; ')}`);
      else {
        const settled = questions.filter(q => q.status !== 'open');
        line(`${questions.filter(q => q.status === 'open').length} still open${settled.length ? `; settled: ${settled.at(-1)!.question}` : ''}`);
      }
      p.questions = Object.fromEntries(questions.map(q => [q.id, q]));
      break;
    }
    case 'question':
      p.exchanges = [...p.exchanges, { ...data, answer: null }];
      line(`Asking the legal source (turn ${data.turn}): ${data.question ?? ''}`);
      break;
    case 'answer': {
      const index = p.exchanges.findLastIndex(e => e.tool === data.tool && e.turn === data.turn);
      p.exchanges = p.exchanges.map((e, i) => i === index ? { ...e, answer: data } : e);
      line(data.error ? `Turn ${data.turn} failed: ${data.error}` : `The legal source answered in ${Number(data.seconds ?? 0).toFixed(0)} s`);
      break;
    }
    case 'budget': p.budget = data; break;
    case 'refused': line(`Not sent to ${data.tool}: ${data.reason ?? ''} — “${data.question ?? ''}”`); break;
    case 'turn': p.turns = [...p.turns, data]; break;
    case 'writing':
      if (data.field !== 'source_as_cited') {
        const key = `${data.field ?? ''}:${data.index ?? 0}`;
        p.writing = { ...p.writing, [key]: (p.writing[key] ?? '') + (data.text ?? '') };
      }
      break;
    case 'review': p.review = data.review ?? null; break;
    case 'done': p.done = data; p.model = data.model || p.model; break;
    case 'error': p.error = data.message ?? 'The review failed.'; break;
  }
  return p;
}

export function collect(events: Iterable<StreamEvent>): Progress {
  let p = emptyProgress();
  for (const event of events) p = fold(p, event);
  return p;
}

export function totals(p: Progress): string {
  const done = p.done ?? {};
  const model = done.model || p.model || '';
  const fallbacks = [...new Set(p.turns.map(t => t.model).filter((m): m is string => !!m && m !== model))].sort();
  return [
    model + (fallbacks.length ? ` (fell back to ${fallbacks.join(', ')})` : ''),
    `${done.model_calls ?? 0} model calls`, `${done.rag_turns ?? 0} legal turns`,
    done.cost_usd != null ? `$${done.cost_usd}` : '',
    done.tokens ? `${((done.tokens.input ?? 0) + (done.tokens.output ?? 0)).toLocaleString('en-US')} tokens` : '',
    `${p.elapsed.toFixed(0)}s`,
  ].filter(Boolean).join(' · ');
}
