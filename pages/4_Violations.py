"""The review queue, and one violation in full.

Master-detail on one page: a gallery until a violation is opened, then everything the
API knows about that one. The split mirrors the API's own — the list route never joins
the metadata blob or the explanation detail, precisely so a page of violations does not
drag every track's trajectory along with it, and only the detail route pays for them.

THE EXPLAIN BUTTON IS A POST AND IT DOES NOT WAIT. The route answers 202 and hands the
work to an actor; the answer arrives on the row tens of seconds later. So the button
fires and then polls `status`, which is exactly what the route's docstring says a client
should do. Nothing here blocks a request thread on a model call.
"""

from __future__ import annotations

import time

import requests
import streamlit as st

from lib import evidence, ui
from lib.api import ApiError, ApiUnreachable

st.set_page_config(page_title="Violations", page_icon="🚨", layout="wide")

client = ui.sidebar()
site = ui.site_selector(client)

if site is None:
    st.title("🚨 Violations")
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
    if not source_id:
        return None, None
    try:
        source = client.get_source(site_id, source_id)
    except (ApiError, ApiUnreachable):
        return None, None
    metadata = (source or {}).get("metadata") or {}
    resolution = metadata.get("resolution") or {}
    size = (resolution["width"], resolution["height"]) if resolution.get("width") else None
    return metadata.get("fps"), size


# ===========================================================================
# Detail
# ===========================================================================

selected = st.session_state.get("violation_id")

