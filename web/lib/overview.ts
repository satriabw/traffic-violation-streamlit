import type { Run, Site, ViolationSummary } from './types';

export function summarise(sites: Site[], violations: ViolationSummary[], runs: Run[]) {
  const statuses = (status: string) => violations.filter(item => item.explanation_status === status).length;
  const days = new Map<string, number>();
  const counts = new Map<string, number>();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  for (const violation of violations) {
    const day = formatter.format(new Date(violation.detected_at));
    days.set(day, (days.get(day) ?? 0) + 1);
    counts.set(violation.site_id, (counts.get(violation.site_id) ?? 0) + 1);
  }
  const ordered = [...days.keys()].sort();
  const perDay: { day: string; count: number }[] = [];
  if (ordered.length) {
    const last = Date.parse(ordered.at(-1)!);
    for (let time = Date.parse(ordered[0]); time <= last; time += 86400000) {
      const day = new Date(time).toISOString().slice(0, 10);
      perDay.push({ day, count: days.get(day) ?? 0 });
    }
  }
  return {
    tiles: {
      sites: sites.length,
      streams: sites.filter(site => site.source?.kind === 'stream').length,
      violations: violations.length,
      awaiting: statuses('detected'), reviewed: statuses('explained'),
      pending: statuses('pending'), failed: statuses('failed'),
      busy: runs.filter(run => ['queued', 'running'].includes(run.status)).length,
      failedRuns: runs.filter(run => run.status === 'failed').length,
    },
    perDay,
    bySite: sites.map(site => ({ site: site.name, count: counts.get(site.id) ?? 0 })),
  };
}
