# Traffic Violation Console in Next.js: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Streamlit operator console as a small, deployable Next.js + shadcn/ui app in `web/`, at parity
with today's pages and locked down from the first commit.

**Architecture:** All pages are client components that call site-service through same-origin rewrites (`/api/v1/*`,
`/health`). One request gate, `proxy.ts`, does basic auth, the CSRF check and the path check. One route handler,
`/feed`, turns a site's RTSP source into MJPEG with ffmpeg. The domain logic (evidence maths, review folding,
formatting) lives in plain TypeScript modules under `lib/`, which are ported from the Python and unit-tested.

**Tech Stack:** Node 22 LTS, Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui, TanStack Query 5,
react-markdown, Recharts (through shadcn Chart), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-nextjs-console-design.md`

## Global Constraints

- Everything lives under `web/`. The Streamlit app is not touched or deleted.
- Work on branch `nextjs-console`, cut from `violation-chat`, which holds the chat being ported.
- Node ≥ 20.9 (a Next 16 floor). Install Node 22 LTS.
- The request gate is `web/proxy.ts` exporting `proxy` (the Next 16 name). It runs on the Node runtime.
- `API_BASE_URL` is server-only (default `http://localhost:8001`). The only public variable is `NEXT_PUBLIC_CHAT_ENABLED`.
- Never use `dangerouslySetInnerHTML`, and never add `rehype-raw`.
- Every API-supplied URL put into `href` or `src` goes through `safeUrl()` (Task 3).
- The scripts bind `127.0.0.1:3000`.
- `next.config.ts` sets `compress: false` (gzip would buffer the event streams) and `poweredByHeader: false`.
- Track palette `SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]`, `MUTED = "#94a3b8"`, at most 3 highlighted tracks.
- `IMPLAUSIBLE_SPEED_MS = 60`, `SPEED_WINDOW_SECONDS = 10`, `MIN_TRACK_SECONDS = 0.5`, `FALLBACK_FPS = 30`,
  `ZONE_REACH_METRES = 200`.
- Chat: poll every 1500 ms while `status === "answering"`, five questions per chat.
- User-facing sentences are ported word for word from the Python page named in each task. Plain words, no emoji.
- Use shadcn components as `npx shadcn@latest add` writes them into `web/components/ui/`.
- Commit messages follow the repo's style: one plain sentence saying what changed, no `feat:` prefix.

## Review Focus

1. **site-service down.** The rewrite answers 500 or 502 with an HTML or empty body. Expect "Could not reach the API.
   Is the stack up? `docker compose up api` in the traffic-violation repo." rather than raw HTML. Tested in Task 3
   (`ApiError` from a non-JSON 5xx).
2. **A password with `:` or non-ASCII characters.** `btoa` throws on non-Latin-1, so the comparison must encode
   UTF-8. Tested in Task 2.
3. **The event stream arriving in odd chunks**: an event split across reads, or `\r\n` line endings. Tested in Task 3
   (`parseSse`).
4. **A 500 MB video upload** must stream the `File` as the body, not be read into memory first. Tested in Task 3
   (`upload` passes the `File` itself to `fetch`).
5. **A violation with `metadata: null`, no `ground_from_pixel`, or a zone above the horizon.** Expect empty tracks,
   no zones and no crash. Tested in Task 10.

---

### Task 1: Scaffold the app with the shell, sidebar and health dot

**Files:**
- Create: `web/` (create-next-app output), `web/components.json`, `web/components/ui/*` (shadcn)
- Create: `web/app/layout.tsx`, `web/app/providers.tsx`, `web/components/app-sidebar.tsx`, `web/components/health-dot.tsx`
- Create: `web/vitest.config.ts`, `web/.env.example`
- Modify: `web/package.json` (scripts)
- Test: `web/lib/smoke.test.ts` (deleted in Task 3, when real tests exist)

**Interfaces:**
- Produces: `<Providers>` (a `QueryClientProvider` with `staleTime: 5_000` and `retry: 1`); the `@/` alias for `web/`;
  `npm test` runs Vitest; `AppSidebar` links Overview `/`, Sites `/sites`, Files `/files`.

- [ ] **Step 1: Install Node 22 with nvm.** Ask the user first, because this installs software. Then run
  `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && nvm install 22`.
  Expected: `node -v` prints `v22.x`.
- [ ] **Step 2: Create the branch and the app.**
  Run `git switch -c nextjs-console`, then
  `npx create-next-app@16 web --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm`.
  Expected: `web/app/page.tsx` exists.
- [ ] **Step 3: Install shadcn and the libraries.**
  Run `cd web && npx shadcn@latest init -d`, then
  `npx shadcn@latest add sidebar card table badge button input label select tabs collapsible dialog alert switch checkbox tooltip skeleton sonner chart`,
  then `npm i @tanstack/react-query react-markdown` and `npm i -D vitest vite-tsconfig-paths`.
- [ ] **Step 4: Set the scripts in `web/package.json`:**
  - `"dev": "next dev -H 127.0.0.1 -p 3000"`
  - `"start": "next start -H 127.0.0.1 -p 3000"`
  - `"test": "vitest run"`

  Then write `vitest.config.ts`: Node environment, `tsconfigPaths()` plugin.
