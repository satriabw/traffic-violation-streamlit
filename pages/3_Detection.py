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

st.markdown("#### Source")

if not source:
    st.warning("This site has no source. Attach one on Site Setup.", icon="⚠️")
elif source["kind"] != "video":
    st.warning(
        "Detection runs on a video source, not a stream — a live feed has no frame "
        "count to bound a job with. The API answers 409.",
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
        f"source `{source['id']}` v{source['version']} — the job pins this version, so "
        "attaching a new video while the job sits in the queue cannot change what it reads."
    )

st.divider()
st.markdown("#### Queue a run")

types = st.multiselect(
    "Violation types",
    VIOLATION_TYPES,
    default=[],
    format_func=lambda t: t.replace("_", " "),
    help=(
        "Leave empty for every type the backend knows about. That is not the same as "
        "ticking both by hand — an unset list means 'whatever the server supports', so "
        "the run keeps working when a new type is added."
    ),
)
if not types:
    st.caption("Empty → every type the server supports.")

runnable = bool(source and source["kind"] == "video" and (source.get("metadata") or {}).get("total_frames"))

if st.button("Queue detection", type="primary", disabled=not runnable):
    try:
        job = client.detect(site["id"], types or None)
    except (ApiError, ApiUnreachable) as exc:
        ui.error(exc)
    else:
        st.session_state["last_job"] = job
        st.session_state["violations_before"] = before
        st.toast("Job queued", icon="🎯")

job = st.session_state.get("last_job")
if job and job["site_id"] == site["id"]:
    st.markdown("#### Last job queued from here")
    with st.container(border=True):
        cols = st.columns(4)
        cols[0].caption(f"**job**\n\n`{job['id']}`")
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
            "Versions were resolved to numbers when the job was created, while "
            "'active' still meant what you asked for — a document uploaded after this "
            "cannot change what the run is judged against."
        )
    with st.expander("Raw job message"):
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
    "Watch for new ones",
    help="Polls the violation count every 3s for up to two minutes. There is no job "
    "status endpoint to poll instead — the count is the only observable.",
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
            f"{int(deadline - time.time())}s left before this stops polling.",
            icon="⏳",
        )
        time.sleep(3)
    else:
        placeholder.warning(
            "Stopped watching after two minutes. The worker may still be running — "
            "detection decodes the whole video, so a long clip takes a while.",
            icon="⌛",
        )

if before and st.button("Review violations →"):
    st.switch_page("pages/4_Violations.py")

with st.expander("Why there is no job progress bar"):
    st.markdown(
        """
The queue carries the job one way. `POST /sites/{id}/detect` enqueues a message and
returns 202 with the job's id, and there is no endpoint that reads a job back — the
worker's only output is rows in `traffic_violations`.

So the honest thing to poll is the violation count, which is what the toggle above
does. A progress bar here would be inventing a number the system does not have.

One job covers the whole video today. The chunked runs described in the design — 30
second windows with 10 seconds of overlap, which is what makes a violation on a chunk
boundary detectable — arrive with the pipeline that needs them.
"""
    )
