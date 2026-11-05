import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

function matches(value: string, expected: string) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function proxy(request: NextRequest) {
  const user = process.env.CONSOLE_USER;
  const password = process.env.CONSOLE_PASSWORD;
  if (!user || !password) return new NextResponse("Console credentials are not configured", { status: 503 });
  const authorization = request.headers.get("authorization");
  let authenticated = false;
  if (authorization?.startsWith("Basic ")) {
    const credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    authenticated = separator >= 0 && matches(credentials.slice(0, separator), user)
      && matches(credentials.slice(separator + 1), password);
  }
  if (!authenticated) return new NextResponse("Authentication required", {
    status: 401, headers: { "WWW-Authenticate": 'Basic realm="Traffic Violation Console", charset="UTF-8"' },
  });
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") && /\.\.|%2e|%2f/i.test(path)) {
    return new NextResponse("Invalid API path", { status: 400 });
  }
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("sec-fetch-site") !== "same-origin") {
    return new NextResponse("Cross-origin request refused", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