- [ ] **Step 5: Write `web/.env.example`:**
  ```
  API_BASE_URL=http://localhost:8001
  CONSOLE_USER=operator
  CONSOLE_PASSWORD=
  # The R2 bucket's origin, for the CSP. Empty with STORAGE_BACKEND=local.
  STORAGE_ORIGIN=
  NEXT_PUBLIC_CHAT_ENABLED=
  ```
- [ ] **Step 6: Build the shell.**
  - `layout.tsx` wraps `<Providers>`, shadcn `SidebarProvider` + `AppSidebar`, and `<Toaster />`. Inter comes from
    `next/font/google` (self-hosted at build time, so the CSP stays `'self'`).
  - `HealthDot` uses `useQuery(["health"], () => fetch("/health"), { refetchInterval: 15_000 })`. It shows a green
    dot with "API connected" on 2xx, otherwise a red dot with "API unreachable".
- [ ] **Step 7: Write `lib/smoke.test.ts`** (`expect(1).toBe(1)`). Run `npm test && npm run build`.
  Expected: 1 passed; the build succeeds.
- [ ] **Step 8: Commit** with "Scaffold the Next.js console with shadcn/ui, a sidebar and the health dot".

### Task 2: The request gate (`proxy.ts`)

**Files:**
- Create: `web/proxy.ts`
- Test: `web/proxy.test.ts`

**Interfaces:**
- Produces: `proxy(req: NextRequest): Response | undefined` (undefined lets the request through); `config.matcher`
  excludes `_next/static`, `_next/image` and `favicon.ico`.

- [ ] **Step 1: Write the failing tests.** Build requests with
  `new NextRequest(url, { method, headers })`, and set `process.env.CONSOLE_USER = "operator"` and
  `CONSOLE_PASSWORD = "pä:ss"` in `beforeEach`. Let `auth = "Basic " + Buffer.from("operator:pä:ss").toString("base64")`.

  | Test | Request | Expect |
  |---|---|---|
  | `refuses everything when no password is set` | `CONSOLE_PASSWORD` deleted | 503 |
  | `asks for credentials` | GET `/` with no header | 401 and `WWW-Authenticate: Basic realm="console"` |
  | `refuses wrong credentials` | wrong password | 401 |
  | `lets the right credentials through, colon and umlaut included` | GET `/` with `auth` | `undefined` |
  | `refuses a cross-site write` | POST `/api/v1/sites` with `auth` and `sec-fetch-site: cross-site` | 403 |
  | `refuses a write with no fetch metadata` | POST with `auth`, no `sec-fetch-site` | 403 |
  | `lets a same-origin write through` | POST with `sec-fetch-site: same-origin` | `undefined` |
  | `refuses an encoded dot segment` | GET `/api/v1/storage/%2e%2e/sites` with `auth` | 400 |
  | `refuses an encoded slash` | GET `/api/v1/storage/a%2Fb` with `auth` | 400 |

  A raw `..` can't be tested this way, because URL parsing removes it before `proxy` runs. The regex covers it
  anyway.

- [ ] **Step 2: Run `npm test proxy`.** Expected: FAIL, `proxy` not defined.
- [ ] **Step 3: Implement `proxy` in `web/proxy.ts`.**
  - Checks run in this order: configured → credentials → path → method.
  - Build the expected header with `Buffer.from(\`${user}:${pass}\`, "utf8").toString("base64")`. Never use `btoa`.
  - The path test is `/\.\.|%2e|%2f/i` on `req.nextUrl.pathname`, applied to paths starting `/api/`.
- [ ] **Step 4: Run `npm test proxy`.** Expected: 9 passed.
- [ ] **Step 5: Commit** with "Put every request behind basic auth, a same-origin check on writes, and a path check".

### Task 3: Routing, headers and the client library

**Files:**
- Modify: `web/next.config.ts`
- Create: `web/lib/api.ts`, `web/lib/types.ts`, `web/lib/format.ts`, `web/lib/status.ts`, `web/components/status-badge.tsx`, `web/components/notice.tsx`
- Test: `web/lib/api.test.ts`, `web/lib/format.test.ts`
- Delete: `web/lib/smoke.test.ts`

**Interfaces:**
- Produces (`lib/api.ts`):
  - `class ApiError extends Error { status: number; detail: string }`
  - `request<T>(method: string, path: string, body?: unknown): Promise<T>`. The path is relative to `/api/v1`. It
    returns `undefined` on 204 or an empty body.
  - `get<T>(path)`, `post<T>(path, body?)`, `del(path)`
  - `getOrNull<T>(path, when?: (e: ApiError) => boolean): Promise<T | null>`. The default `when` is `status === 404`.
  - `allSites(): Promise<Site[]>` (pages of 100 until `total`)
  - `signedHeaders(url: string): Set<string>`
  - `upload(file: File, type: FileType): Promise<FileRow>`
  - `parseSse(text: string): { events: StreamEvent[]; rest: string }`
  - `streamEvents(path: string, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void>`. It resolves
    when the stream ends.
  - `readEvents(path: string): Promise<StreamEvent[]>`, collecting a stream that ends by itself.
  - `CHAT_ENABLED: boolean`
