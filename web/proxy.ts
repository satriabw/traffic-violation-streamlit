import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function matches(value: string, expected: string) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function proxy(request: NextRequest): Response | undefined {
  const user = process.env.CONSOLE_USER;
  const password = process.env.CONSOLE_PASSWORD;
  if (!user || !password) return new NextResponse("Console credentials are not configured", { status: 503 });
  const authorization = request.headers.get("authorization");
  const expected = "Basic " + Buffer.from(`${user}:${password}`, "utf8").toString("base64");
  const authenticated = authorization !== null && matches(authorization, expected);
  if (!authenticated) return new NextResponse("Authentication required", {
    status: 401, headers: { "WWW-Authenticate": 'Basic realm="console"' },
  });
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") && /\.\.|%2e|%2f/i.test(path)) {
    return new NextResponse("Invalid API path", { status: 400 });
  }
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("sec-fetch-site") !== "same-origin") {
    return new NextResponse("Cross-origin request refused", { status: 403 });
  }
  return undefined;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
