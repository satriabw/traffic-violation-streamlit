import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "@/components/health-dot";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("console shell smoke", () => {
  it("accepts a healthy API and rejects an unsuccessful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 })));
    await expect(checkHealth()).resolves.toBe(true);
    await expect(checkHealth()).rejects.toThrow("API unreachable");
    expect(fetch).toHaveBeenCalledWith("/health");
  });
  it("refuses requests until credentials are configured", () => {
    vi.stubEnv("CONSOLE_USER", ""); vi.stubEnv("CONSOLE_PASSWORD", "");
    expect(proxy(new NextRequest("http://localhost/" ))?.status).toBe(503);
  });
});
