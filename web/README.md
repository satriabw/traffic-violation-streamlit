# Traffic Violation Console

The Next.js operator console for site-service. Site setup, detection, evidence, review, chat and live viewing share one authenticated workspace.

## Run locally

Use Node **26.13.0 or newer** and npm. Install **ffmpeg** on the console host to watch live feeds. Start site-service from the sibling backend repository:

```bash
cd ../traffic-violation
docker compose up
```

In this repository:

```bash
cd web
npm ci
cp .env.example .env.local
# Set a nonempty CONSOLE_USER and CONSOLE_PASSWORD in .env.local.
npm run dev
```

Open <http://127.0.0.1:3000> and sign in on the login page with those credentials. Both development and production bind loopback. If either credential is missing, the console refuses requests with 503. For production:

```bash
npm run build
npm start
```

| Variable | Purpose |
|---|---|
| `API_BASE_URL` | Server-only site-service address, default `http://localhost:8001`. Used by rewrites and the live feed route. |
| `CONSOLE_USER`, `CONSOLE_PASSWORD` | Required console login credentials; keep them on the server. |
| `STORAGE_ORIGIN` | R2 storage origin permitted by the content security policy; empty for local storage. |
| `NEXT_PUBLIC_CHAT_ENABLED` | Set to `1`, `true` or `yes` to display chat; build again after changing it. The backend must also enable `CHAT_ENABLED`. |

Changes to server configuration require a restart. Rebuild when changing API rewrite settings, the storage CSP origin or public flags for production. No browser-side API address is needed: API calls, health and local storage downloads use the console origin.

## Putting it on a network

Run the Node server behind a TLS reverse proxy. Forward the console port only, preserve Authorization and browser fetch-metadata headers, and disable response buffering for review event streams and `/feed`. Keep proxy read timeouts long enough for reviews and live viewing. The built-in API rewrite uses a ten-minute idle timeout so a legal-source wait does not cut off SSE. Sign-in and session cookies need HTTPS on a network. This is a Node deployment with ffmpeg, rather than a static export or an Edge function.

For R2, configure CORS on the bucket to allow **GET and PUT from the console's exact HTTPS origin**, with `Content-Type` allowed. Set `STORAGE_ORIGIN` to the bucket/download origin. Browsers upload files and read configuration JSON directly; presigned URLs must be reachable by the browser. Local storage needs no bucket CORS rule: `/api/v1/storage/...` passes through the same-origin API rewrite, including byte-range video requests.

Example bucket CORS rule (replace the origin):

```json
[{
  "AllowedOrigins": ["https://console.example.com"],
  "AllowedMethods": ["GET", "PUT"],
  "AllowedHeaders": ["Content-Type"]
}]
```

The request gate protects pages, API requests and feeds. Browsers sign in at `/login` and receive an HttpOnly, SameSite=Lax session cookie for eight hours; HTTPS cookies are Secure. Signing out clears the cookie, and changing either configured credential invalidates existing sessions. Page requests return to their original destination after sign-in; unauthenticated API and feed requests return 401 without a browser password prompt. Login throttles ten failed attempts per minute per Node process. Command-line clients can continue to use Basic auth; browser requests use the session cookie. Writes require `Sec-Fetch-Site: same-origin`. A command-line write must explicitly supply that header along with Basic auth. Responses include a CSP, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`; API paths containing traversal or encoded separators are refused.

## Pages

| Route | What it does |
|---|---|
| `/` | Overview figures, violations per day/site, sites and recent runs |
| `/sites` | Filter, create and remove sites from the console; deletion requires typing the name |
| `/site-view?site=` | Current video or live feed with configuration layers |
| `/site-setup?site=` | Upload and attach source, configuration and calibration; readiness checks |
| `/detection?site=` | Start detection, stop stream recording, follow runs |
| `/violations?site=&run=` | Paged violation queue with a run filter |
| `/sites/[siteId]/violations/[violationId]` | Evidence, paths, speeds, live review and a link to Chat |
| `/chat?site=&violation=` | Evidence clip beside the conversation, with a violation picker |
| `/files` | Upload without attaching, or look up a file by ID |

The sidebar follows the Streamlit navigation: Monitoring (Overview, Site view, Violations, Chat), Operations (Detection), and Setup (Sites, Site setup, Files). Setup uses Source, Scene configuration and Camera calibration tabs, showing one form at a time with current-source details beside it. Its shadcn/ui site selector carries the chosen site between pages through the URL. Chat is shown when enabled. Older site/tab links redirect to the corresponding page, and existing violation detail links continue to work.

## Things that are the way they are for a reason

**The upload sends the headers the URL says it was signed with.** The client reads `X-Amz-SignedHeaders` and sends the signed `Content-Type` only when required. The browser supplies Host and Content-Length. The original File streams directly without reading a whole video into memory. When MIME is unsigned, a Request removes the automatically inferred Content-Type. Same-origin credentials permit gated local uploads; external storage receives no ambient console credentials.

**Trajectories are not drawn over the image.** Boxes are pixels; trajectories are metres on the ground plane. Perspective makes the same on-screen gap represent very different distances. Boxes go on the thumbnail, paths go in their own top-down plot.

**Zones cross over the other way: from pixels to the ground.** The violation's own `ground_from_pixel` projects the configuration it was judged under, by ID. Zones are dashed and named edges such as kerbs are thick. A zone with any point at or above the projection horizon is omitted whole. Axes follow the tracks so distant zones do not shrink the useful paths. No active-configuration substitution is made for historical evidence.

**Boxes are drawn at read time, not baked in.** The evidence worker stores a clean frame, so improving the overlay improves old records too.

**Three tracks are colourable at a time.** The palette is `#2a78d6`, `#eb6834`, `#1baf7a`; direct labels make paths identifiable. Other road users remain outlined in grey (`#94a3b8`).

