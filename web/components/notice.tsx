import { ApiError } from '@/lib/api';

export function Empty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-6 text-center">
      <p>{message}</p>
      {hint && <p className="mt-2 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  const detail = error instanceof ApiError
    ? error.detail
    : error instanceof Error ? error.message : String(error);

  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      {detail}
    </div>
  );
}