- Produces (`lib/types.ts`): `Page<T> = { items: T[]; total: number; limit: number; offset: number }`, plus `Site`,
  `Source`, `FileRow`, `Doc`, `Run`, `Session`, `ViolationSummary`, `Violation`, `ReviewState`, `ChatSummary`, `Chat`, `ChatTurn` and
  `StreamEvent = { type: string; sequence?: number; elapsed_seconds?: number; data?: any }`. Copy the field names
  from the Python call sites and the Postman collection, typing only the fields the pages read.
- Produces (`lib/format.ts`): `ts(iso, withSeconds = true)`, `bytesHuman(n)`, `frameTime(frame, fps)`,
  `eventTime(source, frame, detectedAt)`, `runSpan(source, run)`, `unescapeText<T>(value: T): T`, and
  `safeUrl(url?: string | null): string | undefined`.
- Produces (`lib/status.ts`): `CHIPS: Record<string, [bg: string, fg: string]>` (the exact table from `lib/ui.py:37-76`)
  and `reviewLabel(status)` (`lib/review.py:317-324`).
- Produces (components): `<StatusBadge value label? prefix?>`, which renders "none" in slate for `null`; and
  `<Empty message hint?>` and `<ErrorAlert error>` in `notice.tsx`.

- [ ] **Step 1: Write the failing tests in `api.test.ts`.** Stub `globalThis.fetch` with `vi.fn`.
  - `request` sends `/api/v1/sites` with a JSON body.
  - A 422 with `{detail: [{loc: ["body", "name"], msg: "Field required"}]}` throws `ApiError` with detail
    `"name: Field required"`.
  - A 409 with `{detail: "busy"}` gives detail `"busy"`.
  - **Review Focus 1:** a 502 with body `"<html>Bad Gateway</html>"` throws `ApiError` with status 502 and detail
    `"Could not reach the API. Is the stack up? \`docker compose up api\` in the traffic-violation repo."`. The same
    holds for a 500 with an empty body.
  - `getOrNull` returns `null` on 404 and rethrows 500.
  - `signedHeaders("https://r2/x?X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost")` equals
    `new Set(["content-length", "content-type", "host"])`. With no parameter it is empty.
  - `upload` calls POST `/files`, then PUT, then POST `/files/{id}/complete`:
    - the PUT's `body` is the very `File` object (**Review Focus 4**);
    - the PUT sends `Content-Type` only when `signedHeaders` has it;
    - it throws `ApiError(400, …)` when the URL is signed with a content type but the file has none.
  - **Review Focus 3, `parseSse`:**
    - `"event: replay\ndata:\n\ndata: {\"type\":\"step\"}\n\n"` gives `[{type: "replay"}, {type: "step"}]`;
    - `"data: {\"a\":1}\r\n\r\n"` gives one event;
    - `"data: {\"a\":"` gives no events with `rest === "data: {\"a\":"`.
- [ ] **Step 2: Write the failing tests in `format.test.ts`.**
  - `unescapeText({a: ["x\\u2014y"]})` deep-equals `{a: ["x—y"]}`.
  - `unescapeText("\\ud83d\\ude00")` is `"😀"`.
  - A lone `"\\ud800"` stays as the escape.
  - `safeUrl("javascript:alert(1)")`, `safeUrl("//evil.com/x")` and `safeUrl("data:text/html,x")` are `undefined`.
  - `safeUrl("/api/v1/storage/a.mp4")` and `safeUrl("https://r2.example/a?b=c")` pass through.
  - `frameTime(90, 30)` is `"frame 90 · 0:03"`, and `frameTime(90, null)` is `"frame 90"`.
- [ ] **Step 3: Run `npm test`.** Expected: FAIL, the modules don't exist yet.
- [ ] **Step 4: Implement the three `lib/` modules.**
  - `detailOf` ports `lib/api.py:543-564`. A non-JSON 5xx, or a 5xx with an empty body, becomes the "Could not
    reach" sentence.
  - `fetch` failures (TypeError) also become `ApiError(0, "Could not reach the API. …")`.
  - `streamEvents` reads `res.body` with a `TextDecoder`, feeds `parseSse`, and throws `ApiError` on 4xx/5xx before
    reading. It always uses `fetch`, never `EventSource`, which reconnects and replays when the stream ends.
  - `unescapeText` ports `lib/ui.py:385-428`.
  - `safeUrl` allows `http:` and `https:` absolute URLs, and paths starting with a single `/`.
- [ ] **Step 5: Write `next.config.ts`.**
  - `rewrites()` returns `/api/v1/:path*` → `${API_BASE_URL}/api/v1/:path*` and `/health` → `${API_BASE_URL}/health`.
  - `headers()` applies the CSP from the spec's Security §6 to `/:path*`, where `S` is `process.env.STORAGE_ORIGIN`
    or empty:
    ```
    default-src 'self'; img-src 'self' blob: data: S; media-src 'self' blob: S; connect-src 'self' S;
    script-src 'self' 'unsafe-inline' ('unsafe-eval' in development only); style-src 'self' 'unsafe-inline';
    frame-ancestors 'none'; base-uri 'self'; form-action 'self'
    ```
  - Also send `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`.
  - Set `compress: false` and `poweredByHeader: false`.
