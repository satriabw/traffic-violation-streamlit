"""The review queue, and one violation in full.

Master-detail on one page: a gallery until a violation is opened, then everything the
API knows about that one. The split mirrors the API's own — the list route never joins
the metadata blob, precisely so a page of violations does not drag every track's
trajectory along with it, and only the detail route pays for them.

THE REVIEW BUTTON STARTS A REVIEW AND THEN FOLLOWS IT. `POST .../review` answers 202 and
hands the work to an actor; the review then writes its steps to `.../review/events` as
it goes, a minute or more of them. The page follows that stream and draws each step in
place, and the finished review is read from `GET .../review`. Nothing here blocks a
request thread on a model call — the stream is the server reading rows it has stored.
"""

from __future__ import annotations

import requests
import streamlit as st

from lib import evidence, live, review, ui
from lib.api import ApiError, ApiUnreachable


client = ui.sidebar()
site = ui.site_selector(client)

if site is None:
    ui.page_header("Violations", eyebrow="Monitoring")
    ui.empty("Pick a site in the sidebar.")
    st.stop()


@st.cache_data(show_spinner=False, ttl=900, max_entries=64)
def fetch_bytes(cache_key: str, _url: str) -> bytes:
    """Evidence objects, cached by their immutable key rather than their URL.

    The URL is a presigned link minted fresh on every read, so caching on it would miss
    every time. The key underneath it is stable for the life of the object — the worker
    rewrites both keys on every transition, so a key never outlives what it points at.
    The leading underscore keeps the volatile URL out of the hash.
    """
    response = requests.get(_url, timeout=90)
    response.raise_for_status()
    return response.content


def source_facts(site_id: str, source_id: str | None) -> tuple[float | None, tuple[int, int] | None]:
    """fps and resolution for the source this violation was found in."""
    source = ui.source_of(client, site_id, source_id)
    metadata = (source or {}).get("metadata") or {}
    resolution = metadata.get("resolution") or {}
    size = (resolution["width"], resolution["height"]) if resolution.get("width") else None
    return metadata.get("fps"), size


# ===========================================================================
# Detail
# ===========================================================================

selected = st.session_state.get("violation_id")

