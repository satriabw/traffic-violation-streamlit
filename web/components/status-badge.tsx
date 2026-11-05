import { CHIPS } from '@/lib/status';

export function StatusBadge({ value, label, prefix }: {
  value?: string | null;
  label?: string;
  prefix?: string;
}) {
  const key = value ?? 'none';
  const [background, color] = CHIPS[key] ?? CHIPS.none;

  return (
    <span className="inline-flex items-center gap-1">
      {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
      <span
        className="inline-block whitespace-nowrap rounded px-2 text-xs font-semibold leading-normal"
        style={{ background, color }}
      >
        {label ?? key.replaceAll('_', ' ')}
      </span>
    </span>
  );
}