- [ ] **Step 6: Run `npm test`, then check it against the running stack.**
  Run `npm run dev`, then
  `curl -si -u operator:$CONSOLE_PASSWORD http://127.0.0.1:3000/health`.
  Expected: tests pass; curl shows `200`, the CSP header and no `X-Powered-By`.
- [ ] **Step 7: Commit** with "Relay the API through rewrites, send security headers, and add the client library".

### Task 4: The Files page and the upload form

**Files:**
- Create: `web/components/upload-form.tsx`, `web/app/files/page.tsx`

**Interfaces:**
- Consumes: `upload`, `get`, `safeUrl`, `StatusBadge`, `bytesHuman`
- Produces: `<UploadForm types={FileType[]} accept?: string onUploaded={(f: FileRow) => void} />`, used by Setup in
  Task 6.

- [ ] **Step 1: Build `UploadForm`.** It has a file input, a type `Select` (hidden when `types.length === 1`) and an
  Upload button. It calls `upload` in a `useMutation`, shows `toast.success` with the file id, and shows
  `ErrorAlert` on failure.
- [ ] **Step 2: Build `/files`.** It has two tabs, ported from `pages/5_Files.py`:
  - **Upload:** the form, plus a table of this visit's uploads (kept in component state);
  - **Find by ID:** the id goes to `get(\`/files/${id}\`)`. Show the name, type and status badges, size, and created
    time. If it is a video, add `<video src={safeUrl(download_url)} controls />`.
- [ ] **Step 3: Check it against the stack.** Upload a small `.json` as a configuration, then find it by id.
  Expected: status "uploaded". Then upload an `.mp4` video and play it.
- [ ] **Step 4: Commit** with "Add the Files page: upload without attaching, and look up by id".

### Task 5: The Sites page

**Files:**
- Create: `web/app/sites/page.tsx`, `web/components/create-site-dialog.tsx`, `web/components/delete-site-dialog.tsx`

**Interfaces:**
- Consumes: `get<Page<Site>>("/sites?limit=20&offset=N&kind=K")`, `post("/sites", {name, source?})`,
  `del("/sites/{id}")`

- [ ] **Step 1: Build the list.** It is a table of sites (name, source badge and label, created) with a kind filter
  (all, video, stream) and paging by 20. Each row links to `/sites/{id}?tab=view` and `?tab=setup`.
- [ ] **Step 2: Build `CreateSiteDialog`.** It has a name, an "Add a live camera feed link now" checkbox, and a stream
  URL. Copy and validation come from `pages/1_Sites.py:20-60`. The body omits `source` when there is no URL.
- [ ] **Step 3: Build `DeleteSiteDialog`.** The Delete button stays disabled until the typed text equals the site's
  name.
- [ ] **Step 4: Check it against the stack.** Create a site, check that the filter shows it, then delete it.
- [ ] **Step 5: Commit** with "Add the Sites page: list, filter, create and delete".

### Task 6: The site page and its Setup tab

**Files:**
- Create: `web/app/sites/[siteId]/page.tsx`, `web/components/site/setup-tab.tsx`, `web/components/site/document-card.tsx`

**Interfaces:**
- Consumes: `UploadForm`, `getOrNull("/sites/{id}/{calibrations|configurations|sources}")`,
  `post(".../{resource}", {file_id})`, `post(".../{resource}/{docId}/invalidate", {reason})` (returns
  `{invalidated: number}`), `post(".../sources", {kind, file_id | stream_url})`
- Produces: the site page, which reads `?tab=` (default `view`) and renders shadcn `Tabs` for View, Setup and
  Detection. The View and Detection panels are placeholders until Tasks 7 and 14 fill them. The header carries the
  site name and a "Violations" link to `/sites/{id}/violations`.

- [ ] **Step 1: Build the page shell and `DocumentCard`.**
  - The card is used once for calibrations and once for configurations.
  - It shows the active version and a download link (`safeUrl`).
  - It has an `UploadForm` for that type, which attaches the uploaded file.
  - An "Invalidate this version's runs" collapsible takes a reason and reports
    "N runs marked invalid".
  - The copy comes from `pages/2_Site_Setup.py:100-200`.
- [ ] **Step 2: Build the source section.** It shows the active source (badge and label), then two tabs:
  - "Upload a video": `accept=".mp4,.mov,.mkv,.avi"`, which uploads and then creates the source;
  - "Use a live camera feed": a URL that creates the source.
- [ ] **Step 3: Build the "Ready to detect?" checklist.** The four checks and the caption come from
  `pages/2_Site_Setup.py:312-341`. The button switches to `?tab=detection` once the first two pass.
- [ ] **Step 4: Check it against the stack.** Take a fresh site from nothing to all four checks ticked.
- [ ] **Step 5: Commit** with "Add the site page with its Setup tab".

### Task 7: The Detection tab

**Files:**
- Create: `web/components/site/detection-tab.tsx`