if selected:
    if st.button("Back to the list"):
        st.session_state.pop("violation_id")
        st.rerun()

    try:
        violation = client.get_violation(site["id"], selected)
    except (ApiError, ApiUnreachable) as exc:
        ui.error(exc)
        st.session_state.pop("violation_id")
        st.stop()

    fps, source_size = source_facts(site["id"], violation.get("source_id"))
    frame_index = violation.get("frame_index")
    moment = frame_index / fps if (frame_index is not None and fps) else None

    source = ui.source_of(client, site["id"], violation.get("source_id"))
    ui.page_header(
        violation["type"].replace("_", " ").capitalize(),
        ui.event_time(source, frame_index, violation["detected_at"]),
        eyebrow=f"Violation · {site['name']}",
    )
    st.markdown(
        ui.labelled_chip("review", violation["explanation_status"], review.chip_label(violation["explanation_status"]))
        + "&nbsp;&nbsp;&nbsp;"
        + ui.labelled_chip("evidence", violation.get("evidence_status")),
        unsafe_allow_html=True,
    )
    st.caption(
        f"`{violation['id']}` · {ui.frame_time(frame_index, fps)} · "
        f"processed {ui.ts(violation['detected_at'])}"
    )

    def _version(label: str, version: int | None) -> str:
        return f"{label} v{version}" if version is not None else f"no {label}"

    # Pinned when the session started, so these name what the violation was judged
    # under — not what the site has attached now.
    st.caption(
        " · ".join(
            [
                (violation.get("source_name") or "source")
                + (f" v{violation['source_version']}" if violation.get("source_version") is not None else ""),
                _version("calibration", violation.get("calibration_version")),
                _version("configuration", violation.get("configuration_version")),
                f"run `{violation['run_id']}`",
            ]
        )
    )

    if violation.get("evidence_status") is None:
        st.info(
            "No evidence clip exists for this violation — it was recorded before evidence "
            "clips were introduced, so none will be created.",
            icon=":material/inventory_2:",
        )

    media, verdict = st.columns([3, 2], gap="large")

    # ---- evidence ---------------------------------------------------------

    with media:
        st.markdown("#### Evidence")

        tracks = evidence.tracks_of(violation.get("metadata"))
        violator_id = (violation.get("metadata") or {}).get("violator_track_id")
        judged = (
            live.configuration_version(client.base_url, site["id"], violation["configuration_id"])
            if violation.get("configuration_id")
            else None
        )
        # Only the violator and the pedestrians in the crosswalk are offered: everyone
        # else in the frame is context, outlined in grey on the image and nowhere else.
        involved = evidence.involved(tracks, violator_id, judged, frame_index, fps)

        if involved:
            options = [t.track_id for t in involved]
            chosen = st.multiselect(
                "Road users to highlight",
                options,
                default=options[: len(evidence.SERIES)],
                format_func=lambda tid: next(t.label for t in involved if t.track_id == tid),
                help=(
                    "The violating vehicle and the pedestrians in the crosswalk during the event. "
                    "Up to three at a time, so the colours stay easy to tell apart, including for "
                    "colour-blind viewers. Everyone else is still outlined in grey on the image."
                ),
            )
            if len(chosen) > len(evidence.SERIES):
                st.warning(
                    f"Showing the first {len(evidence.SERIES)} — see the help above.",
                    icon=":material/palette:",
                )
                chosen = chosen[: len(evidence.SERIES)]
            colours = evidence.colour_map(chosen)
        else:
            colours = {}

        if violation.get("thumbnail_url"):
            try:
                raw = fetch_bytes(violation["thumbnail_key"], client.absolute(violation["thumbnail_url"]))
            except requests.RequestException as exc:
                st.error(f"Could not load the image: {exc}", icon=":material/broken_image:")
            else:
                if tracks:
                    st.image(
                        evidence.draw_boxes(raw, tracks, frame_index, source_size, colours, violator_id),
                        caption=f"Frame {frame_index} with the detected vehicles outlined.",
                        width="stretch",
                    )
                    st.caption(
                        "Outlines are drawn on top of the original, unedited video frame."
                    )
                else:
                    st.image(raw, width="stretch")
        elif violation.get("evidence_status") == "pending":
            st.info("The image is still being prepared.", icon=":material/hourglass_top:")
        elif violation.get("evidence_status") == "failed":
            st.warning("The evidence clip could not be created for this violation.", icon=":material/content_cut:")

        if violation.get("clip_url"):
            st.markdown("**Clip**")
            st.video(ui.browser_url(client, violation["clip_url"]))
            st.caption(
                "The clip covers the same time span as the violation record."
            )

    # ---- review -----------------------------------------------------------

    with verdict:
        st.markdown("#### Evidence review")
        status = violation["explanation_status"]
        follow = st.session_state.pop("follow_review", None) == violation["id"]

        if status == "pending" or follow:
            # Running: follow the steps until it finishes, then draw the result.
            with st.status("The review is running…", expanded=True) as box:
                progress = review.follow(client, site["id"], violation["id"])
                failed = progress.broken or (progress.error and progress.review is None)
                box.update(
                    label="Lost the review's stream" if progress.broken
                    else "The review failed" if failed else "Review finished",
                    state="error" if failed else "complete",
                    expanded=False,
                )
            if progress.broken:
                st.warning(
                    f"{progress.broken}\n\nThe review goes on without this page; reload to follow it again.",
                    icon=":material/cloud_off:",
                )
            else:
                st.rerun()

        try:
            current = client.get_review(site["id"], violation["id"])
        except (ApiError, ApiUnreachable) as exc:
            ui.error(exc)
            current = None

        if current and current["status"] == "completed" and current.get("review"):
            steps = None
            if st.toggle(
                "Show the steps it took",
                help=(
                    "The tracking facts it started from, what it asked the legal source and "
                    "what came back. Reading them plays the review back, so it takes a few seconds."
                ),
            ):
                try:
                    steps = review.steps_of(client.base_url, site["id"], violation["id"], violation["updated_at"])
                except (ApiError, ApiUnreachable) as exc:
                    ui.error(exc)
            review.draw(current["review"], steps)
            if steps is not None:
                st.divider()
                review.draw_steps(steps)
        elif current and current["status"] == "failed":
            st.error(
                "The last review failed and is not retried automatically. Press the button "
                "below to try again."
                + (f"\n\n{current['error']}" if current.get("error") else ""),
                icon=":material/warning:",
            )
        elif current and current["status"] == "running":
            st.info("The review is still running.", icon=":material/hourglass_top:")
        else:
            ui.empty("Not reviewed yet.", "This violation has not been sent for review.")

        if status in ("detected", "failed"):
            label = "Start the review" if status == "detected" else "Review again"
            if st.button(label, type="primary", width="stretch"):
                try:
                    client.start_review(site["id"], violation["id"])
                except (ApiError, ApiUnreachable) as exc:
                    ui.error(exc)
                else:
                    # 202 started one, 200 found one running or done; following covers both.
                    st.session_state["follow_review"] = violation["id"]
                    st.rerun()
            st.caption(
                "Safe to press more than once: a violation is only reviewed once at a time, "
                "and a finished review is simply shown again."
            )

    # ---- trajectories -----------------------------------------------------

    if tracks and colours:
        st.divider()
        st.markdown("#### Paths of the involved road users")
        st.caption(
            "Paths are shown on a top-down map in metres rather than over the video image, "
            "because camera perspective distorts distance: the same on-screen gap can be a "
            "few metres near the camera and tens of metres far away. **Positions and speeds "
            "are estimates** based on the camera calibration."
        )

        fastest = evidence.implausible(tracks, colours)
        if fastest is not None:
            st.warning(
                f"The fastest vehicle here is estimated at **{fastest:.0f} m/s** — about "
                f"{fastest * 3.6:.0f} km/h, which is not realistic. This usually means the camera "
                "calibration is inaccurate, which makes all speeds and positions on "
                "this page unreliable. The detection itself and its timing are not "
                "affected.",
                icon=":material/straighten:",
            )

        ground, speed = st.columns(2, gap="large")
        with ground:
            st.markdown("**Top-down view of the road** (metres, estimated)")
            camera = (judged or {}).get("camera") or {}
            picture = source_size or (
                (camera["width"], camera["height"]) if camera.get("width") and camera.get("height") else None
            )
            view = evidence.camera_view(violation.get("metadata"), picture)
            zones = evidence.ground_zones(violation.get("metadata"), judged)
            chart = evidence.ground_plot(tracks, colours, fps, moment, zones, view)
            if chart is None:
                st.info(
                    "No positions available — this site had no camera calibration when the "
                    "violation was found, so positions could not be estimated.",
                    icon=":material/straighten:",
                )
            else:
                st.altair_chart(chart, width="stretch")
                st.caption(
                    "The diamond marks each road user's position at the moment of the violation."
                    + (
                        " Turned to match the camera: up is further into the picture, left and "
                        "right are the picture's own."
                        if view
                        else ""
                    )
                    + (
                        " Dashed outlines are the configuration's zones, carried onto the ground "
                        "with the same projection as the paths; thick lines are the edges a zone "
                        "names, such as a crossing's kerbs."
                        if not zones.empty
                        else ""
                    )
                )

        with speed:
            st.markdown(f"**Estimated speed, last {evidence.SPEED_WINDOW_SECONDS:.0f} seconds** (m/s)")
            chart = evidence.speed_plot(tracks, colours, fps, moment)
            if chart is None:
                st.info("No speeds available for the selected vehicles.", icon=":material/show_chart:")
            else:
                st.altair_chart(chart, width="stretch")

        with st.expander("Road users involved in this violation"):
            for track in involved:
                mark = " · :red[**violator**]" if track.track_id == violator_id else ""
                st.markdown(
                    f"- `{track.label}` — {len(track.frame_idxs)} samples, "
                    f"frames {track.frame_idxs[0]}–{track.frame_idxs[-1]}{mark}"
                    if track.frame_idxs
                    else f"- `{track.label}` — no samples{mark}"
                )
            if violator_id is None:
                st.caption(
                    "This record does not mark which vehicle committed the violation — it was "
                    "recorded before that information was stored."
                )

    st.stop()