if selected:
    if st.button("← Back to the list"):
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

    st.title(violation["type"].replace("_", " ").title())
    st.markdown(
        ui.labelled_chip("explanation", violation["status"])
        + "&nbsp;&nbsp;&nbsp;"
        + ui.labelled_chip("evidence", violation.get("evidence_status"))
        + "&nbsp;&nbsp;&nbsp;"
        + (ui.labelled_chip("severity", violation["severity"]) if violation.get("severity") else ""),
        unsafe_allow_html=True,
    )
    st.caption(
        f"`{violation['id']}` · detected {ui.ts(violation['detected_at'])} · "
        f"{ui.frame_time(frame_index, fps)}"
    )

    if violation.get("evidence_status") is None:
        st.info(
            "No evidence clip exists for this violation — it was recorded before evidence "
            "clips were introduced, so none will be created.",
            icon="🗃️",
        )

    media, verdict = st.columns([3, 2], gap="large")

    # ---- evidence ---------------------------------------------------------

    with media:
        st.markdown("#### Evidence")

        tracks = evidence.tracks_of(violation.get("metadata"))
        violator_id = (violation.get("metadata") or {}).get("violator_track_id")

        if tracks:
            options = [t.track_id for t in tracks]
            default = evidence.default_selection(tracks, violator_id)
            chosen = st.multiselect(
                "Vehicles to highlight",
                options,
                default=default,
                format_func=lambda tid: next(t.label for t in tracks if t.track_id == tid),
                help=(
                    "Up to three at a time, so the colours stay easy to tell apart, including for "
                    "colour-blind viewers. Other vehicles are still outlined in grey."
                ),
            )
            if len(chosen) > len(evidence.SERIES):
                st.warning(
                    f"Showing the first {len(evidence.SERIES)} — see the help above.",
                    icon="🎨",
                )
                chosen = chosen[: len(evidence.SERIES)]
            colours = evidence.colour_map(chosen)
        else:
            colours = {}

        if violation.get("thumbnail_url"):
            try:
                raw = fetch_bytes(violation["thumbnail_key"], violation["thumbnail_url"])
            except requests.RequestException as exc:
                st.error(f"Could not load the image: {exc}", icon="🖼️")
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
            st.info("The image is still being prepared.", icon="⏳")
        elif violation.get("evidence_status") == "failed":
            st.warning("The evidence clip could not be created for this violation.", icon="✂️")

        if violation.get("clip_url"):
            st.markdown("**Clip**")
            st.video(violation["clip_url"])
            st.caption(
                "The clip covers the same time span as the violation record."
            )

    # ---- explanation ------------------------------------------------------

    with verdict:
        st.markdown("#### AI reviewer's note")
        # Normalised as one document rather than field by field: the prose, both lists
        # of reasoning, the observations and the plate note are all free text the model
        # wrote, and any of them can carry an escape that was never decoded.
        detail = ui.unescape(violation.get("explanation_detail"))
        status = violation["status"]

        if status == "explained" and detail:
            if not detail.get("flag_sustained", True):
                st.warning(
                    "The AI reviewer did **not** confirm this violation — it judged that the "
                    "evidence does not support it.",
                    icon="🚫",
                )
            st.markdown(detail["explanation"])

            st.markdown(
                ui.labelled_chip("severity", detail.get("severity"))
                + "&nbsp;&nbsp;&nbsp;"
                + ui.labelled_chip("evidence", detail.get("evidence_strength")),
                unsafe_allow_html=True,
            )
            st.caption(
                "Two separate ratings. Severity is how much risk the behaviour posed to other "
                "road users; evidence strength is how well the recorded data supports the "
                "violation. A serious event can have weak evidence, so they are shown "
                "separately."
            )

            if detail.get("severity_basis"):
                st.markdown("**Why that severity**")
                for reason in detail["severity_basis"]:
                    st.markdown(f"- {reason}")
            if detail.get("evidence_basis"):
                st.markdown("**What the record establishes**")
                for reason in detail["evidence_basis"]:
                    st.markdown(f"- {reason}")
            if detail.get("observations"):
                st.markdown("**Observations**")
                for note in detail["observations"]:
                    st.markdown(f"- {note}")

            plate = detail.get("license_plate")
            if plate:
                st.markdown("**License plate**")
                st.markdown(ui.chip(plate["recoverability"]), unsafe_allow_html=True)
                st.caption(plate["reasoning"])
                st.caption(
                    "A suggestion for how the plate could be identified — not a plate reading. This "
                    "system does not read license plates."
                )

        elif status == "pending":
            st.info("The AI review is in progress. Use the button below to check for the result.", icon="⏳")
        elif status == "failed":
            st.error(
                "The last attempt failed and is not retried automatically. Press the button "
                "below to try again.",
                icon="⚠️",
            )
        else:
            ui.empty("Not reviewed yet.", "This violation has not been sent for AI review.")

        label = {
            "detected": "Request AI review",
            "failed": "Try AI review again",
            "explained": "Re-check status",
            "pending": "Check for the result",
        }[status]

        if st.button(label, type="primary", width="stretch"):
            try:
                client.explain(site["id"], violation["id"])
            except (ApiError, ApiUnreachable) as exc:
                ui.error(exc)
            else:
                # 202 means work was accepted; 200 means there was nothing to do. The
                # body is the violation either way and the status says which, so the
                # poll below is the same code path for both.
                box = st.empty()
                deadline = time.time() + 180
                while time.time() < deadline:
                    try:
                        current = client.get_violation(site["id"], violation["id"])
                    except (ApiError, ApiUnreachable) as exc:
                        ui.error(exc)
                        break
                    if current["status"] != "pending":
                        box.success(f"Finished: {current['status']}.", icon="✅")
                        time.sleep(0.6)
                        st.rerun()
                    box.info(
                        f"Reviewing… {int(deadline - time.time())}s left of automatic checking. "
                        "The AI review can take a minute or two.",
                        icon="⏳",
                    )
                    time.sleep(2)
                else:
                    box.warning(
                        "Still in progress after three minutes. The result is not lost — it will appear "
                        "here when ready, so check back later.",
                        icon="⌛",
                    )

        st.caption(
            "Safe to press more than once: a violation is only sent for review once, and a "
            "finished review is simply shown again."
        )

    # ---- trajectories -----------------------------------------------------

    if tracks and colours:
        st.divider()
        st.markdown("#### Vehicle paths")
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
                icon="📐",
            )

        ground, speed = st.columns(2, gap="large")
        with ground:
            st.markdown("**Top-down view of the road** (metres, estimated)")
            chart = evidence.ground_plot(tracks, colours, fps, moment)
            if chart is None:
                st.info(
                    "No positions available — this site had no camera calibration when the "
                    "violation was found, so positions could not be estimated.",
                    icon="📐",
                )
            else:
                st.altair_chart(chart, width="stretch")
                st.caption("The diamond marks each vehicle's position at the moment of the violation.")

        with speed:
            st.markdown("**Estimated speed over time** (m/s)")
            chart = evidence.speed_plot(tracks, colours, fps, moment)
            if chart is None:
                st.info("No speeds available for the selected vehicles.", icon="📈")
            else:
                st.altair_chart(chart, width="stretch")

        with st.expander("The same numbers, as a table"):
            st.dataframe(evidence.table(tracks, colours, fps), width="stretch", height=300)

        with st.expander("Vehicles in this violation"):
            for track in tracks:
                mark = " ⚠️ **violator**" if track.track_id == violator_id else ""
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

    with st.expander("Technical details"):
        st.json(violation)

    st.stop()

