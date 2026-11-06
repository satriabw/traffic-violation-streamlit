# Next.js console acceptance — 6 November 2026

The replacement passed against the running site-service, ingestion, detection, evidence and LLM workers. These checks used the production build at `http://127.0.0.1:3005`, signed login sessions and actual browser interactions in Google Chrome. Existing sites and their documents were left unchanged.

## Video workflow

- Created an isolated site through the Sites dialog.
- Downloaded an existing evidence clip and the configuration/calibration it was judged under as representative fixtures; uploaded and attached copies through Site setup.
- Confirmed source readiness, the server-generated JPEG poster before playback, video playback and configuration toggles without replacing the player.
- Started pedestrian-right-of-way detection through the UI. The ingestion/detection workers completed one run and produced one new violation.
- Opened that violation from the queue and played its newly generated evidence clip with its thumbnail poster.
- Started a real evidence review, reloaded while it was running, and followed it to completion through the model/legal services.
- Inspected the full-width detailed trace and downloaded its Markdown report. Citations, evidence basis, tracking facts and complete raw events were available.
- Asked two questions through the dedicated evidence/chat workspace, received both answers, and deleted the chat.
- Verified file lookup and its download link. Confirmed that deletion soft-deletes a site from the console while the backend retains stored records. Updated the confirmation copy to match this backend behavior.

The video test used site `37c5c3ba-9b9c-403c-911d-1708787b2a20` and violation `99ba24d9-903b-57c2-a21c-8d8c78610a62`. Temporary acceptance sites were soft-deleted after validation; existing sites were not modified.

## Live workflow

The existing RTSP fixture had no publisher. A temporary ffmpeg publisher looped the test clip to the isolated `/console-acceptance` path on the existing local RTSP server. No existing camera path was changed.

- Attached that live feed to an isolated site through Site setup.
- Confirmed viewing does not start before opting in, then decoded real RTSP frames in Site view.
- Navigated away and confirmed the viewer's ffmpeg process exited.
- Started real live recording through Detection, stopped it through the UI and waited for its final detection window to complete.
- Confirmed a second stop request returned 409, indicating that recording had ended. A reusable live source retains its `created` status independently of recording-session state.
- Stopped the temporary publisher and soft-deleted temporary acceptance sites.

## Interface and authentication

- Login redirects, incorrect-password handling, return-to-page navigation, HttpOnly session cookies and logout passed browser checks.
- API/feed requests without authentication returned 401; cross-site writes are refused. Cached browser Basic credentials cannot bypass logout.
- Delayed-response checks confirmed animated shadcn skeletons; reduced-motion preferences are supported.
- Explicit video posters, setup tabs, the full-width trace and mobile layouts passed browser checks without page errors.
- The default violation view shows the clip and recommended next step. Supporting findings, key-frame overlays, paths/speeds, record metadata and detailed traces are available on demand.

## Automated checks and scope

`npm test` passed 122 tests across 17 files. ESLint and the production build passed. Tests include authentication, signed sessions, CSRF checks, streaming review parsing/cancellation, evidence geometry, uploads, trace citations/quote checks, thumbnail process cancellation/timeouts and live-process cleanup.

The configured stack uses local storage; actual uploads, downloads, video ranges and playback were exercised there. A remote R2 bucket and an HTTPS reverse proxy were not configured for this run. Signed-upload behavior is covered by unit tests; deployment-specific HTTPS/CORS checks remain part of deployment validation.

There is no runtime dependency on the Python frontend. Its entry points, modules, requirements, Streamlit configuration and UI assets can be removed. `streamlit-final` preserves the previous source for rollback.
