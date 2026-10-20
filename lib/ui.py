"""The bits every page draws the same way.

STATUS IS A VOCABULARY, NOT A STRING. The backend keeps separate enums that all mean
"how far has something got" — ViolationStatus, EvidenceStatus, SourceStatus,
FileStatus, RunStatus and a stream session's status — and deliberately does not merge them (see the comments on EvidenceStatus).
The palette below keeps that separation visible while making the *shared* meaning
legible at a glance: anything amber is in flight, anything red stopped, anything green
finished. A reader learns the colours once and reads every enum with them.

The one asymmetry worth stating: `evidence_status: null` is NOT the same as pending.
Null means the violation predates evidence-worker, so nothing will ever build its clip.
It renders grey and says "none", because a user watching an amber chip for a row that
will never change is being lied to.
"""

from __future__ import annotations

import datetime as dt
import html
import re
import urllib.parse
from typing import Any

import streamlit as st

from lib.api import API_PREFIX, Api, ApiError, ApiUnreachable, DEFAULT_BASE_URL, normalise_base_url

# Every time on screen is in this machine's zone; the API speaks UTC.
LOCAL_TZ = dt.datetime.now().astimezone().tzinfo

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------

# Base's light/dark tag pairs: a 50-step background with a 600/700-step label.
_SLATE = ("#eeeeee", "#333333")
_AMBER = ("#fff2d9", "#674d1b")
_GREEN = ("#e6f2ed", "#03582f")
_RED = ("#ffefed", "#ab1300")
_BLUE = ("#eff3fe", "#1e54b7")
_VIOLET = ("#f4f1fa", "#4d3880")

_CHIPS: dict[str, tuple[str, str]] = {
    # ViolationStatus
    "detected": _SLATE,
    "pending": _AMBER,
    "explained": _BLUE,
    "failed": _RED,
    # EvidenceStatus — 'pending'/'failed' shared with the above, deliberately: the
    # colours mean the same thing even though the enums are separate.
    "ready": _GREEN,
    # SourceStatus
    "created": _SLATE,
    "active": _GREEN,
    "degraded": _AMBER,
    "processing": _AMBER,
    "completed": _BLUE,
    # FileStatus
    "uploaded": _GREEN,
    # RunStatus — 'completed'/'failed' shared with the above. 'invalid' is its own
    # colour: the run finished, but under a document later found wrong.
    "queued": _SLATE,
    "running": _AMBER,
    "invalid": _VIOLET,
    # Stream session status
    "recording": _AMBER,
    "stopping": _AMBER,
    "stopped": _BLUE,
    # Severity
    "LOW": _GREEN,
    "MEDIUM": _AMBER,
    "HIGH": _RED,
    # EvidenceStrength — same three words as Severity in two cases, and they are
    # graded independently, so they are never drawn side by side without a label.
    "STRONG": _GREEN,
    "WEAK": _RED,
    # PlateRecoverability
    "anpr_rerun": _VIOLET,
    "manual_read": _BLUE,
    "inconclusive": _SLATE,
    # Our own
    "none": _SLATE,
}


def chip(value: Any, label: str | None = None) -> str:
    """One status pill, as HTML. Returns rather than writes, so a caller can put
    several on a line without three separate markdown blocks."""
    key = "none" if value is None else str(value)
    bg, fg = _CHIPS.get(key, _SLATE)
    text = html.escape(label if label is not None else key.replace("_", " "))
    return (
        f'<span style="background:{bg};color:{fg};padding:1px 8px;'
        f"border-radius:4px;font-size:0.75rem;font-weight:600;"
        f'white-space:nowrap;display:inline-block;line-height:1.5;">{text}</span>'
    )


def chips(*values: Any) -> None:
    """A row of pills, skipping any that are None-with-no-meaning."""
    st.markdown(
        " ".join(chip(v) for v in values if v is not None), unsafe_allow_html=True
    )


def labelled_chip(label: str, value: Any) -> str:
    """A pill with its enum named in front of it.

    Used wherever two enums that share vocabulary appear together — severity MEDIUM
    beside evidence-strength MEDIUM is meaningless without the labels, and the backend
    is emphatic that conflating the two is the mistake to avoid.
    """
    return (
        f'<span style="color:#757575;font-size:0.78rem;margin-right:4px;">'
        f"{html.escape(label)}</span>{chip(value)}"
    )


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


