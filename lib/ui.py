"""The bits every page draws the same way.

STATUS IS A VOCABULARY, NOT A STRING. The backend keeps four separate enums that all
mean "how far has something got" — ViolationStatus, EvidenceStatus, SourceStatus,
FileStatus — and deliberately does not merge them (see the comments on EvidenceStatus).
The palette below keeps that separation visible while making the *shared* meaning
legible at a glance: anything amber is in flight, anything red stopped, anything green
finished. A reader learns the colours once and reads all four enums with them.

The one asymmetry worth stating: `evidence_status: null` is NOT the same as pending.
Null means the violation predates evidence-worker, so nothing will ever build its clip.
It renders grey and says "none", because a user watching an amber chip for a row that
will never change is being lied to.
"""

from __future__ import annotations

import datetime as dt
import html
import re
from typing import Any

import streamlit as st

from lib.api import Api, ApiError, ApiUnreachable, DEFAULT_BASE_URL, normalise_base_url

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------

_SLATE = ("#e2e8f0", "#334155")
_AMBER = ("#fef3c7", "#92400e")
_GREEN = ("#dcfce7", "#166534")
_RED = ("#fee2e2", "#991b1b")
_BLUE = ("#dbeafe", "#1e40af")
_VIOLET = ("#ede9fe", "#5b21b6")

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
        f'<span style="background:{bg};color:{fg};padding:2px 10px;'
        f"border-radius:999px;font-size:0.78rem;font-weight:600;"
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
        f'<span style="color:#64748b;font-size:0.78rem;margin-right:4px;">'
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


def sidebar() -> Api:
    """Connection controls plus the site every page shares. Returns the client so a
    page's first line can be `client = ui.sidebar()`."""
    st.session_state.setdefault("base_url", DEFAULT_BASE_URL)

    with st.sidebar:
        st.markdown("### Traffic Violation Console")
        st.text_input(
            "Server address",
            key="base_url",
            help="Address of the traffic violation server. Leave as is unless told otherwise.",
        )

        client = api()
        # The field is free text and can be emptied mid-edit; say which URL is actually
        # being used rather than letting the health box report on an invisible fallback.
        if client.base_url != (st.session_state.get("base_url") or "").strip().rstrip("/"):
            st.caption(f"Using `{client.base_url}`")
        try:
            client.health()
            st.success("Connected to server", icon="✅")
        except (ApiError, ApiUnreachable) as exc:
            st.error(f"{exc}", icon="🔌")

        st.divider()
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
    st.sidebar.caption(f"`{chosen}`")
    return by_id[chosen]


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
    fmt = "%Y-%m-%d %H:%M:%S" if with_seconds else "%Y-%m-%d %H:%M"
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
    return f"frame {frame_index} · {frame_index / fps:.2f}s"


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
        st.error(str(exc), icon="🔌")
        return
    if isinstance(exc, ApiError):
        hint = {
            404: "Not found — it may have been deleted, or belong to another site.",
            409: "This cannot be done yet — a required step is still missing.",
            413: "The file is larger than the upload size limit.",
            422: "Some of the information entered is not valid.",
            502: "The server is temporarily unable to complete this. Please try again.",
        }.get(exc.status)
        st.error(f"{exc.detail}" + (f"\n\n{hint}" if hint else ""), icon="🚫")
        return
    st.error(str(exc), icon="❌")


def empty(message: str, hint: str = "") -> None:
    st.markdown(
        f'<div style="border:1px dashed #cbd5e1;border-radius:10px;padding:28px;'
        f'text-align:center;color:#64748b;">{html.escape(message)}'
        + (
            f'<div style="font-size:0.85rem;margin-top:6px;opacity:.8;">{html.escape(hint)}</div>'
            if hint
            else ""
        )
        + "</div>",
        unsafe_allow_html=True,
    )