**The review is followed, not polled.** Starting it returns immediately; the actor writes SSE events that the console follows with an AbortController and at most four redraws per second. Leaving the page stops following, not the backend review. A broken stream explains how to resume. Completed/failed steps are fetched only when requested and cached on `updated_at`; the download is raw JSON. The detailed trace appears at full width above the optional road-user analysis. The default violation view focuses on the clip and clerk recommendation; supporting findings, paths, key-frame overlays and record metadata expand only when needed. The trace restores the developer view: legal citations per turn, what each recommendation rests on, tracking facts, model/tool calls, full event payloads and Markdown/JSON downloads. Adjacent text deltas are grouped for reading; the raw events remain intact.

**Chat keeps the evidence in view.** The short violation clip appears beside the conversation on desktop, with its thumbnail as a poster before playback. On mobile the evidence sits above the messages and can collapse. Messages scroll independently on desktop; the composer stays below them. Enter sends, Shift+Enter adds a line. When a clip is missing or cannot play, the available evidence image remains visible.

**Chat is polled only while answering.** Chat and its events refresh every 1.5 seconds during an answer. Replies include collapsible steps, each scoped to that question's inclusive event range. Five questions are allowed per chat; a new chat starts from the violation again. A 404 from the chat list means the backend flag is off; other failures remain errors.

**The review lives in the violation's explanation columns.** `detected` means not reviewed, `pending` means reviewing, `explained` means reviewed, and `failed` means review failed. The UI uses those review words.

**`evidence_status: null` is not `pending`.** Null marks old records for which evidence will never be built. It is grey and says “none”.

**The violation queue follows active documents.** The API matches the site's active calibration and configuration by ID. Attaching a new version can remove older violations from the list; their detail endpoints remain available. The run filter selects a detection run within that queue.

**Speeds are sanity-checked.** Selected tracks over 60 m/s raise a calibration warning. Positions and speeds depend on calibration; detection timing is not changed by that warning. Stored `\uXXXX` model escapes are decoded for display, and Markdown cannot inject raw HTML or unsafe URL schemes.

**Live viewing is opt-in and per viewer.** Watch live starts one ffmpeg on the console host, at two frames per second. It is killed on disconnect/cancellation. At most four feeds run per Node process, including pending connection reservations. The route takes a site UUID, reads its stored stream URL and permits only RTSP(S)/HTTP(S); there is no editable URL relay. Compose hostnames that fail DNS are tried on loopback with the same port. This replaces Streamlit's shared reader and idle timeout.

**Video previews are explicit posters.** Site videos use an authenticated `/poster` route to decode one JPEG with ffmpeg. It accepts stored site/source IDs, caps concurrent decoders at four, times out after fifteen seconds, and caches at most 32 previews for ten minutes. Clips use their existing evidence thumbnails. Loading states use shadcn skeletons shaped for their content, with reduced-motion support.

**Source files remain as uploaded.** The MKV remux is dropped. Browser codec support determines playback; detection uses the backend's decoder. Configuration layers toggle without replacing the video element or resetting its playhead. Source attachment plus a live feed or checked video FPS are required for detection; configuration/calibration remain optional.

## Validation

```bash
npm test
npm run lint
npm run build
```

Tests cover signed sessions, credential rotation, login/logout, cross-site login refusal, request gating, API/SSE parsing, upload signatures and File identity, safe URLs, overview maths, evidence geometry and rendering, review progress and cancellation, Markdown, chat availability, and feed URL/process lifecycle. Live validation also needs the backend workers, storage and model/legal services: create a site, attach documents and a source, start detection, open a violation, follow its review, ask two chat questions, and delete the chat. For RTSP viewing, leave the View tab and check that its ffmpeg process exits. Mocked process tests do not replace that stack check.
