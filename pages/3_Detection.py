"""Start a detection session and watch its runs.

202 AND NOTHING IS FINISHED. The endpoint returns a stream session: the ingestion
worker picks it up, cuts the source into short pieces and queues one detection run per
window. There is no GET for a session, so what this page watches is the site's runs —
each one a window with its own status — which is the progress the API actually offers.

A video's session ends by itself once every window is queued. A live stream's records
until someone stops it, which is what the Stop button is for.
"""

from __future__ import annotations

import time

import pandas as pd
import streamlit as st

from lib import ui
from lib.api import VIOLATION_TYPES, ApiError, ApiUnreachable


client = ui.sidebar()
site = ui.site_selector(client)

ui.page_header("Detection", "Start detection on the current source and follow its runs.", eyebrow=f"Operations · {site['name']}" if site else "Operations")

if site is None:
    ui.empty("Pick a site in the sidebar.")
    st.stop()


try:
    source = client.get_active_source(site["id"])
    before = client.list_violations(site["id"], limit=1)["total"]
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

# ---------------------------------------------------------------------------
# What the session will read
# ---------------------------------------------------------------------------

st.markdown("#### Source")

if not source:
    st.warning("This site has no source yet. Add a video or a live feed on Site Setup.", icon=":material/warning:")
else:
    metadata = source.get("metadata") or {}
    cols = st.columns(4)
    cols[0].markdown(
        ui.labelled_chip("status", source["status"]) + "&nbsp;&nbsp;" + ui.chip(source["kind"]),
        unsafe_allow_html=True,
    )
    if source["kind"] == "video":
        cols[1].metric("Frames", f"{metadata['total_frames']:,}" if metadata.get("total_frames") else "—", border=True)
        cols[2].metric("FPS", f"{metadata['fps']:.2f}" if metadata.get("fps") else "—", border=True)
        cols[3].metric("Duration", f"{metadata.get('duration_seconds') or 0:.1f}s", border=True)
    else:
        cols[1].caption(f"**stream url**\n\n`{source.get('stream_url')}`")
        cols[2].metric("FPS", f"{metadata['fps']:.2f}" if metadata.get("fps") else "—", border=True)
        st.caption(
            "A live feed is probed when detection starts, not when it is added: an "
            "unreadable feed is refused then, and its frame rate and size are saved."
        )
    st.caption(
        f"Source version {source['version']}. The calibration and configuration active "
        "now are pinned to the session, so attaching new ones later does not change "
        "what it judges with."
    )

st.divider()
st.markdown("#### Start detection")

types = st.multiselect(
    "Violation types",
    VIOLATION_TYPES,
    default=[],
    format_func=lambda t: t.replace("_", " "),
    help=(
        "Leave empty to check every type the server has switched on. Asking for a type "
        "that is switched off (red light running, until it is validated) is refused."
    ),
)
if not types:
    st.caption("None selected: every switched-on violation type will be checked.")

runnable = bool(
    source
    and (source["kind"] == "stream" or (source.get("metadata") or {}).get("fps"))
)

start, stop = st.columns(2)
if start.button("Start detection", type="primary", disabled=not runnable, width="stretch"):
    try:
        session = client.detect(site["id"], types or None)
    except (ApiError, ApiUnreachable) as exc:
        ui.error(exc)
    else:
        st.session_state["last_session"] = session
        st.session_state["violations_before"] = before
        st.toast("Detection started", icon=":material/play_circle:")

if source and source["kind"] == "stream":
    if stop.button("Stop recording", width="stretch"):
        try:
            client.stop_source(site["id"], source["id"])
        except ApiError as exc:
            if exc.status == 409:
                st.info("This feed is not being recorded.", icon=":material/info:")
            else:
                ui.error(exc)
        except ApiUnreachable as exc:
            ui.error(exc)
        else:
            st.toast("Stopping — the last piece is closed and its windows still run.", icon=":material/stop_circle:")