**Interfaces:**
- Consumes: `post("/sites/{id}/detect", types.length ? {types} : {})`,
  `post("/sites/{id}/sources/{sourceId}/stop")` (409 means "This feed is not being recorded."),
  `get<Page<Run>>("/sites/{id}/runs?limit=20")`, `runSpan`, `StatusBadge`

- [ ] **Step 1: Build the tab.**
  - Source summary.
  - Violation-type checkboxes for `red_light_running` and `pedestrian_right_of_way`. When none is ticked, show the
    caption "None selected: every switched-on violation type will be checked."
  - "Start detection", disabled unless the source is a stream or has `metadata.fps`.
  - "Stop recording" for streams.
  - A "Last session started" card.
  - The runs table, refetched every 3 s while any run is queued or running.
  - A "Review violations" link.
  - All copy comes from `pages/3_Detection.py`.
- [ ] **Step 2: Check it against the stack.** Start detection on a video and watch runs go from queued to running to
  completed.
- [ ] **Step 3: Commit** with "Add the Detection tab: start, stop, and follow runs".

### Task 8: Overview

**Files:**
- Modify: `web/app/page.tsx`
- Create: `web/lib/overview.ts`
- Test: `web/lib/overview.test.ts`

**Interfaces:**
- Consumes: `allSites`, `get<Page<ViolationSummary>>("/sites/{id}/violations?limit=100&offset=N")` (at most 500 per
  site, as in `MAX_PER_SITE`), `get<Page<Run>>("/sites/{id}/runs?limit=20")`
- Produces: `summarise(sites, violations, runs): { tiles: {sites, streams, violations, awaiting, reviewed, pending, failed, busy, failedRuns}, perDay: {day: string, count: number}[], bySite: {site: string, count: number}[] }`

- [ ] **Step 1: Write the failing tests.** Use 2 sites, 3 violations (`explanation_status` detected, explained,
  pending, on two days in `Asia/Jakarta`), and runs queued and failed. Expect:
  - `tiles` equals `{sites: 2, streams: 1, violations: 3, awaiting: 1, reviewed: 1, pending: 1, failed: 0, busy: 1, failedRuns: 1}`;
  - `perDay` has 2 entries in date order;
  - `bySite` includes the site with 0 violations.
- [ ] **Step 2: Run `npm test overview`.** Expected: FAIL.
- [ ] **Step 3: Implement `summarise`.** It is a pure function. Days are bucketed in the local time zone (`ui.LOCAL_TZ`
  in `lib/ui.py`).
- [ ] **Step 4: Run `npm test overview`.** Expected: PASS.
- [ ] **Step 5: Build the page.**
  - Five tiles, with help text from `pages/0_Overview.py:70-95`.
  - A shadcn bar chart per day and a horizontal bar chart by site, both in `SERIES[0]`.
  - The sites table, where a row links to the site.
  - The 12 most recent runs.
  - A Refresh button that runs `invalidateQueries(["overview"])`.
- [ ] **Step 6: Commit** with "Add the Overview: key figures, violations per day and per site, sites and runs".

### Task 9: The violations queue

**Files:**
- Create: `web/app/sites/[siteId]/violations/page.tsx`

**Interfaces:**
- Consumes: `get<Page<ViolationSummary>>("/sites/{id}/violations?limit=12&offset=N&run_id=R")`, runs for the filter,
  `reviewLabel`, `StatusBadge`, `safeUrl(thumbnail_url)`

- [ ] **Step 1: Build the gallery.**
  - A run filter `Select`, kept in `?run=`.
  - A row of counts by review status.
  - "Showing a–b of N".
  - A grid of three cards: thumbnail, type, review and evidence badges, event time, "Open".
  - The empty and pending thumbnail copy comes from `pages/4_Violations.py:403-430`.
- [ ] **Step 2: Check it against the stack**, with violations from Task 7's run.
- [ ] **Step 3: Commit** with "Add the violations queue, filterable by run".

### Task 10: Evidence maths

**Files:**
- Create: `web/lib/evidence.ts`
- Test: `web/lib/evidence.test.ts`

**Interfaces:**
- Produces:
  - `type Track = { trackId: number; kind: "vehicle" | "pedestrian"; frameIdxs: number[]; bboxes: number[][]; trajectory: (number[] | null)[]; speed: (number | null)[] }`
  - `label(t)` gives `"veh #7"`.
  - `tracksOf(metadata)` gives vehicles, then pedestrians.
  - `sampleAt(t, frame)` returns the nearest index within 15 frames, or `null`.
  - `bboxAt(t, frame)`, `speedAt(t, frame)`
  - `involved(tracks, violatorId, configuration, frame, fps)`
  - `colourMap(ids): Map<number, string>`
  - `implausible(tracks, colours): number | null`
  - `project(h, [x, y]): [number, number] | null`
  - `cameraView(metadata, size): ((x, y) => [number, number]) | null`
  - `groundZones(metadata, configuration): { zone: string; kind: "zone" | "edge"; label: string; points: [number, number][] }[]`
  - `padded(values, share = 0.15, least = 2): [number, number]`
  - `within(points, centre): boolean`
  - `placeLabels(labels: {x, y, w, h}[], imageWidth): {x, y}[]`
  - The constants listed under Global Constraints.

  Each one ports the function of the same name in `lib/evidence.py`. `placeLabels` ports the nudge loop at
  `lib/evidence.py:287-309`.

