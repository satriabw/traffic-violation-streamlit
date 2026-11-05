import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

const auth = "Basic " + Buffer.from("operator:pä:ss", "utf8").toString("base64");
const request = (path = "/", method = "GET", headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { method, headers });

describe("request gate", () => {
  beforeEach(() => {
    vi.stubEnv("CONSOLE_USER", "operator");
    vi.stubEnv("CONSOLE_PASSWORD", "pä:ss");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses everything when no password is set", () => {
    delete process.env.CONSOLE_PASSWORD;
    expect(proxy(request())?.status).toBe(503);
  });
  it("asks for credentials", () => {
    const response = proxy(request());
    expect(response?.status).toBe(401);
    expect(response?.headers.get("WWW-Authenticate")).toBe('Basic realm="console"');
  });
  it("refuses wrong credentials", () => {
    expect(proxy(request("/", "GET", { authorization: "Basic " + Buffer.from("operator:wrong").toString("base64") }))?.status).toBe(401);
  });
  it("lets the right credentials through, colon and umlaut included", () => {
    expect(proxy(request("/", "GET", { authorization: auth }))).toBeUndefined();
  });
  it("refuses a cross-site write", () => {
    expect(proxy(request("/api/v1/sites", "POST", { authorization: auth, "sec-fetch-site": "cross-site" }))?.status).toBe(403);
  });
  it("refuses a write with no fetch metadata", () => {
    expect(proxy(request("/api/v1/sites", "POST", { authorization: auth }))?.status).toBe(403);
  });
  it("lets a same-origin write through", () => {
    expect(proxy(request("/api/v1/sites", "POST", { authorization: auth, "sec-fetch-site": "same-origin" }))).toBeUndefined();
  });
  // URL parsing removes standalone encoded dot segments before proxy runs.
  it.each(["a%2e%2eb", "a%2E%2Eb", "a..b"])("refuses an encoded or raw embedded dot segment: %s", (segment) => {
    expect(proxy(request(`/api/v1/storage/${segment}/sites`, "GET", { authorization: auth }))?.status).toBe(400);
  });
  it.each(["a%2Fb", "a%2fb"])("refuses an encoded slash: %s", (segment) => {
    expect(proxy(request(`/api/v1/storage/${segment}`, "GET", { authorization: auth }))?.status).toBe(400);
  });
  it("checks configuration, credentials, path, then method", () => {
    const invalidWrite = request("/api/a%2Fb", "POST");
    delete process.env.CONSOLE_PASSWORD;
    expect(proxy(invalidWrite)?.status).toBe(503);
    process.env.CONSOLE_PASSWORD = "pä:ss";
    expect(proxy(invalidWrite)?.status).toBe(401);
    invalidWrite.headers.set("authorization", auth);
    expect(proxy(invalidWrite)?.status).toBe(400);
  });
  it("allows HEAD without fetch metadata and limits path checks to the API", () => {
    expect(proxy(request("/", "HEAD", { authorization: auth }))).toBeUndefined();
    expect(proxy(request("/a%2Fb", "GET", { authorization: auth }))).toBeUndefined();
  });
  it.each(["/_next/static/chunk.js", "/_next/image?url=x", "/favicon.ico"])("excludes %s from the matcher", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
  it.each(["/", "/api/v1/sites"])("protects %s with the matcher", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });
});