# ===========================================================================
# Gallery
# ===========================================================================

ui.page_header(
    "Violations",
    "Current violations for this site. Runs judged under a document later marked invalid are left out.",
    eyebrow=f"Monitoring · {site['name']}",
)

st.session_state.setdefault("violations_offset", 0)
controls = st.columns([1, 3])
per_page = controls[0].selectbox("Per page", [6, 12, 24, 48], index=1)

try:
    runs = client.list_runs(site["id"], limit=100)["items"]
except (ApiError, ApiUnreachable):
    runs = []
run_labels = {
    r["id"]: f"{ui.run_span(ui.source_of(client, site['id'], r.get('source_id')), r)} · {r['status']}"
    for r in runs
}
run_id = controls[1].selectbox(
    "Run",
    [None, *run_labels],
    format_func=lambda r: "All runs" if r is None else run_labels[r],
    help="One run per window of footage, newest first.",
    on_change=lambda: st.session_state.update(violations_offset=0),
)

try:
    page = client.list_violations(
        site["id"], limit=per_page, offset=st.session_state["violations_offset"], run_id=run_id
    )
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

if not page["items"]:
    ui.empty(
        "No violations recorded for this run." if run_id else "No violations recorded for this site.",
        "Start a run on the Detection page.",
    )
    st.stop()