- [ ] **Step 1: Write the failing tests.**
  - `tracksOf(null)` is `[]`.
  - `tracksOf({vehicles: [{track_id: 1, frame_idxs: [0, 30]}], pedestrians: [{track_id: 2}]})` maps to kinds
    `["vehicle", "pedestrian"]`.
  - `sampleAt` at frame 20 on `[0, 30]` gives index 1; on `[0, 100]` it gives `null`.
  - `involved` returns the violator first, then pedestrians most-time-in-zone first. It skips a pedestrian with fewer
    than 15 samples at 30 fps. Without a violator it returns everyone present at the frame.
  - `colourMap([5, 9])` maps 5 to `#2a78d6` and 9 to `#eb6834`.
  - `implausible` is `61` for a selected track with speed 61, and `null` at speed 59 or when the track is not
    selected.
  - `project` with the identity matrix gives `[3, 4]`; with a row giving w ≤ 0 it gives `null`.
  - **Review Focus 5:**
    - `groundZones(null, cfg)` is `[]`;
    - `groundZones({ground_from_pixel: H}, cfg)` drops a zone with one point above the horizon and keeps the
      others, rings closed;
    - an edge `{near_kerb: [0, 1]}` becomes kind `"edge"` with label `"near kerb"`;
    - `cameraView({}, [1920, 1080])` is `null`.
  - `placeLabels` puts two labels at the same spot at distinct `y` values, and keeps `x + w ≤ imageWidth`.
- [ ] **Step 2: Run `npm test evidence`.** Expected: FAIL.
- [ ] **Step 3: Implement `lib/evidence.ts`** by porting the Python. No pandas: rows are arrays of objects.
- [ ] **Step 4: Run `npm test evidence`.** Expected: PASS.
- [ ] **Step 5: Commit** with "Port the evidence maths: tracks, involved road users, projection, zones".

### Task 11: The violation page: evidence, paths and speeds

**Files:**
- Create: `web/app/sites/[siteId]/violations/[violationId]/page.tsx`, `web/components/evidence/boxes-overlay.tsx`,
  `web/components/evidence/ground-plot.tsx`, `web/components/evidence/speed-chart.tsx`,
  `web/components/evidence/track-picker.tsx`

**Interfaces:**
- Consumes: Task 10's functions.
  - `get<Violation>("/sites/{id}/violations/{vid}")`
  - `getOrNull<Source>("/sites/{id}/sources/{source_id}")` for `metadata.fps` and `metadata.resolution`
  - The configuration it was judged under: `get<Doc>(".../configurations/{configuration_id}")`, then
    `get<FileRow>("/files/{file_id}")`, then `fetch(download_url).json()`, cached with `staleTime: Infinity`
- Produces: the page layout. The review and chat slots, beside the evidence, are left empty for Tasks 12 and 13.
  - `<BoxesOverlay src tracks frame sourceSize colours violatorId>`
  - `<GroundPlot tracks colours fps violationT zones view>`
  - `<SpeedChart tracks colours fps violationT>`

- [ ] **Step 1: Build the page header and captions.** The id, frame time, processed time, the pinned versions line,
  and the no-evidence note all come from `pages/4_Violations.py:76-110`.
- [ ] **Step 2: Build `TrackPicker`.** It is checkboxes over `involved(...)`, with the first three checked by default
  and a fourth refused. The help copy comes from `pages/4_Violations.py:125-140`.
- [ ] **Step 3: Build `BoxesOverlay`.**
  - An `<img>` with an absolutely positioned `<svg viewBox="0 0 W H">`, where W×H is the source size or the image's
    natural size.
  - Per box: a black halo at 150 alpha, then the colour or `MUTED`. The violator's stroke is one wider.
  - Only selected tracks and the violator get labels: "veh #7 · violator 12.3 m/s", with one decimal below 100 and
    none above.
  - Labels are placed by `placeLabels`, using a text-width estimate of `0.6 × fontSize × characters`.
- [ ] **Step 4: Build `GroundPlot`** as a hand-written SVG with equal-aspect axes from `padded`.
  - Zones are dashed `#64748b` and clipped, edges are 3 px wide at 0.6 opacity, and labels are as in
    `_zone_marks`. Only zones passing `within` are drawn.
  - Track paths are drawn in their colours, with end labels and a diamond at the violation moment.
  - Point tooltips come from the SVG `<title>`.
  - Axis titles are "across the picture (m)" and "into the picture (m)" with a view, otherwise "ground plane x (m)"
    and "ground plane y (m)".
- [ ] **Step 5: Build `SpeedChart`.** It is a shadcn `LineChart` over the last 10 s, with a domain pinned to
  `[end - 10, end]` and a `ReferenceLine` at the violation moment.
- [ ] **Step 6: Add the implausible-speed `Alert`, the empty states and the "Road users involved" collapsible.** Copy
  comes from `pages/4_Violations.py:268-345`.
- [ ] **Step 7: Check it against the stack.** Open a pedestrian violation and compare it side by side with the
  Streamlit page (`streamlit run serve.py`): same boxes, same colours, zones in the same places, the diamond at the
  same point.
