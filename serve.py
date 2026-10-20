"""The console, plus one route: /storage/…, relaying the backend's stored files.

WHY THIS EXISTS. With STORAGE_BACKEND=local, a video, clip or download link points at
site-service's /api/v1/storage. A player in the browser fetches that itself, so the
browser — not this server — has to reach the API, which on a remote machine means
tunnelling a second port. Relaying it here puts every byte on the console's own port.

Range requests pass straight through, so a player can seek and only the part it asks
for is read: nothing is held in memory beyond one chunk.

Run with `streamlit run serve.py` (or uvicorn serve:app); `streamlit run app.py` still
works, just without the relay.
"""

from __future__ import annotations

import requests
import streamlit as st
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse
from starlette.routing import Route

from lib.api import API_PREFIX, DEFAULT_BASE_URL, normalise_base_url

# Only ever the configured API: this is a relay for its storage, not an open proxy.
UPSTREAM = f"{normalise_base_url(DEFAULT_BASE_URL)}{API_PREFIX}/storage/"
FORWARDED_REQUEST = ("range", "if-range")
FORWARDED_RESPONSE = (
    "content-type", "content-length", "content-range", "accept-ranges",
    "last-modified", "etag",
)


async def storage(request: Request) -> Response:
    headers = {k: v for k, v in request.headers.items() if k.lower() in FORWARDED_REQUEST}
    try:
        upstream = await run_in_threadpool(
            requests.get, UPSTREAM + request.path_params["key"],
            headers=headers, stream=True, timeout=30,
        )
    except requests.RequestException:
        return Response("Storage is unreachable", status_code=502)
    return StreamingResponse(
        iterate_in_threadpool(upstream.iter_content(1 << 16)),
        status_code=upstream.status_code,
        headers={k: v for k, v in upstream.headers.items() if k.lower() in FORWARDED_RESPONSE},
        background=None,
    )


app = st.App("app.py", routes=[Route("/storage/{key:path}", storage)])
