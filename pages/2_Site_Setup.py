"""Everything a site needs before it can detect anything.

THE UPLOAD IS THREE CALLS AND THE MIDDLE ONE DOES NOT TOUCH THE API. site-service hands
back a presigned URL, the browser-side bytes go straight to R2, and a third call
confirms the object arrived. The Postman collection walks it by hand; here it is one
button, and the steps are shown as they happen so a failure names which of the three
broke.

Calibrations and configurations are versioned: attaching never replaces, it appends. So
this page shows the active version and adds a new one, and never offers to overwrite —
because the API does not, and pretending otherwise would misdescribe what the button does.
"""

from __future__ import annotations

import datetime as dt
import json
import mimetypes

import streamlit as st

from lib import ui, video as videolib
from lib.api import ApiError, ApiUnreachable

st.set_page_config(page_title="Site Setup", page_icon="⚙️", layout="wide")

client = ui.sidebar()
site = ui.site_selector(client)

st.title("⚙️ Site Setup")

if site is None:
    ui.empty("Pick a site in the sidebar.", "Or create one on the Sites page.")
    st.stop()

st.caption(f"Configuring **{site['name']}** · `{site['id']}`")


def upload_and_attach(uploaded, file_type: str, attach) -> None:
    """The three-call upload, then whatever references the resulting file.

    `attach` is a callable taking the confirmed file id, so the same wizard serves
    calibrations, configurations and video sources without knowing what any of them are.
    """
    data = uploaded.getvalue()
    name = uploaded.name
    content_type = uploaded.type or mimetypes.guess_type(name)[0]

    with st.status(f"Uploading {name} ({ui.bytes_human(len(data))})", expanded=True) as box:
        try:
            if file_type == "video":
                # Before anything leaves here, because the container is what decides
                # whether the backend's probe finds a frame count — and without one the
                # source attaches fine and then detection refuses it with a 409.
                data, name, content_type, note = videolib.ensure_frame_count(
                    data, name, content_type
                )
                if note:
                    st.write(note)

            st.write("**1/4** Preparing the upload…")
            reserved = client.create_file(name, file_type, len(data), content_type)
            st.write("Upload prepared.")

            st.write("**2/4** Uploading the file…")
            client.put_object(reserved["upload_url"], data, content_type)
            st.write("File uploaded.")

            st.write("**3/4** Checking the upload…")
            confirmed = client.complete_upload(reserved["id"])
            st.write("Upload checked.")

            st.write("**4/4** Attaching it to the site…")
            result = attach(confirmed["id"])
        except (ApiError, ApiUnreachable) as exc:
            box.update(label=f"Failed: {name}", state="error")
            ui.error(exc)
            return
        box.update(label=f"Attached {name}", state="complete")

    st.success("Done.")
    st.json(result, expanded=False)
    st.rerun()


def versioned_section(resource: str, file_type: str, title: str, blurb: str, types: list[str]) -> None:
    """Calibrations and configurations are the same endpoint shape, so they are the
    same section — exactly as the backend builds both routers from one factory."""
    st.markdown(f"#### {title}")
    st.caption(blurb)

    try:
        active = client.get_active_doc(site["id"], resource)
    except (ApiError, ApiUnreachable) as exc:
        ui.error(exc)
        return

    if active:
        cols = st.columns([1, 1, 2])
        cols[0].metric("Active version", f"v{active['version']}")
        cols[1].caption(f"attached {ui.ts(active['created_at'], with_seconds=False)}")
        cols[2].caption(f"file `{active['file_id']}`\n\ndoc `{active['id']}`")
        try:
            file = client.get_file(active["file_id"])
            cols[2].caption(f"{file['name']} · {ui.bytes_human(file.get('size_bytes'))}")
        except (ApiError, ApiUnreachable):
            pass

        with st.expander(f"Found v{active['version']} wrong?"):
            st.caption(
                "Marks every run judged under this version invalid: they leave the run "
                "list and their violations leave the review queue. The version itself "
                "stays — upload a corrected one and run detection again."
            )
            reason = st.text_input("Reason", key=f"reason_{resource}")
            if st.button(
                "Invalidate its runs",
                key=f"invalidate_{resource}",
                disabled=not reason.strip(),
            ):
                try:
                    n = client.invalidate_doc(site["id"], resource, active["id"], reason.strip())
                except (ApiError, ApiUnreachable) as exc:
                    ui.error(exc)
                else:
                    st.success(f"{n} run(s) marked invalid.")
    else:
        st.info(f"No {resource[:-1]} attached yet.", icon="📄")

    uploaded = st.file_uploader(
        f"Upload a new {resource[:-1]}",
        type=types,
        key=f"up_{resource}",
    )
    if uploaded and st.button(
        f"Upload and attach as v{(active['version'] + 1) if active else 1}",
        key=f"btn_{resource}",
        type="primary",
    ):
        upload_and_attach(
            uploaded,
            file_type,
            lambda file_id: client.create_doc(site["id"], resource, file_id),
        )


calibration_tab, configuration_tab, source_tab = st.tabs(
    ["Calibration", "Configuration", "Video source"]
)

with calibration_tab:
    versioned_section(
        "calibrations",
        "calibration",
        "Camera calibration",
        "The camera calibration file. It converts positions in the video image into "
        "real positions on the road, in metres. Without it, violations can still be "
        "detected, but vehicle paths and speeds cannot be estimated.",
        ["yml", "yaml", "xml", "json"],
    )