- [ ] **Step 8: Commit** with "Add the violation page: boxes over the frame, the top-down paths and speeds".

### Task 12: The evidence review, followed live

**Files:**
- Create: `web/lib/progress.ts`, `web/components/review-panel.tsx`, `web/components/markdown.tsx`
- Test: `web/lib/progress.test.ts`

**Interfaces:**
- Produces:
  - `type Progress`: the fields of `lib/review.py:48-73`, with `writing: Record<string, string>` keyed
    `"${field}:${index}"`.
  - `emptyProgress()`, `fold(p: Progress, e: StreamEvent): Progress` (returns a new object), `collect(events)`,
    `totals(p): string`.
  - `<Markdown text>`: react-markdown over `unescapeText(text)`, with links passed through `safeUrl`.
  - `<ReviewPanel siteId violationId status>`.
- Consumes: `getOrNull<ReviewState>(".../review", e => e.status === 404 && e.detail.includes("not been reviewed"))`,
  `post(".../review")`, `streamEvents(".../review/events?after=-1", …, signal)`

- [ ] **Step 1: Write the failing tests.**
  - A `replay` event sets `replay` and adds nothing to `events`.
  - A `facts` event with two `vehicle` facts and one `pedestrian` fact adds the timeline line
    `"The tracking gives 2 vehicle, 1 pedestrian facts"`.
  - Two `thinking` events add one timeline line starting `"Thinking... "`.
  - A `question` followed by an `answer` with the same tool and turn fills `exchanges[0].answer`, and adds
    `"The legal source answered in 31 s"`.
  - A `writing` event for `source_as_cited` is ignored.
  - `done` sets `model`.
  - `totals` of a `done` with `{model: "m", model_calls: 3, rag_turns: 2, cost_usd: 0.12, tokens: {input: 1000, output: 234}}`
    and `elapsed_seconds: 61` is `"m · 3 model calls · 2 legal turns · $0.12 · 1,234 tokens · 61s"`.
- [ ] **Step 2: Run `npm test progress`.** Expected: FAIL.
- [ ] **Step 3: Implement `lib/progress.ts`** by porting `Progress.add`, `collect` and `totals` from `lib/review.py`.
- [ ] **Step 4: Run `npm test progress`.** Expected: PASS.
- [ ] **Step 5: Build `ReviewPanel`.**
  - When the status is `pending`, or right after Start, it follows the stream in a `useEffect` with an
    `AbortController`. It folds the events into state, rendering at most every 250 ms. At the end it invalidates the
    review and violation queries.
  - If the stream throws or ends without a `done` or `error` event, it shows "Lost the review's stream. The review
    goes on without this page; reload to follow it again."
  - A completed review is drawn as in `review.draw` (`lib/review.py:172-219`): the flag banner, the clerk card,
    summary, driver and site advice, candidate rules and "Still unsure".
  - A failed review shows its error and "Review again".
  - The start button shows "Start the review" or "Review again", with the "Safe to press more than once" caption.
  - "Show the steps it took" (a `Switch`) reads the events once with `readEvents` and caches them on `updated_at`.
    It renders the timeline and a "Download the steps (JSON)" link through a `Blob` URL.
- [ ] **Step 6: Check it against the stack.** Start a review and watch the steps arrive one by one (not all at the
  end, which would mean compression is buffering). Reload partway and check it picks the stream back up.
- [ ] **Step 7: Commit** with "Follow the evidence review live and draw the finished one".

### Task 13: The chat

**Files:**
- Create: `web/components/chat-panel.tsx`

**Interfaces:**
- Consumes:
  - `get<ChatSummary[]>(".../chats")` (404 means the chat is off on the backend)
  - `post(".../chats")`, `get<Chat>(".../chats/{cid}")`, `post(".../chats/{cid}/messages", {text})` (409 means it is
    still answering), `del(".../chats/{cid}")`
  - `readEvents(".../chats/{cid}/events?after=N&paced=false")`
  - `fold`, `collect`, `totals`, `Markdown`
- Produces: `<ChatPanel siteId violationId>`, rendered under `ReviewPanel` only when `CHAT_ENABLED`.

- [ ] **Step 1: Build the panel**, ported from `lib/chat.py:61-142`.
  - A chat `Select` with "New chat" and "{title} · N questions", and Delete.
  - The turns, each with an assistant reply or error, and a "How it answered: steps" collapsible showing events in
    `[first_event, last_event]` and `totals`.
  - While answering, `refetchInterval: 1500` on the chat and on the events read with `after = last turn's first_event`.
    It shows "Answering…" with the steps, and "Waiting for the legal source; it usually takes 25 to 35 s." when the
    last exchange has no answer yet.
  - The input is disabled while answering. After 5 questions it is disabled with the placeholder "This chat has had
    its five questions; start a new chat."
  - On a 404 from the chat list, show "The chat is off on this backend: set CHAT_ENABLED for site-service."
- [ ] **Step 2: Check it against the stack**, with `CHAT_ENABLED=1` on both sides. Ask two questions, delete the chat,
  and check that a 404 backend shows the "off" note.
