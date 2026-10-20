"""The whole of site-service, as functions.

One module rather than a client per resource, because the surface is small enough to
read in one sitting and every page needs most of it. Nothing here knows what Streamlit
is: the pages catch ApiError and decide what to draw, and this file stays testable from
a plain interpreter.

THE ONE THING WORTH KNOWING BEFORE EDITING: `upload` below is a three-call dance and
the middle call does not come here. Bytes never pass through site-service — it hands
back a presigned URL and the client PUTs to R2 directly — so the upload step talks to
a host this module otherwise never mentions. See put_object() for why its headers are
read off the URL rather than chosen.
"""

from __future__ import annotations

import os
import urllib.parse
from typing import Any, Iterable

import requests

DEFAULT_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8001")
TIMEOUT = float(os.environ.get("API_TIMEOUT_SECONDS", "30"))
UPLOAD_TIMEOUT = float(os.environ.get("UPLOAD_TIMEOUT_SECONDS", "300"))

API_PREFIX = "/api/v1"

# Every type the backend knows. Which of them are switched on is the server's
# VIOLATION_TYPES setting (red light is off until it is validated), and asking for one
# that is off is a 422 rather than a silent skip — so the list here is not a promise.
VIOLATION_TYPES = ("red_light_running", "pedestrian_right_of_way")
FILE_TYPES = ("calibration", "configuration", "video", "evidence_frame")
SOURCE_KINDS = ("video", "stream")
RUN_STATUSES = ("queued", "running", "completed", "failed", "invalid")
SESSION_STATUSES = ("recording", "stopping", "stopped", "failed")


class ApiError(Exception):
    """A request that reached the API and came back refused.

    Carries the status so a caller can tell apart the codes this API uses
    deliberately — 404 for absent, 409 for "not in that state yet", 413 for an
    oversized upload — rather than every failure collapsing into one red box.
    """

    def __init__(self, status: int, detail: str, url: str = ""):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.url = url

    def __str__(self) -> str:  # pragma: no cover - display only
        return f"{self.status} — {self.detail}"


class ApiUnreachable(Exception):
    """Nothing answered. A separate type because the fix is different: the API is not
    refusing anything, it is not running, and telling a user to check their request
    would send them looking in the wrong place."""


def normalise_base_url(value: str | None) -> str:
    """Make a typed-in base URL into something requests can actually send to.

    The sidebar is a free text field, so it hands us whatever is in it — including
    "" the moment someone selects-all-deletes before retyping. Left alone that
    produces a request to "/api/v1/sites", which requests rejects with MissingSchema
    rather than any of the errors this module knows how to explain. Two fixes, both
    here so there is one place that decides what a base URL is:
    empty falls back to the configured default, and a bare host gets http://.
    """
    fallback = DEFAULT_BASE_URL.strip().rstrip("/")
    url = (value or "").strip()
    if not url:
        return fallback
    if "://" not in url:
        url = f"http://{url}"
    # A scheme with nothing after it ("http://") is as unsendable as an empty box, and
    # urlsplit is the cheapest way to ask "is there a host here" without a regex.
    if not urllib.parse.urlsplit(url).netloc:
        return fallback
    return url.rstrip("/")