@st.cache_resource(show_spinner=False)
def _client(base_url: str) -> Api:
    """One session per base URL, kept across reruns so connections are pooled.

    Keyed on the URL so changing it in the sidebar hands back a different client
    rather than silently reusing one pointed somewhere else.
    """
    return Api(base_url)


def api() -> Api:
    # Normalised before the cache key, so "localhost:8001", "http://localhost:8001/"
    # and an emptied field do not each get a client of their own.
    return _client(normalise_base_url(st.session_state.get("base_url", DEFAULT_BASE_URL)))


_CSS = """
<style>
  .block-container { padding-top: 2.2rem; padding-bottom: 3rem; max-width: 1400px; }
  [data-testid="stHeaderActionElements"] { display: none; }
  h1, h2, h3 { letter-spacing: -.02em; }
  .tvc-eyebrow { color: #757575; font-size: .75rem; font-weight: 600; letter-spacing: .04em;
                 text-transform: uppercase; margin-bottom: .1rem; }
  .tvc-sub { color: #545454; font-size: .95rem; margin: -.35rem 0 1.25rem; }
  .tvc-conn { font-size: .8rem; color: #545454; display: flex; align-items: center; gap: 6px; }
  .tvc-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  [data-testid="stMetric"] label p { color: #545454; font-weight: 500; }
</style>
"""


def style() -> None:
    st.markdown(_CSS, unsafe_allow_html=True)


def page_header(title: str, subtitle: str = "", eyebrow: str = "") -> None:
    """The same heading on every page: an optional context line, the title, one
    sentence of what the page is for."""
    if eyebrow:
        st.markdown(f'<div class="tvc-eyebrow">{html.escape(eyebrow)}</div>', unsafe_allow_html=True)
    st.title(title, anchor=False)
    if subtitle:
        st.markdown(f'<div class="tvc-sub">{html.escape(subtitle)}</div>', unsafe_allow_html=True)


def sidebar() -> Api:
    """Connection controls plus the site every page shares. Returns the client so a
    page's first line can be `client = ui.sidebar()`."""
    st.session_state.setdefault("base_url", DEFAULT_BASE_URL)

    with st.sidebar:
        client = api()
        try:
            client.health()
            ok, detail = True, None
        except (ApiError, ApiUnreachable) as exc:
            ok, detail = False, str(exc)
        colour = "#05944f" if ok else "#e11900"
        st.markdown(
            f'<div class="tvc-conn"><span class="tvc-dot" style="background:{colour}"></span>'
            f'{"Connected" if ok else "Server unreachable"} · {html.escape(client.base_url)}</div>',
            unsafe_allow_html=True,
        )
        if detail:
            st.caption(detail)
        with st.expander("Connection", expanded=not ok):
            st.text_input(
                "Server address",
                key="base_url",
                help="Address of the traffic violation server. Leave as is unless told otherwise.",
            )
        return client


def site_selector(client: Api, key: str = "site_id") -> dict | None:
    """The site picker, shared across pages through session_state.

    Selecting a site on Violations and then opening Detection should not ask again,
    so the choice lives in one key and every page reads it.
    """
    try:
        sites = client.all_sites()
    except (ApiError, ApiUnreachable) as exc:
        st.sidebar.error(str(exc))
        return None

    if not sites:
        st.sidebar.info("No sites yet — create one on the Sites page.")
        return None

    by_id = {s["id"]: s for s in sites}
    current = st.session_state.get(key)
    ids = list(by_id)
    index = ids.index(current) if current in by_id else 0

    chosen = st.sidebar.selectbox(
        "Site",
        ids,
        index=index,
        format_func=lambda i: by_id[i]["name"],
        key=f"_{key}_select",
    )
    st.session_state[key] = chosen
    return by_id[chosen]


@st.cache_data(show_spinner=False, ttl=3600, max_entries=512)
def _file_name(base_url: str, file_id: str) -> str | None:
    """A file's name, cached on its id: a new upload is a new id, so it never goes stale."""
    try:
        return Api(base_url).get_file(file_id)["name"]
    except (ApiError, ApiUnreachable):
        return None


