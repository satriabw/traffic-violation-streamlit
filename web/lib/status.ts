const SLATE: [string, string] = ['#eeeeee', '#333333'];
const AMBER: [string, string] = ['#fff2d9', '#674d1b'];
const GREEN: [string, string] = ['#e6f2ed', '#03582f'];
const RED: [string, string] = ['#ffefed', '#ab1300'];
const BLUE: [string, string] = ['#eff3fe', '#1e54b7'];
const VIOLET: [string, string] = ['#f4f1fa', '#4d3880'];

export const CHIPS: Record<string, [bg: string, fg: string]> = {
  detected: SLATE,
  pending: AMBER,
  explained: BLUE,
  failed: RED,
  ready: GREEN,
  created: SLATE,
  active: GREEN,
  degraded: AMBER,
  processing: AMBER,
  completed: BLUE,
  uploaded: GREEN,
  queued: SLATE,
  running: AMBER,
  invalid: VIOLET,
  recording: AMBER,
  stopping: AMBER,
  stopped: BLUE,
  open: AMBER,
  settled: GREEN,
  unanswerable: SLATE,
  none: SLATE
};
export function reviewLabel(status?: string | null): string {
  return ({
    detected: 'not reviewed',
    pending: 'reviewing',
    explained: 'reviewed',
    failed: 'review failed'
  } as Record<string, string>)[status ?? ''] ?? (status || 'none');
}
