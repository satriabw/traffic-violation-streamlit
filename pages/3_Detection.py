"""Trigger a detection run and watch violations arrive.

202 AND NOTHING IS FINISHED. The endpoint returns a DetectionJob, which is a description
of work that has been queued — not a result and not a resource that can be fetched back.
There is no GET for a job, so this page cannot poll one; what it polls instead is the
site's violation count, which is the only observable the API actually offers. The job
card below is kept in session state purely so the operator can see what was sent.
"""

from __future__ import annotations

import time

import streamlit as st

from lib import ui
from lib.api import VIOLATION_TYPES, ApiError, ApiUnreachable

st.set_page_config(page_title="Detection", page_icon="🎯", layout="wide")

client = ui.sidebar()
site = ui.site_selector(client)

st.title("🎯 Detection")

if site is None:
    ui.empty("Pick a site in the sidebar.")
    st.stop()

st.caption(f"Running against **{site['name']}** · `{site['id']}`")

try:
    source = client.get_active_source(site["id"])
    before = client.list_violations(site["id"], limit=1)["total"]
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

# ---------------------------------------------------------------------------
# What the job will be
# ---------------------------------------------------------------------------

st.markdown("#### Video")

if not source:
    st.warning("This site has no video yet. Add one on Site Setup.", icon="⚠️")
elif source["kind"] != "video":
    st.warning(
        "Detection works only on uploaded videos, not live camera feeds.",
        icon="⚠️",
    )
else:
    metadata = source.get("metadata") or {}
    cols = st.columns(4)
    cols[0].markdown(ui.labelled_chip("status", source["status"]), unsafe_allow_html=True)
    cols[1].metric("Frames", metadata.get("total_frames") or "—")
    cols[2].metric("FPS", f"{metadata['fps']:g}" if metadata.get("fps") else "—")
    cols[3].metric("Duration", f"{metadata.get('duration_seconds', 0):.1f}s")
    st.caption(
        f"Video version {source['version']}. A run keeps using this version even if a new "
        "video is added before it starts."
    )

st.divider()
st.markdown("#### Start a detection run")

types = st.multiselect(
    "Violation types",
    VIOLATION_TYPES,
    default=[],
    format_func=lambda t: t.replace("_", " "),
    help=(
        "Leave empty to check all available violation types, including any added in the "
        "future."
    ),
)
if not types:
    st.caption("None selected: all violation types will be checked.")

runnable = bool(source and source["kind"] == "video" and (source.get("metadata") or {}).get("total_frames"))

if st.button("Start detection", type="primary", disabled=not runnable):
    try:
        job = client.detect(site["id"], types or None)
    except (ApiError, ApiUnreachable) as exc:
        ui.error(exc)
    else:
        st.session_state["last_job"] = job
        st.session_state["violations_before"] = before
        st.toast("Detection started", icon="🎯")

job = st.session_state.get("last_job")
if job and job["site_id"] == site["id"]:
    st.markdown("#### Last detection run started")
    with st.container(border=True):
        cols = st.columns(4)
        cols[0].caption(f"**run id**\n\n`{job['id']}`")
        cols[1].caption(
            f"**frames**\n\n{job['frame_range']['start']}–{job['frame_range']['end']}"
        )
        cols[2].caption(
            f"**calibration**\n\nv{job['calibration_version']}"
            if job.get("calibration_version") is not None
            else "**calibration**\n\nnone"
        )
        cols[3].caption(
            f"**configuration**\n\nv{job['configuration_version']}"
            if job.get("configuration_version") is not None
            else "**configuration**\n\nnone"
        )
        st.markdown(
            " ".join(ui.chip(t, t.replace("_", " ")) for t in job["types"]),
            unsafe_allow_html=True,
        )
        st.caption(
            "The calibration and configuration versions above are fixed when the run "
            "starts. Files uploaded later do not affect this run."
        )
    with st.expander("Technical details"):
        st.json(job)

# ---------------------------------------------------------------------------
# Watch for results
# ---------------------------------------------------------------------------

st.divider()
st.markdown("#### Results")

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
    help="Checks for new violations every 3 seconds, for up to two minutes.",
)

if watch:
    baseline = st.session_state.get("violations_before", before)
    placeholder = st.empty()
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            total = client.list_violations(site["id"], limit=1)["total"]
        except (ApiError, ApiUnreachable) as exc:
            ui.error(exc)
            break
        if total > baseline:
            placeholder.success(f"{total - baseline} new violation(s) recorded.", icon="🚨")
            break
        placeholder.info(
            f"Watching… {total} violations recorded. "
            f"{int(deadline - time.time())}s left of automatic checking.",
            icon="⏳",
        )
        time.sleep(3)
    else:
        placeholder.warning(
            "Stopped checking after two minutes. Detection may still be running — it "
            "processes the whole video, so a long video takes a while. Press Refresh to "
            "check again.",
            icon="⌛",
        )

if before and st.button("Review violations →"):
    st.switch_page("pages/4_Violations.py")

with st.expander("Why there is no progress bar"):
    st.markdown(
        """
The system does not report how far along a detection run is — it only records
violations as they are found. The violation count above is therefore the only reliable
sign of progress; a progress bar would have to show a made-up number.

Each run processes the entire video in one go. Splitting long videos into shorter,
overlapping segments is planned for a later version.
"""
    )
