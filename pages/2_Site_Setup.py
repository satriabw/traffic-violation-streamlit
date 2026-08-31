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

            st.write("**1/4** Reserving a key and asking for an upload URL…")
            reserved = client.create_file(name, file_type, len(data), content_type)
            st.write(f"File `{reserved['id']}` reserved, status `{reserved['status']}`.")

            st.write("**2/4** PUTting the bytes straight to object storage…")
            client.put_object(reserved["upload_url"], data, content_type)
            st.write("Object storage accepted the upload.")

            st.write("**3/4** Confirming the upload with the API…")
            confirmed = client.complete_upload(reserved["id"])
            st.write(f"File is now `{confirmed['status']}`.")

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
        "An OpenCV FileStorage camera model. It is what turns pixel boxes into "
        "positions on the ground plane, so without one a violation has boxes but no "
        "trajectory and no speed. Units are metres, throughout.",
        ["yml", "yaml", "xml", "json"],
    )

with configuration_tab:
    versioned_section(
        "configurations",
        "configuration",
        "Scene configuration",
        "Which rules to run, and the polygons they run against. Sections are explicit "
        "— a region is a lane because it is in `lanes`, never because of what it is "
        "named — and `controls` is what says which lanes a traffic light governs.",
        ["json"],
    )

    with st.expander("Starter document"):
        st.caption(
            "The only format the detector understands is version 1, and it refuses "
            "anything else rather than parsing the parts it recognises. Unknown "
            "section names are rejected too: a typo like `roi` for `rois` would "
            "otherwise silently drop every polygon in it, and the only symptom would "
            "be a rule that never fires. A polygon needs at least three points."
        )
        starter = {
            "version": 1,
            "violations": ["rlr_violation"],
            "regions": {
                "lanes": [{"id": "lane_1", "points": [[115, 640], [430, 640], [400, 470], [210, 470]]}],
                "traffic_lights": [
                    {"id": "tl_1", "points": [[610, 90], [650, 90], [650, 160], [610, 160]], "controls": ["lane_1"]}
                ],
                "rois": [{"id": "roi_1", "points": [[100, 430], [700, 430], [700, 520], [100, 520]]}],
            },
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
        "Attaching a source appends a version rather than replacing one, so what the "
        "site used to point at stays on record — and a detection job already in the "
        "queue keeps reading the video it was created for."
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
            # The number is this page's arithmetic, not the backend's — and the
            # backend is the one detection asks. Saying so here is the difference
            # between a reader who understands the 409 and one who thinks it is a bug.
            st.warning(
                "The frame count is this page's estimate (duration × fps) — the "
                "container stored none, so the API has no `total_frames` and "
                "**detection will refuse this source with a 409**. Re-attach the video "
                "to have it remuxed to MP4, which carries a real count.",
                icon="⚠️",
            )
        st.caption(f"source `{source['id']}`")
    else:
        st.info("No source attached. Detection has nothing to run against.", icon="🎥")

    st.divider()
    video, stream = st.tabs(["Upload a video", "Point at a stream"])

    with video:
        st.caption(
            "The video is probed as it is attached — the container header is read over "
            "range requests, a couple of megabytes whatever the file's size — so a file "
            "that cannot be decoded is refused now rather than failing every detection "
            "job later."
        )
        st.caption(
            "A container that records no frame count (Matroska does not) is remuxed to "
            "MP4 first, with `-c copy` — no re-encode and no quality change. Without a "
            "frame count the source attaches but detection answers 409, so this happens "
            "before the upload rather than being discovered afterwards."
        )
        uploaded = st.file_uploader("Video file", type=["mp4", "mov", "mkv", "avi"], key="up_video")
        if uploaded and st.button("Upload and attach as source", type="primary", key="btn_video"):
            upload_and_attach(
                uploaded,
                "video",
                lambda file_id: client.create_source(site["id"], "video", file_id=file_id),
            )

    with stream:
        st.caption(
            "A stream is neither checked nor probed here: it carries no index to read, "
            "and connecting to a live feed would block on a camera that may not be up "
            "yet. Note that detection runs on videos — a stream has no frame count to "
            "bound a job with, and the detect endpoint answers 409."
        )
        url = st.text_input("Stream URL", placeholder="rtsp://…", key="stream_url_input")
        if url and st.button("Attach stream", key="btn_stream"):
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
    checks = [
        ("Video source attached", bool(source and source.get("kind") == "video")),
        (
            "Video metadata probed",
            bool(source and (source.get("metadata") or {}).get("total_frames")),
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
    "The first two are enforced — detection answers 409 without them. A configuration "
    "and a calibration are not: a job runs without either, it just has fewer rules it "
    "can evaluate and no ground-plane trajectory to show for it."
)

if all(ok for _, ok in checks[:2]) and st.button("Go to Detection →", type="primary"):
    st.switch_page("pages/3_Detection.py")