class Api:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, timeout: float = TIMEOUT):
        self.base_url = normalise_base_url(base_url)
        self.timeout = timeout
        self.session = requests.Session()

    # ---- plumbing ---------------------------------------------------------

    def _url(self, path: str) -> str:
        return f"{self.base_url}{API_PREFIX}{path}"

    def absolute(self, url: str) -> str:
        """An upload, download or evidence URL the API handed back, made fetchable.

        With STORAGE_BACKEND=local those are site-service's own /storage paths with no
        host on them; presigned R2 URLs are already absolute and pass through as-is.
        """
        return urllib.parse.urljoin(f"{self.base_url}/", url)

    def _request(self, method: str, path: str, **kwargs) -> Any:
        url = self._url(path)
        kwargs.setdefault("timeout", self.timeout)
        try:
            response = self.session.request(method, url, **kwargs)
        except requests.exceptions.ConnectionError as exc:
            raise ApiUnreachable(
                f"Could not reach {self.base_url}. Is the stack up? "
                "`docker compose up api` in the traffic-violation repo."
            ) from exc
        except requests.exceptions.Timeout as exc:
            raise ApiUnreachable(
                f"{method} {path} did not answer within {kwargs['timeout']:.0f}s."
            ) from exc
        except requests.exceptions.RequestException as exc:
            # Everything else requests can raise — a malformed base URL, too many
            # redirects, a broken chunked response. None of them are the API refusing
            # anything, so they belong with the other "nothing answered" cases rather
            # than escaping as a traceback on top of the page.
            raise ApiUnreachable(f"{method} {self.base_url}{path} failed: {exc}") from exc

        if response.status_code >= 400:
            raise ApiError(response.status_code, _detail_of(response), url)
        # 204 on delete, and .json() on an empty body raises rather than returning None.
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    # ---- health -----------------------------------------------------------

    def health(self) -> dict:
        """Outside the versioned prefix, so it does not go through _request."""
        try:
            response = self.session.get(f"{self.base_url}/health", timeout=5)
        except requests.exceptions.RequestException as exc:
            raise ApiUnreachable(f"Could not reach {self.base_url}.") from exc
        if response.status_code >= 400:
            raise ApiError(response.status_code, _detail_of(response))
        return response.json()

    # ---- sites ------------------------------------------------------------

    def list_sites(
        self,
        limit: int = 20,
        offset: int = 0,
        kind: str | None = None,
    ) -> dict:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        # kind describes the site's *active* source, not its history. Omitted rather
        # than sent as None so an unset filter is absent from the query string entirely.
        if kind:
            params["kind"] = kind
        return self._request("GET", "/sites", params=params)

    def all_sites(self, page: int = 100) -> list[dict]:
        """Every site, for the pickers that need a complete list.

        The API caps `limit` at 100, so anything that wants "all of them" has to
        paginate rather than asking for a big number and hoping.
        """
        out: list[dict] = []
        offset = 0
        while True:
            batch = self.list_sites(limit=page, offset=offset)
            out.extend(batch["items"])
            offset += page
            if offset >= batch["total"] or not batch["items"]:
                return out

    def create_site(self, name: str, source: dict | None = None) -> dict:
        body: dict[str, Any] = {"name": name}
        # SiteCreate forbids extra keys, and a null `source` is not the same as an
        # absent one to a model that validates the source when it is present.
        if source:
            body["source"] = source
        return self._request("POST", "/sites", json=body)

    def get_site(self, site_id: str) -> dict:
        return self._request("GET", f"/sites/{site_id}")

    def delete_site(self, site_id: str) -> None:
        self._request("DELETE", f"/sites/{site_id}")

    # ---- files ------------------------------------------------------------

    def create_file(
        self,
        name: str,
        file_type: str,
        size_bytes: int,
        content_type: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {
            "name": name,
            "type": file_type,
            "size_bytes": size_bytes,
        }
        if content_type:
            body["content_type"] = content_type
        return self._request("POST", "/files", json=body)

    def complete_upload(self, file_id: str) -> dict:
        return self._request("POST", f"/files/{file_id}/complete")

    def get_file(self, file_id: str) -> dict:
        return self._request("GET", f"/files/{file_id}")

    def put_object(
        self, upload_url: str, data: bytes, content_type: str | None = None
    ) -> None:
        """The middle step, and the only call in this file that leaves site-service.

        THE HEADERS ARE READ OFF THE URL, NOT GUESSED. `presigned_put` says it plainly:
        anything it was given becomes part of the signature and the client MUST send
        the identical header. Which headers those were is not a thing to remember — the
        URL carries the list in X-Amz-SignedHeaders, so this sends exactly that set and
        cannot drift when the server starts or stops signing something.

        With STORAGE_BACKEND=local the URL is site-service's own /storage route and
        carries no signature at all, so nothing extra is sent — which is what it wants.

        In practice the list is `content-length;host`, and `content-length;content-type;
        host` whenever the file row carries a content type. Sending no Content-Type
        against the second form is a 403 SignatureDoesNotMatch, which is how this was
        found.

        `host` needs nothing: requests derives it from the URL. Content-Length is
        derived from `data`, which is why the bytes are passed as bytes and never as a
        file object — a stream goes out chunked, with no Content-Length at all, and R2
        rejects it the same way.
        """
        upload_url = self.absolute(upload_url)
        signed = _signed_headers(upload_url)
        headers: dict[str, str] = {}
        if "content-type" in signed:
            if not content_type:
                raise ApiError(
                    400,
                    "The upload URL was signed with a Content-Type, but none was "
                    "supplied to send back. Pass the same content_type used to "
                    "create the file.",
                    upload_url,
                )
            headers["Content-Type"] = content_type
        elif content_type:
            # Signed without one, so sending it would be stored on the object while
            # contradicting the file row. Dropped rather than sent.
            pass

        try:
            response = requests.put(
                upload_url, data=data, headers=headers, timeout=UPLOAD_TIMEOUT
            )
        except requests.exceptions.RequestException as exc:
            raise ApiUnreachable(f"Upload to object storage failed: {exc}") from exc
        if response.status_code >= 400:
            raise ApiError(
                response.status_code,
                f"Object storage refused the upload: {response.text[:400]}",
                upload_url,
            )

    def upload(
        self,
        name: str,
        file_type: str,
        data: bytes,
        content_type: str | None = None,
    ) -> dict:
        """Reserve, PUT, confirm — the three calls the collection walks by hand.

        Returns the confirmed FileResponse, so the caller has a file_id that is
        already `uploaded` and can be referenced by a calibration, configuration or
        source without a second check.
        """
        reserved = self.create_file(name, file_type, len(data), content_type)
        self.put_object(reserved["upload_url"], data, content_type)
        return self.complete_upload(reserved["id"])

    # ---- versioned documents (calibrations, configurations) ---------------

    def get_active_doc(self, site_id: str, resource: str) -> dict | None:
        """The site's highest version of `resource`, or None if it has none.

        None rather than an exception for the 404: a site with no calibration yet is
        an ordinary state on the way through setup, not an error to report.
        """
        try:
            return self._request("GET", f"/sites/{site_id}/{resource}")
        except ApiError as exc:
            if exc.status == 404:
                return None
            raise

    def create_doc(self, site_id: str, resource: str, file_id: str) -> dict:
        return self._request(
            "POST", f"/sites/{site_id}/{resource}", json={"file_id": file_id}
        )

    def get_doc(self, site_id: str, resource: str, doc_id: str) -> dict:
        return self._request("GET", f"/sites/{site_id}/{resource}/{doc_id}")

    def invalidate_doc(self, site_id: str, resource: str, doc_id: str, reason: str) -> int:
        """Mark every run judged under this document invalid; returns how many.

        For a calibration or configuration found wrong after the fact. The document
        itself stays; its runs leave the run list and their violations the queue.
        """
        body = self._request(
            "POST",
            f"/sites/{site_id}/{resource}/{doc_id}/invalidate",
            json={"reason": reason},
        )
        return body["invalidated"]

    # ---- sources ----------------------------------------------------------

    def get_active_source(self, site_id: str) -> dict | None:
        try:
            return self._request("GET", f"/sites/{site_id}/sources")
        except ApiError as exc:
            if exc.status == 404:
                return None
            raise

    def get_source(self, site_id: str, source_id: str) -> dict | None:
        """A specific version, by id.

        Not the same question as get_active_source, and the difference matters when
        reading a violation: its `source_id` names the video it was actually found in,
        which is not necessarily the one the site points at now. Taking fps from the
        active source would put the wrong seconds under a violation recorded against
        an older video.
        """
        try:
            return self._request("GET", f"/sites/{site_id}/sources/{source_id}")
        except ApiError as exc:
            if exc.status == 404:
                return None
            raise

    def create_source(
        self,
        site_id: str,
        kind: str,
        file_id: str | None = None,
        stream_url: str | None = None,
        recorded_at: str | None = None,
    ) -> dict:
        # SourceCreate forbids extras and validates that exactly one of the two is set
        # for the kind, so the wrong key is left out rather than sent as null.
        body: dict[str, Any] = {"kind": kind}
        if kind == "video":
            body["file_id"] = file_id
        else:
            body["stream_url"] = stream_url
        # Must carry a timezone: the model is AwareDatetime and refuses a naive one.
        if recorded_at:
            body["recorded_at"] = recorded_at
        return self._request("POST", f"/sites/{site_id}/sources", json=body)

    # ---- detection --------------------------------------------------------

    def detect(
        self,
        site_id: str,
        types: Iterable[str] | None = None,
        source_id: str | None = None,
    ) -> dict:
        """202 and a stream session. Nothing is finished when this returns.

        The ingestion worker picks the session up, cuts the source into pieces and
        queues one detection run per window; the runs are what to watch. Without
        `source_id` it starts on the site's active source.
        """
        types = list(types) if types else None
        # An empty/absent `types` means every type the server has switched on, which is
        # not the same as sending the list we happen to know here — so it is omitted.
        body = {"types": types} if types else {}
        path = (
            f"/sites/{site_id}/sources/{source_id}/detect"
            if source_id
            else f"/sites/{site_id}/detect"
        )
        return self._request("POST", path, json=body)

    def stop_source(self, site_id: str, source_id: str) -> None:
        """End a live stream's recording. 409 when nothing is recording it; a video's
        session ends by itself once every window is queued."""
        self._request("POST", f"/sites/{site_id}/sources/{source_id}/stop")

    # ---- runs -------------------------------------------------------------

    def list_runs(self, site_id: str, limit: int = 20, offset: int = 0) -> dict:
        """Newest first. One run per window, so a session shows up as many runs."""
        return self._request(
            "GET",
            f"/sites/{site_id}/runs",
            params={"limit": limit, "offset": offset},
        )

    def get_run(self, site_id: str, run_id: str) -> dict:
        return self._request("GET", f"/sites/{site_id}/runs/{run_id}")

    # ---- violations -------------------------------------------------------

    def list_violations(
        self,
        site_id: str,
        limit: int = 20,
        offset: int = 0,
        run_id: str | None = None,
    ) -> dict:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if run_id:
            params["run_id"] = run_id
        return self._request("GET", f"/sites/{site_id}/violations", params=params)

    def get_violation(self, site_id: str, violation_id: str) -> dict:
        return self._request("GET", f"/sites/{site_id}/violations/{violation_id}")

    def explain(self, site_id: str, violation_id: str) -> dict:
        """Ask for an explanation. Safe to call repeatedly — see the route's docstring:
        202 means work was accepted, 200 means there was nothing to do, and the body is
        the violation either way. The caller polls `status` rather than waiting."""
        return self._request(
            "POST", f"/sites/{site_id}/violations/{violation_id}/explain"
        )


def _signed_headers(url: str) -> set[str]:
    """The header names baked into a presigned URL's signature, lowercased.

    Reading them off the URL rather than hardcoding them means the client follows
    whatever the server chose to sign, including combinations it has not seen.
    """
    query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    return set(query.get("X-Amz-SignedHeaders", [""])[0].split(";")) - {""}


def _detail_of(response: requests.Response) -> str:
    """FastAPI's `detail`, which is a string for our HTTPExceptions and a list of
    per-field objects for a 422 out of pydantic. Both are flattened to something a
    person can read, because a raw 422 body in a toast is unreadable."""
    try:
        body = response.json()
    except ValueError:
        return response.text[:400] or response.reason

    detail = body.get("detail", body) if isinstance(body, dict) else body
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        parts = []
        for item in detail:
            if isinstance(item, dict):
                where = " → ".join(str(p) for p in item.get("loc", [])[1:])
                parts.append(f"{where}: {item.get('msg', '')}".strip(": "))
            else:
                parts.append(str(item))
        return "; ".join(parts) or str(body)
    return str(detail)