def browser_url(client: Api, url: str) -> str:
    """A storage link the *browser* will open: a player, a clip, a download.

    Local storage links point at the API, which a remote browser often cannot reach.
    serve.py relays them on the console's own port under /storage/, so they are
    rewritten to that — only for the API the relay serves. Presigned R2 links are
    already public and pass through.
    """
    absolute = client.absolute(url)
    prefix = f"{client.base_url}{API_PREFIX}/storage/"
    relayed = client.base_url == normalise_base_url(DEFAULT_BASE_URL)
    # No page URL (a test harness, a bare script run) means no origin to relay through.
    if relayed and st.context.url and absolute.startswith(prefix):
        return urllib.parse.urljoin(st.context.url, "/storage/" + absolute[len(prefix):])
    return absolute


def source_label(client: Api, source: dict | None) -> str:
    """What a site reads from, as markdown: the feed's URL, or the video's file name."""
    if not source:
        return "No source attached"
    if source["kind"] == "stream":
        what = f"Live feed · `{source.get('stream_url') or '—'}`"
    else:
        name = _file_name(client.base_url, source["file_id"]) if source.get("file_id") else None
        what = f"Video · `{name or source.get('file_id') or '—'}`"
    return f"{what} · v{source['version']}"


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def ts(value: str | None, *, with_seconds: bool = True) -> str:
    """An ISO timestamp as something readable, and the raw string if it will not parse.

    Timestamps come off the wire in two shapes — some rows carry a timezone and some
    do not — so this normalises rather than assuming either.
    """
    if not value:
        return "—"
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(LOCAL_TZ)
    fmt = "%d %b %Y, %H:%M:%S" if with_seconds else "%d %b %Y, %H:%M"
    return parsed.strftime(fmt)


def bytes_human(n: int | None) -> str:
    if not n:
        return "—"
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


@st.cache_data(show_spinner=False, ttl=300, max_entries=256)
def _source(base_url: str, site_id: str, source_id: str) -> dict | None:
    try:
        return Api(base_url).get_source(site_id, source_id)
    except (ApiError, ApiUnreachable):
        return None


def source_of(client: Api, site_id: str, source_id: str | None) -> dict | None:
    """The source version a violation or run was judged on — not necessarily the
    site's current one. Cached: a video source's fps and start time do not change."""
    return _source(client.base_url, site_id, source_id) if source_id else None


def _clock(seconds: float) -> str:
    seconds = int(round(seconds))
    h, rest = divmod(seconds, 3600)
    return f"{h}:{rest // 60:02d}:{rest % 60:02d}" if h else f"{rest // 60:02d}:{rest % 60:02d}"


def _video_timing(source: dict | None) -> tuple[float, dt.datetime | None] | None:
    """(fps, recording start) for a video source, or None when frames cannot be timed.

    Live feeds are left out on purpose: their frame count runs on across reconnects,
    so frame / fps drifts from the wall clock after every gap.
    """
    if not source or source.get("kind") != "video":
        return None
    fps = (source.get("metadata") or {}).get("fps")
    if not fps:
        return None
    start = source.get("recorded_at")
    if start:
        start = dt.datetime.fromisoformat(str(start).replace("Z", "+00:00")).astimezone(LOCAL_TZ)
    return fps, start or None


def event_time(source: dict | None, frame_index: int | None, detected_at: str | None) -> str:
    """When a violation happened, as precisely as the source allows.

    A video with a recording start: the clock time in the footage. A video without
    one: how far into the video. Otherwise only when it was detected, marked as an
    approximation — for a live feed that is seconds behind the event.
    """
    timing = _video_timing(source)
    if timing and frame_index is not None:
        fps, start = timing
        offset = frame_index / fps
        if start:
            return (start + dt.timedelta(seconds=offset)).strftime("%d %b %Y, %H:%M:%S")
        return f"{_clock(offset)} into the video"
    return f"≈ {ts(detected_at)}" if detected_at else "—"


def run_span(source: dict | None, run: dict) -> str:
    """The stretch of footage a run judged, as times where the source allows."""
    if run.get("frame_start") is None:
        return "whole video"
    timing = _video_timing(source)
    if not timing:
        return run_frames(run)
    fps, start = timing
    a, b = run["frame_start"] / fps, run["frame_end"] / fps
    if start:
        first, last = start + dt.timedelta(seconds=a), start + dt.timedelta(seconds=b)
        return f"{first:%d %b %Y, %H:%M:%S}–{last:%H:%M:%S}"
    return f"{_clock(a)}–{_clock(b)} of the video"