# ===========================================================================
# Gallery
# ===========================================================================

st.title("🚨 Violations")
st.caption(
    f"**{site['name']}** — the violations that hold under the setup this site is running "
    "now. There are no filter parameters, and the absence is the design: re-calibrate a "
    "site and this list changes without a violation being touched."
)

st.session_state.setdefault("violations_offset", 0)
per_page = st.selectbox("Per page", [6, 12, 24, 48], index=1)

try:
    page = client.list_violations(site["id"], limit=per_page, offset=st.session_state["violations_offset"])
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

if not page["items"]:
    ui.empty("No violations recorded for this site.", "Start a run on the Detection page.")
    st.stop()

fps, _ = source_facts(site["id"], page["items"][0].get("source_id"))

counts: dict[str, int] = {}
for item in page["items"]:
    counts[item["status"]] = counts.get(item["status"], 0) + 1
st.markdown(
    " ".join(ui.chip(status, f"{status} {n}") for status, n in counts.items()),
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
                        fetch_bytes(item["thumbnail_key"], item["thumbnail_url"]),
                        width="stretch",
                    )
                except requests.RequestException:
                    ui.empty("Image unavailable")
            else:
                ui.empty(
                    "No thumbnail",
                    "still being prepared" if item.get("evidence_status") == "pending" else "no image",
                )

            st.markdown(f"**{item['type'].replace('_', ' ').title()}**")
            st.markdown(
                ui.chip(item["status"])
                + "&nbsp;"
                + ui.chip(item.get("evidence_status"))
                + ("&nbsp;" + ui.chip(item["severity"]) if item.get("severity") else ""),
                unsafe_allow_html=True,
            )
            st.caption(
                f"{ui.frame_time(item.get('frame_index'), fps)} · {ui.ts(item['detected_at'], with_seconds=False)}"
            )
            if item.get("explanation"):
                # Before truncating, not after: an escape straddling the cut would
                # otherwise be sliced into nonsense that no longer decodes.
                text = ui.unescape(item["explanation"])
                st.caption(text[:160] + ("…" if len(text) > 160 else ""))

            if st.button("Open", key=f"open_{item['id']}", width="stretch"):
                st.session_state["violation_id"] = item["id"]
                st.rerun()

st.divider()
back, forward = st.columns(2)
if back.button("← Previous", disabled=page["offset"] == 0, width="stretch"):
    st.session_state["violations_offset"] = max(0, page["offset"] - per_page)
    st.rerun()
if forward.button(
    "Next →",
    disabled=page["offset"] + len(page["items"]) >= page["total"],
    width="stretch",
):
    st.session_state["violations_offset"] = page["offset"] + per_page
    st.rerun()
