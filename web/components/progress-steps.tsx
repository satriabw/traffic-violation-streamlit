import { totals, type Progress } from '@/lib/progress';
import { Markdown } from '@/components/markdown';

export function ProgressSteps({ progress: p }: { progress: Progress }) {
  return <div className="space-y-3 text-sm">
    <p className="text-muted-foreground">{p.elapsed.toFixed(0)}s in{p.budget?.limit ? ` · legal source ${p.budget.used ?? 0} of ${p.budget.limit} questions` : ''}</p>
    <ul className="list-disc space-y-1 pl-5">{p.timeline.slice(-14).map((line, index) => <li key={index}>{line.slice(-600)}</li>)}</ul>
    {Object.keys(p.questions).length > 0 && <div><h4 className="font-medium">What it is unsure about</h4>{Object.values(p.questions).map(q => <p key={q.id}>{q.status} · {q.question} · {q.goal}</p>)}</div>}
    {p.text && <Markdown text={p.text} />}
    {!p.review && Object.keys(p.writing).length > 0 && <div><h4 className="font-medium">Writing the review</h4>{Object.entries(p.writing).map(([key, text]) => <Markdown key={key} text={text} />)}</div>}
    {p.error && <p role="alert">{p.error}</p>}
    {p.done && <p className="text-muted-foreground">{totals(p)}</p>}
  </div>;
}