- [ ] **Step 3: Commit** with "Ask about a violation in a chat under its review".

### Task 14: The live feed route and the View tab

**Files:**
- Create: `web/lib/feed.ts`, `web/app/feed/route.ts`, `web/components/site/view-tab.tsx`, `web/components/regions-overlay.tsx`
- Test: `web/lib/feed.test.ts`, `web/app/feed/route.test.ts`

**Interfaces:**
- Produces (`lib/feed.ts`, server-only):
  - `allowedFeedUrl(url: string): URL | null`, allowing only `rtsp:`, `rtsps:`, `http:` and `https:`.
  - `reachable(url: URL): Promise<URL>`, which ports `lib/live.py:138-154` with `dns.promises.lookup`.
  - `ffmpegArgs(url: URL): string[]`, which returns:
    ```
    ["-hide_banner", "-loglevel", "error", ...(rtsp ? ["-rtsp_transport", "tcp"] : []),
     "-protocol_whitelist", "rtsp,rtsps,rtp,udp,tcp,tls,http,https",
     "-i", url.href, "-vf", "fps=2", "-q:v", "5", "-f", "mpjpeg", "-"]
    ```
  - `MAX_FEEDS = 4`.
- Produces (route): `GET /feed?site=<uuid>`. It returns 200 with
  `Content-Type: multipart/x-mixed-replace;boundary=ffmpeg`, streaming ffmpeg's stdout.
  - 400 when `site` is not a UUID.
  - 404 when there is no source, or the source is not a stream.
  - 422 when the URL is refused.
  - 429 when `MAX_FEEDS` are running.
  - It kills ffmpeg on `req.signal` abort and on stream cancel.
- Produces (components): `<RegionsOverlay document size layers>`, an SVG over an `<img>` or `<video>` that draws
  lanes, ROIs and traffic lights in `SERIES[0..2]`.

- [ ] **Step 1: Write the failing tests.**
  - In `feed.test.ts`:
    - `allowedFeedUrl` returns `null` for `file:///etc/passwd`, `concat:a|b`, `gopher://x` and
      `"not a url"`;
    - it returns a URL for `rtsp://cam/1`;
    - `ffmpegArgs(new URL("rtsp://cam/1"))` contains `"-rtsp_transport"` and has the whitelist before `"-i"`.
  - In `route.test.ts`, mock `fetch` and `node:child_process`:
    - `?site=../x` gives 400;
    - a video source gives 404;
    - `stream_url: "file:///etc/passwd"` gives 422 and `spawn` is never called;
    - a fifth concurrent request gives 429;
    - aborting the request calls `kill()` on the child.
- [ ] **Step 2: Run `npm test feed`.** Expected: FAIL.
- [ ] **Step 3: Implement `lib/feed.ts` and `app/feed/route.ts`.**
  - The route sets `export const runtime = "nodejs"` and `dynamic = "force-dynamic"`.
  - It reads the source from `${process.env.API_BASE_URL}/api/v1/sites/${site}/sources`.
  - Spawn ffmpeg with `spawn("ffmpeg", args)`, never through a shell.
  - Running processes are counted in a module-level `Set`.
- [ ] **Step 4: Run `npm test feed`.** Expected: PASS.
- [ ] **Step 5: Build the View tab.**
  - Layer switches for lanes, ROIs and traffic lights.
  - A video source plays `<video src={safeUrl(download_url)}>` under `RegionsOverlay`.
  - A stream source shows `<img src={\`/feed?site=${id}\`}>` under the overlay, behind a "Watch live" switch, so
    nothing runs until it is on.
  - The drawn size comes from `drawnSize` (ported from `lib/live.py:80-88`).
  - The copy comes from `pages/2_Site_View.py`.
- [ ] **Step 6: Check it against the stack.** Watch the compose stack's RTSP feed (`tv-rtsp`). Close the tab and check
  that `pgrep ffmpeg` is empty within a few seconds.
- [ ] **Step 7: Commit** with "Watch a site's live feed through ffmpeg, with its regions over the picture".

### Task 15: README and the full check

**Files:**
- Create: `web/README.md`
- Modify: `README.md` (one paragraph pointing at `web/`)

- [ ] **Step 1: Write `web/README.md`.**
  - How to run it, including the `.env.local` variables.
  - "Putting it on a network": a TLS reverse proxy, and the R2 CORS rule (GET and PUT from the console origin, with
    the `Content-Type` header).
  - The page table.
  - "Things that are the way they are for a reason", carried from the root README with the Next.js changes from the
    spec's "Behaviour that changes".
- [ ] **Step 2: Run the whole check.**
  - `npm test && npm run lint && npm run build` must all pass.
  - Then, against `docker compose up` in `../traffic-violation`: walk a site from creation to setup, detection, the
    queue, a violation, a review and a chat.
  - Then
    `curl -s -o /dev/null -w "%{http_code}" -X POST -u operator:$CONSOLE_PASSWORD -H "Sec-Fetch-Site: cross-site" http://127.0.0.1:3000/api/v1/sites`
    must print `403`.
- [ ] **Step 3: Commit** with "Document the Next.js console and how to put it on a network".