counts: dict[str, int] = {}
for item in page["items"]:
    counts[item["explanation_status"]] = counts.get(item["explanation_status"], 0) + 1
st.markdown(
    " ".join(review.review_chip(status, n) for status, n in counts.items()),
    unsafe_allow_html=True,
)
st.caption(f"Showing {page['offset'] + 1}–{page['offset'] + len(page['items'])} of {page['total']}")
st.divider()

columns = st.columns(3, gap="medium")
for i, item in enumerate(page["items"]):
    with columns[i % 3]:
        with st.container(border=True):
            if item.get("thumbnail_url"):
                try:
                    st.image(
                        fetch_bytes(item["thumbnail_key"], client.absolute(item["thumbnail_url"])),
                        width="stretch",
                    )
                except requests.RequestException:
                    ui.empty("Image unavailable")
            else:
                ui.empty(
                    "No thumbnail",
                    "still being prepared" if item.get("evidence_status") == "pending" else "no image",
                )

            st.markdown(f"**{item['type'].replace('_', ' ').capitalize()}**")
            st.markdown(
                review.review_chip(item["explanation_status"])
                + "&nbsp;"
                + ui.chip(item.get("evidence_status")),
                unsafe_allow_html=True,
            )
            st.caption(
                ui.event_time(
                    ui.source_of(client, site["id"], item.get("source_id")),
                    item.get("frame_index"),
                    item["detected_at"],
                )
            )
            if st.button("Open", key=f"open_{item['id']}", width="stretch"):
                st.session_state["violation_id"] = item["id"]
                st.rerun()

st.divider()
back, forward = st.columns(2)
if back.button("Previous", disabled=page["offset"] == 0, width="stretch"):
    st.session_state["violations_offset"] = max(0, page["offset"] - per_page)
    st.rerun()
if forward.button(
    "Next",
    disabled=page["offset"] + len(page["items"]) >= page["total"],
    width="stretch",
):
    st.session_state["violations_offset"] = page["offset"] + per_page
    st.rerun()
