"""One site, watched: its current source playing, with its configuration over it.

A recorded video plays in the browser from its download URL, with the regions drawn as
an SVG laid over the player. A live feed cannot play in a browser (RTSP), so it is read
here by lib.live and refreshed as a picture a couple of times a second, with the regions
drawn into each frame. Either way the overlay layers switch on and off without
interrupting what is playing.
"""

from __future__ import annotations

import html
import json
import time

import streamlit as st

from lib import live, ui
from lib.api import Api, ApiError, ApiUnreachable


client = ui.sidebar()
site = ui.site_selector(client)

ui.page_header("Site view", "The current source, with the scene configuration drawn over it.", eyebrow=f"Monitoring · {site['name']}" if site else "Monitoring")

if site is None:
    ui.empty("Pick a site in the sidebar.", "Or create one on the Sites page.")
    st.stop()

try:
    source = client.get_active_source(site["id"])
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()


if not source:
    ui.empty("This site has no source yet.", "Add a video or a live feed on Site Setup.")
    st.stop()

metadata = source.get("metadata") or {}
head = st.columns([1, 4])
head[0].markdown(ui.labelled_chip("source", source["status"]), unsafe_allow_html=True)
head[1].markdown(ui.source_label(client, source))

document, config_row = live.configuration(client.base_url, site["id"])
space = live.drawn_size(document, source)

# ---------------------------------------------------------------------------
# Overlay controls
# ---------------------------------------------------------------------------

controls = st.columns([1, 1, 1, 1, 2])
show = controls[0].toggle("Configuration", value=True, key="view_show", disabled=document is None)
layers = {
    layer
    for i, (layer, (label, colour)) in enumerate(live.LAYERS.items())
    if controls[i + 1].toggle(
        label, value=True, key=f"view_{layer}", disabled=not show or document is None
    )
}
labels = controls[4].toggle("Region names", value=True, key="view_labels", disabled=not show or document is None)
if not show:
    layers = set()

if document is None:
    st.caption("No configuration attached, so there is nothing to draw. Add one on Site Setup.")
else:
    counts = {
        layer: len(((document.get("regions") or {}).get(layer)) or [])
        for layer in live.LAYERS
    }
    st.markdown(
        " ".join(
            f'<span style="color:{colour};font-weight:600;">■</span> {label} {counts[layer]}'
            for layer, (label, colour) in live.LAYERS.items()
        )
        + f' &nbsp;·&nbsp; <span style="color:#64748b;">configuration v{config_row["version"]}'
        + (f", drawn on {space[0]}×{space[1]}" if space else "")
        + "</span>",
        unsafe_allow_html=True,
    )

shapes = live.regions(document, layers)

# ---------------------------------------------------------------------------
# Recorded video
# ---------------------------------------------------------------------------


@st.cache_data(show_spinner=False, ttl=600, max_entries=64)
def video_url(base_url: str, file_id: str) -> str | None:
    """Cached so a presigned URL stays the same across reruns — a new one each rerun
    would reload the player every time a toggle moved."""
    api = Api(base_url)
    try:
        file = api.get_file(file_id)
    except (ApiError, ApiUnreachable):
        return None
    return file.get("download_url")


PLAYER_HEIGHT = 620


def player(src: str, size: tuple[int, int], shapes: list, labels: bool) -> str:
    """A <video> with an SVG overlay in the same box. The SVG's viewBox is the
    configuration's pixel space, so the browser does the scaling."""
    polygons = []
    for layer, region_id, points in shapes:
        colour = live.LAYERS[layer][1]
        pts = " ".join(f"{x},{y}" for x, y in points)
        polygons.append(
            f'<polygon points="{pts}" fill="{colour}" fill-opacity="0.2" stroke="{colour}" '
            f'stroke-width="{max(2, size[0] // 400)}" stroke-linejoin="round"/>'
        )
        if labels:
            x, y = min(points, key=lambda p: (p[1], p[0]))
            polygons.append(
                f'<text x="{x}" y="{y}" fill="#fff" font-size="{max(14, size[0] // 70)}" '
                f'font-family="sans-serif" font-weight="700" paint-order="stroke" '
                f'stroke="{colour}" stroke-width="6">{html.escape(str(region_id))}</text>'
            )
    key = json.dumps(src)
    return f"""
<div style="position:relative;width:100%;max-width:{PLAYER_HEIGHT * size[0] / size[1]:.0f}px;margin:auto;aspect-ratio:{size[0]}/{size[1]};background:#000;">
  <video id="v" src="{html.escape(src)}" controls muted autoplay loop playsinline
         style="position:absolute;inset:0;width:100%;height:100%;"></video>
  <svg viewBox="0 0 {size[0]} {size[1]}" preserveAspectRatio="xMidYMid meet"
       style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">
    {''.join(polygons)}
  </svg>
</div>
<script>
  // A toggle redraws this frame; carry the playhead across so it does not restart.
  const v = document.getElementById("v"), k = "pos:" + {key};
  try {{ const t = parseFloat(sessionStorage.getItem(k)); if (t) v.currentTime = t; }} catch (e) {{}}
  v.addEventListener("timeupdate", () => {{ try {{ sessionStorage.setItem(k, v.currentTime); }} catch (e) {{}} }});
</script>
"""


if source["kind"] == "video":
    src = video_url(client.base_url, source["file_id"]) if source.get("file_id") else None
    src = ui.browser_url(client, src) if src else None
    size = space or (1920, 1080)
    if src is None:
        ui.empty("The video could not be found in storage.")
    else:
        st.iframe(player(src, size, shapes, labels), height=PLAYER_HEIGHT + 10)
        st.caption("The regions are drawn over the player; the video itself is the source as uploaded.")

# ---------------------------------------------------------------------------
# Live feed
# ---------------------------------------------------------------------------

else:
    default = live.reachable_url(source.get("stream_url") or "")
    url = st.text_input(
        "Watch from",
        value=default,
        key=f"view_url_{source['id']}",
        help=(
            "The feed's address as this machine can reach it. The stored address is what the "
            "backend's containers use; a service name there is swapped for 127.0.0.1 here."
        ),
    )
    watching = st.toggle("Watch live", value=True, key="view_watch")

    @st.fragment(run_every=1 / live.FPS if watching else None)
    def live_frame() -> None:
        if not watching:
            ui.empty("Paused.", "Switch on Watch live to start the feed.")
            return
        frame, error = live.feed(url).latest()
        if frame is None:
            if error:
                st.error(f"The feed could not be read: {error}", icon=":material/sensors_off:")
            else:
                st.info("Connecting to the feed…", icon=":material/hourglass_top:")
            return
        image = live.draw_regions(frame.jpeg, shapes, space, labels=labels)
        st.image(image, width="stretch")
        age = max(0.0, time.time() - frame.at)
        st.caption(
            f"Live · {image.width}×{image.height} · frame {age:.1f}s old"
            + (f" · last error: {error}" if error else "")
        )

    live_frame()
    st.caption(
        f"Shown at {live.FPS} frames a second. The reader runs on the console's machine and "
        f"stops {live.IDLE_SECONDS}s after the last viewer leaves."
    )

with st.expander("Technical details"):
    st.json({"source": source, "configuration": document})