session = st.session_state.get("last_session")
if session and session["site_id"] == site["id"]:
    st.markdown("#### Last session started")
    with st.container(border=True):
        cols = st.columns(4)
        cols[0].caption(f"**session id**\n\n`{session['id']}`")
        cols[1].markdown(ui.labelled_chip("status", session["status"]), unsafe_allow_html=True)
        cols[2].caption(
            f"**calibration**\n\n`{session['calibration_id']}`"
            if session.get("calibration_id")
            else "**calibration**\n\nnone"
        )
        cols[3].caption(
            f"**configuration**\n\n`{session['configuration_id']}`"
            if session.get("configuration_id")
            else "**configuration**\n\nnone"
        )
        st.markdown(
            " ".join(ui.chip(t, t.replace("_", " ")) for t in session["types"]),
            unsafe_allow_html=True,
        )
        st.caption("The status above is as it was when the session started; the runs below are live.")
    with st.expander("Technical details"):
        st.json(session)

# ---------------------------------------------------------------------------
# Watch the runs
# ---------------------------------------------------------------------------

st.divider()
st.markdown("#### Runs")
st.caption("One run per window of footage, newest first.")


def draw_runs(runs: list[dict]) -> None:
    counts: dict[str, int] = {}
    for run in runs:
        counts[run["status"]] = counts.get(run["status"], 0) + 1
    st.markdown(
        " ".join(ui.chip(status, f"{status} {n}") for status, n in counts.items()),
        unsafe_allow_html=True,
    )
    st.dataframe(
        pd.DataFrame(
            [
                {
                    "Created": pd.to_datetime(run["created_at"]).tz_convert(ui.LOCAL_TZ).tz_localize(None),
                    "Status": run["status"],
                    "Footage": ui.run_span(ui.source_of(client, site["id"], run.get("source_id")), run),
                    "Types": ", ".join(t.replace("_", " ") for t in run["types"]),
                    "Finished": pd.to_datetime(run["finished_at"]).tz_convert(ui.LOCAL_TZ).tz_localize(None)
                    if run.get("finished_at") else None,
                    "Error": run.get("error") or "",
                }
                for run in runs
            ]
        ),
        hide_index=True,
        width="stretch",
        column_config={
            "Created": st.column_config.DatetimeColumn(format="D MMM, HH:mm:ss"),
            "Finished": st.column_config.DatetimeColumn(format="D MMM, HH:mm:ss"),
        },
    )


try:
    page = client.list_runs(site["id"], limit=20)
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

runs_box = st.container()
if page["items"]:
    with runs_box:
        draw_runs(page["items"])
        if page["total"] > len(page["items"]):
            st.caption(f"Showing the latest {len(page['items'])} of {page['total']}.")
else:
    runs_box.caption("No runs yet. A session's runs appear once the ingestion worker cuts the first window.")

st.divider()
current = st.columns(3)
current[0].metric(
    "Violations recorded",
    before,
    delta=(before - st.session_state["violations_before"])
    if "violations_before" in st.session_state
    else None,
)

if current[1].button("Refresh", width="stretch"):
    st.rerun()

watch = current[2].toggle(
    "Update automatically",
    help="Checks the runs every 3 seconds, for up to two minutes, until none is queued or running.",
)

if watch:
    placeholder = st.empty()
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            runs = client.list_runs(site["id"], limit=20)["items"]
            total = client.list_violations(site["id"], limit=1)["total"]
        except (ApiError, ApiUnreachable) as exc:
            ui.error(exc)
            break
        busy = sum(r["status"] in ("queued", "running") for r in runs)
        if runs and not busy:
            placeholder.success(f"No run is queued or running. {total} violations recorded.", icon=":material/check_circle:")
            break
        placeholder.info(
            f"Watching… {busy} run(s) queued or running, {total} violations recorded. "
            f"{int(deadline - time.time())}s left of automatic checking.",
            icon=":material/hourglass_top:",
        )
        time.sleep(3)
    else:
        placeholder.warning(
            "Stopped checking after two minutes. Runs may still be going — a long video "
            "or a live feed produces many windows. Press Refresh to check again.",
            icon=":material/hourglass_bottom:",
        )

if before and st.button("Review violations"):
    st.switch_page("pages/4_Violations.py")