def run_frames(run: dict) -> str:
    """A run's frame span. No range means the run covered the whole video."""
    if run.get("frame_start") is None:
        return "whole video"
    return f"frames {run['frame_start']}–{run['frame_end']}"


def frame_time(frame_index: int | None, fps: float | None) -> str:
    """A frame index as seconds into the clip.

    The backend is consistent that frames are the storage unit and seconds are what a
    person scrubbing footage needs — ViolationExplanation says so explicitly — so
    anywhere a frame index is shown, this shows the time beside it.
    """
    if frame_index is None:
        return "—"
    if not fps:
        return f"frame {frame_index}"
    return f"frame {frame_index} · {_clock(frame_index / fps)}"


# A `\uXXXX` escape that survived into stored text, as a surrogate pair first so an
# astral character is rebuilt from both halves rather than decoded into two unusable
# lone surrogates.
_ESCAPED_CHAR = re.compile(
    r"\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})"
    r"|\\u([0-9a-fA-F]{4})"
)


def _decoded(match: re.Match) -> str:
    high, low, single = match.groups()
    if high and low:
        code = 0x10000 + ((int(high, 16) - 0xD800) << 10) + (int(low, 16) - 0xDC00)
        return chr(code)
    code = int(single, 16)
    # A lone surrogate is not a character and cannot be rendered. Leaving the escape
    # visible is better than emitting something that breaks the encode on the way out.
    if 0xD800 <= code <= 0xDFFF:
        return match.group(0)
    return chr(code)


def unescape(value: Any) -> Any:
    """Turn `\\u2014` back into the character it stands for, anywhere in a value.

    A DISPLAY REPAIR FOR BAD DATA, and worth being honest about: the escapes are in the
    database, not introduced anywhere here. The model writes its JSON with the em dash
    double-escaped (`\\\\u2014`), the SDK's schema parse decodes that faithfully into a
    literal backslash-u sequence, and it is stored and served that way. Every client of
    the API sees it; this only stops *this* page from showing it.

    So the real fix is at the llm-service boundary, and this is not a substitute for it
    — it is what keeps the reviewer's note readable until that happens.

    Walks lists and dicts because the explanation is a document: the prose, the two
    lists of reasoning, the observations and the plate note are all free text, and
    normalising the whole thing once means a field added later is covered without
    anyone remembering to come back here.
    """
    if isinstance(value, str):
        return _ESCAPED_CHAR.sub(_decoded, value)
    if isinstance(value, list):
        return [unescape(item) for item in value]
    if isinstance(value, dict):
        return {key: unescape(item) for key, item in value.items()}
    return value


def error(exc: Exception) -> None:
    """One place that decides how a failure reads.

    The API uses its status codes deliberately, so the codes it chose on purpose get
    the explanation they were chosen to carry rather than a generic red box.
    """
    if isinstance(exc, ApiUnreachable):
        st.error(str(exc), icon=":material/cloud_off:")
        return
    if isinstance(exc, ApiError):
        hint = {
            404: "Not found — it may have been deleted, or belong to another site.",
            409: "This cannot be done yet — a required step is still missing.",
            413: "The file is larger than the upload size limit.",
            422: "Some of the information entered is not valid.",
            502: "The server is temporarily unable to complete this. Please try again.",
        }.get(exc.status)
        st.error(f"{exc.detail}" + (f"\n\n{hint}" if hint else ""), icon=":material/block:")
        return
    st.error(str(exc), icon=":material/error:")


def empty(message: str, hint: str = "") -> None:
    st.markdown(
        f'<div style="border:1px solid #e2e2e2;background:#f6f6f6;border-radius:8px;padding:28px;'
        f'text-align:center;color:#545454;">{html.escape(message)}'
        + (
            f'<div style="font-size:0.85rem;margin-top:6px;opacity:.8;">{html.escape(hint)}</div>'
            if hint
            else ""
        )
        + "</div>",
        unsafe_allow_html=True,
    )