with configuration_tab:
    versioned_section(
        "configurations",
        "configuration",
        "Scene configuration",
        "Which rules to check, and the road areas (polygons) they apply to. An area "
        "counts as a lane only when it is listed under `lanes`, whatever its name, and "
        "`controls` sets which lanes each traffic light governs. The optional `rules` "
        "block names the ROIs each rule reads; a rule without one reads every ROI.",
        ["json"],
    )

    with st.expander("Starter document"):
        st.caption(
            "Start from this template. Only format version 1 is accepted, and unknown "
            "section names are rejected — so a misspelt section name gives an error instead "
            "of silently disabling a rule. Each area needs at least three corner points. "
            "A `rules` entry may only name a rule listed under `violations` and ROIs "
            "declared under `rois`. Red light running (`rlr_violation`) is switched off on "
            "the server until it is validated."
        )
        starter = {
            "version": 1,
            "violations": ["pdx_violation"],
            "regions": {
                "lanes": [{"id": "lane_1", "points": [[115, 640], [430, 640], [400, 470], [210, 470]]}],
                "traffic_lights": [
                    {"id": "tl_1", "points": [[610, 90], [650, 90], [650, 160], [610, 160]], "controls": ["lane_1"]}
                ],
                "rois": [{"id": "crosswalk_1", "points": [[100, 430], [700, 430], [700, 520], [100, 520]]}],
            },
            "rules": {"pdx_violation": {"rois": ["crosswalk_1"]}},
        }
        body = json.dumps(starter, indent=2)
        st.code(body, language="json")
        st.download_button(
            "Download config.json",
            body,
            file_name="config.json",
            mime="application/json",
        )

with source_tab:
    st.markdown("#### Active source")
    st.caption(
        "Adding a new source keeps the previous ones on record. A detection session that "
        "has already started keeps using the source it started with."
    )

    try:
        source = client.get_active_source(site["id"])
    except (ApiError, ApiUnreachable) as exc:
        ui.error(exc)
        source = None

    if source:
        metadata = source.get("metadata") or {}
        resolution = metadata.get("resolution") or {}
        cols = st.columns(4)
        cols[0].markdown(ui.labelled_chip("status", source["status"]), unsafe_allow_html=True)
        cols[1].metric("Version", f"v{source['version']}")
        frames, estimated = videolib.displayed_frames(metadata)
        cols[2].metric("Frames", frames)
        cols[3].metric("FPS", f"{metadata['fps']:g}" if metadata.get("fps") else "—")
        if resolution.get("width"):
            st.caption(
                f"{resolution['width']}×{resolution['height']} · "
                f"{metadata.get('duration_seconds', 0):.2f}s · kind `{source['kind']}`"
            )
        if estimated:
            # The number is this page's arithmetic, not the backend's, so it is
            # marked as such.
            st.info(
                "The number of frames shown is estimated from the video length and frame rate, "
                "because this video file does not record it. Detection still runs: frames "
                "are counted as the video is cut into pieces.",
                icon="ℹ️",
            )
        st.caption(f"source `{source['id']}`")
    else:
        st.info("No source attached yet. Detection needs a video or a live feed to run.", icon="🎥")

    st.divider()
    video, stream = st.tabs(["Upload a video", "Use a live camera feed"])

    with video:
        st.caption(
            "The video is checked when it is added, so a file that cannot be read is "
            "rejected now rather than failing detection later."
        )
        st.caption(
            "Some video formats (such as MKV) do not record how many frames they contain. "
            "These are converted to MP4 automatically before uploading, with no loss of "
            "quality, so the frame count can be shown exactly."
        )
        uploaded = st.file_uploader("Video file", type=["mp4", "mov", "mkv", "avi"], key="up_video")
        known = st.checkbox(
            "I know when this video was recorded",
            key="recorded_known",
            help="Optional. Stored on the source so detections can be placed in real time.",
        )
        recorded_at = None
        if known:
            when = st.columns(2)
            day = when[0].date_input("Recording date", key="recorded_date")
            clock = when[1].time_input("Start time (local)", key="recorded_time", step=60)
            # The API refuses a naive datetime, so this machine's zone is attached.
            recorded_at = dt.datetime.combine(day, clock).astimezone().isoformat()
        if uploaded and st.button("Upload and use this video", type="primary", key="btn_video"):
            upload_and_attach(
                uploaded,
                "video",
                lambda file_id: client.create_source(
                    site["id"], "video", file_id=file_id, recorded_at=recorded_at
                ),
            )

    with stream:
        st.caption(
            "A live camera feed is not checked when added; it is probed when detection "
            "starts, and recorded until you stop it on the Detection page."
        )
        url = st.text_input("Stream URL", placeholder="rtsp://…", key="stream_url_input")
        if url and st.button("Add live feed", key="btn_stream"):
            try:
                result = client.create_source(site["id"], "stream", stream_url=url.strip())
            except (ApiError, ApiUnreachable) as exc:
                ui.error(exc)
            else:
                st.success(f"Attached as v{result['version']}.")
                st.rerun()

# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------

st.divider()
st.markdown("#### Ready to detect?")

try:
    is_stream = bool(source and source.get("kind") == "stream")
    checks = [
        ("Video or live feed attached", bool(source)),
        (
            "Live feed (checked when detection starts)" if is_stream else "Video checked",
            is_stream or bool(source and (source.get("metadata") or {}).get("fps")),
        ),
        ("Configuration attached", client.get_active_doc(site["id"], "configurations") is not None),
        ("Calibration attached", client.get_active_doc(site["id"], "calibrations") is not None),
    ]
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

for label, ok in checks:
    st.markdown(f"{'✅' if ok else '⬜'} {label}")

st.caption(
    "The first two are required before detection can run. Configuration and "
    "calibration are optional, but without them fewer rules can be checked, and "
    "vehicle paths and speeds cannot be estimated."
)

if all(ok for _, ok in checks[:2]) and st.button("Go to Detection →", type="primary"):
    st.switch_page("pages/3_Detection.py")
