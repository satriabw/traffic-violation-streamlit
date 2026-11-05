"use client";

import { useQuery } from "@tanstack/react-query";

export async function checkHealth(): Promise<boolean> {
  const response = await fetch("/health");
  if (!response.ok) throw new Error("API unreachable");
  return true;
}

export function HealthDot() {
  const { isSuccess, isError } = useQuery({
    queryKey: ["health"], queryFn: checkHealth, refetchInterval: 15_000,
  });
  const connected = isSuccess && !isError;
  return (
    <div role="status" className="flex items-center gap-2 px-2 py-1 text-sm">
      <span aria-hidden="true" className={`size-2 rounded-full ${connected ? "bg-green-600" : "bg-red-600"}`} />
      {connected ? "API connected" : "API unreachable"}
    </div>
  );
}
