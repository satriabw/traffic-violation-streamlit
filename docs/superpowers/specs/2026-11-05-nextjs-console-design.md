# Traffic Violation Console in Next.js: design

The Streamlit console (`app.py`, `pages/`, `lib/`) rewritten as a Next.js app with shadcn/ui, in `web/`. It does the
same things against the same site-service API, with less code, and it is safe to put on a network.

## Why Next.js and not a Vite SPA

Two jobs need a server: relaying site-service (the API, and with `STORAGE_BACKEND=local` its stored files with byte
ranges) on the console's own port, and turning an RTSP feed into something a browser shows. Next.js does both in the
same process: the first with `rewrites` in `next.config.ts` (no code), the second with one route handler. A Vite app
would need a second server beside it.

The MKV remux (`lib/video.py`) is **dropped**. Detection no longer needs a frame count; only the display did.

## Stack

- Next.js 16 (App Router, TypeScript), React 19, every page a client component. An operator console gains nothing
  from server rendering.
- shadcn/ui (https://ui.shadcn.com) on Tailwind 4: Sidebar, Card, Table, Badge, Button, Input, Label, Select, Tabs,
  Collapsible, Dialog, Alert, Switch, Checkbox, Tooltip, Skeleton, Sonner, Chart (Recharts).
- TanStack Query 5 for fetching, caching and polling.
- react-markdown for review and chat text, without `rehype-raw`.
- Vitest for the pure modules, the request gate and the feed route.

## Pages

| Route | Replaces | What it does |
|---|---|---|
| `/` | `pages/0_Overview.py` | Five key figures, violations per day, violations by site, sites table, recent runs |
| `/sites` | `pages/1_Sites.py` | List (filter by source kind), create, delete with the name typed to confirm |
| `/sites/[siteId]?tab=view\|setup\|detection` | `2_Site_View`, `2_Site_Setup`, `3_Detection` | One page, three tabs. The site is in the URL, so the sidebar site picker goes |
| `/sites/[siteId]/violations?run=` | `4_Violations` (gallery) | Review queue, filter by run, paged 12 at a time |
| `/sites/[siteId]/violations/[violationId]` | `4_Violations` (detail), `6_Chat` | Evidence, paths, speeds, the review, and the chat under it |
| `/files` | `5_Files` | Upload without attaching; look up by id |

The Chat page goes: the chat is drawn on the violation it is about.

## Behaviour carried over unchanged

Each of these is explained in the README's "Things that are the way they are for a reason", which moves to
`web/README.md` with the wording kept:

- The upload sends exactly the headers named in the presigned URL's `X-Amz-SignedHeaders`.
- Boxes are drawn at read time over the clean frame. Trajectories are never drawn over the image. Zones are projected
  from pixels to the ground with the violation's own `ground_from_pixel`, and a zone with any point that does not
  project is left out whole.
- Three colourable tracks at most: `#2a78d6`, `#eb6834`, `#1baf7a`. The rest are outlined in `#94a3b8`.
- The review is followed as server-sent events, never polled. The chat is polled every 1.5 s while it answers.
- `explanation_status` is shown in the review's words: detected → "not reviewed", pending → "reviewing",
  explained → "reviewed", failed → "review failed".
- `evidence_status: null` renders grey and says "none".
- Speeds over 60 m/s raise the calibration warning.
- `\uXXXX` escapes in stored model text are decoded for display (`ui.unescape`).
- Copy: user-facing sentences are ported from the Python pages word for word. Plain words, no emoji.

## Behaviour that changes

- **No editable API address.** `API_BASE_URL` is read on the server only. The sidebar shows the health dot.
- **The debug view (`lib/trace.py`) is not ported.** A completed review offers "Download the steps (JSON)" with the
  raw events. The Markdown report can come back later if the developers miss it.
- **The live feed is one ffmpeg per viewer**, killed when the viewer leaves, at most 4 at once. Before, one reader
  was shared per URL.
- **No `/storage` route.** The API hands back storage links as `/api/v1/storage/...`, which the `/api/v1` rewrite
  already relays.

## Security

The console is deployable, so it is locked down from the first commit:

1. **One gate, `web/proxy.ts`**, in front of every request except Next's static assets:
   - HTTP basic auth against `CONSOLE_USER` and `CONSOLE_PASSWORD`. If either is unset, every request is refused
     with 503 (fail closed).
   - Any method other than GET or HEAD needs `Sec-Fetch-Site: same-origin`, otherwise 403. Basic auth is an ambient
     credential like a cookie, so this is the CSRF guard.
   - Any `/api/` path containing `..`, `%2e` or `%2f` (any case) gets 400, so the relay cannot be walked off its
     prefix.
2. **The server decides where the API is.** `API_BASE_URL` goes into the rewrites only. Only `/api/v1/:path*` and
   `/health` are relayed.
3. **Loopback by default.** `dev` and `start` bind `127.0.0.1:3000`. Exposing the console means a TLS reverse proxy
   in front, because basic auth over plain HTTP sends the password in the clear.
4. **The feed route takes a site id, never a URL.** `GET /feed?site=<uuid>` reads the site's active source from the
   API. It accepts only `rtsp:`, `rtsps:`, `http:` and `https:`, and runs ffmpeg with an argument array (no shell)
   and `-protocol_whitelist`. ffmpeg is killed on abort, and a fifth concurrent feed gets 429.
5. **No raw HTML.** No `dangerouslySetInnerHTML` and no `rehype-raw`. Every API-supplied `href` or `src` goes
   through `safeUrl()`, which allows `http(s):` and same-origin paths only.
6. **Headers:**
   - a CSP: `default-src 'self'`; `img-src`, `media-src` and `connect-src` limited to `'self'`, `blob:`, `data:` and
     `STORAGE_ORIGIN`; `script-src 'self' 'unsafe-inline'`; `frame-ancestors 'none'`;
   - `Referrer-Policy: no-referrer`, because presigned URLs must not leak;
   - `X-Content-Type-Options: nosniff`;
   - `poweredByHeader: false`.
7. **R2 CORS** allows GET and PUT from the console's origin only, with the `Content-Type` header. The browser now
   PUTs uploads and reads configuration JSON itself.
8. **Secrets stay on the server.** Only `NEXT_PUBLIC_CHAT_ENABLED` is public. `.env.local` is ignored by git. Keep
   Next patched: the auth lives in the request gate, and Next has had a middleware-bypass CVE (CVE-2025-29927).

## Out of scope

- Deleting the Streamlit app. That happens after the new console has been checked against the real stack, in its own
  change.
- User accounts, roles and audit logs.
- Changes to site-service.
