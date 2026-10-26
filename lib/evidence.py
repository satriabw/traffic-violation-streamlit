"""Drawing a violation's metadata blob.

THE BLOB IS IN TWO DIFFERENT COORDINATE SYSTEMS AND THIS MODULE EXISTS TO KEEP THEM
APART. `bboxes` are pixels in the source video's frame. `trajectory` is metres on the
ground plane — `trajectory_collector` is unambiguous about it ("UNITS ARE METRES,
throughout"), because two objects the same distance apart on screen are metres apart at
the bottom of a frame and tens of metres apart at the top. So:

  - boxes are drawn over the thumbnail, scaled by thumbnail_size / source_resolution;
  - trajectories are NOT. They get their own top-down plot in metres.

Drawing a ground-plane path over a perspective image would put a plausible-looking line
in the wrong place, which is worse than not drawing it at all.

The one crossing the other way is the configuration's zones: they are drawn in pixels,
and the metadata's `ground_from_pixel` (the projection the trajectories were made with)
carries them onto the ground plot. Pixels to ground, never ground to pixels.

evidence-worker deliberately bakes nothing onto the image (see cut.py: "NOTHING IS
DRAWN ON") precisely so the rendering lives here and improving it improves every
violation ever recorded.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

import altair as alt
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

# Slots 1-3 of the reference categorical palette, in order. Three and not more on
# purpose: the ground-plane plot is a scatter/path form, where every pair of series can
# end up adjacent, and only the first three slots clear the all-pairs colour-vision
# floors. Past three the guidance is to fold or facet rather than invent a fourth hue,
# which is what TrackPicker below does.
SERIES = ("#2a78d6", "#eb6834", "#1baf7a")
# Everything not currently selected. Deliberately a grey rather than a fourth hue: it
# reads as "context", not as another identity.
MUTED = "#94a3b8"
# Ink, never a series colour — text carries no identity of its own.
INK = "#0f172a"
INK_SOFT = "#64748b"
GRID = "#e2e8f0"
# The configured zones: context under the tracks, so ink-grey and never a series colour.
ZONE = "#cbd5e1"
# Past this many metres from the tracks a projected point is a pixel near the horizon,
# where the projection runs off towards infinity, not a place on the road.
ZONE_REACH_METRES = 200.0
# Shorter than this is a detector flicker, not a person — the review's own floor.
MIN_TRACK_SECONDS = 0.5
# The speed chart's span, ending at the last sample. Longer than this and the lines
# around the violation are too compressed to follow.
SPEED_WINDOW_SECONDS = 10.0
# Frames assumed per second when the source does not say.
FALLBACK_FPS = 30.0


@dataclass
class Track:
    """One object's path, with the parallel lists zipped into something indexable.

    The four lists on TrackSummary are parallel by index, which is easy to get wrong
    at every call site — so it is unpacked exactly once, here.
    """

    track_id: int
    kind: str  # "vehicle" | "pedestrian"
    frame_idxs: list[int] = field(default_factory=list)
    bboxes: list[tuple] = field(default_factory=list)
    trajectory: list[Any] = field(default_factory=list)
    speed: list[Any] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"{self.kind[:3]} #{self.track_id}"

    def at(self, frame_index: int | None) -> int | None:
        """The index of the sample nearest `frame_index`, or None if this track was
        not present anywhere near it.

        Nearest rather than exact: a violation's frame_index comes off the detector and
        a track's samples are whatever the tracker emitted, so demanding equality would
        silently draw nothing for a track that is plainly in the frame.
        """
        if frame_index is None or not self.frame_idxs:
            return None
        best = min(
            range(len(self.frame_idxs)),
            key=lambda i: abs(self.frame_idxs[i] - frame_index),
        )
        # Half a second at 30fps. Beyond that the box is not evidence of anything at
        # the moment in question.
        return best if abs(self.frame_idxs[best] - frame_index) <= 15 else None

    def bbox_at(self, frame_index: int | None) -> tuple | None:
        i = self.at(frame_index)
        if i is None or i >= len(self.bboxes):
            return None
        return self.bboxes[i]

    def speed_at(self, frame_index: int | None) -> float | None:
        i = self.at(frame_index)
        if i is None or i >= len(self.speed):
            return None
        return self.speed[i]


def tracks_of(metadata: dict | None) -> list[Track]:
    """Every track in the blob, vehicles then pedestrians."""
    if not metadata:
        return []
    out: list[Track] = []
    for kind, key in (("vehicle", "vehicles"), ("pedestrian", "pedestrians")):
        for raw in metadata.get(key) or []:
            out.append(
                Track(
                    track_id=raw.get("track_id"),
                    kind=kind,
                    frame_idxs=list(raw.get("frame_idxs") or []),
                    bboxes=list(raw.get("bboxes") or []),
                    trajectory=list(raw.get("trajectory") or []),
                    speed=list(raw.get("speed") or []),
                )
            )
    return out


def _foot(box) -> tuple[float, float]:
    # Where a road user touches the ground: the bottom middle of the box.
    return ((box[0] + box[2]) / 2, box[3])


def _inside(point: tuple[float, float], polygon: list) -> bool:
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(polygon, polygon[1:] + polygon[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def involved(
    tracks: list[Track],
    violator_id: int | None,
    configuration: dict | None,
    frame_index: int | None,
    fps: float | None,
) -> list[Track]:
    """The violator and the pedestrians in the crosswalk during the event, violator first.

    The crosswalk is the configured zone the violator was in at the flagged moment, or
    every zone when it was in none; a pedestrian is in it when their feet are, at any
    sample of the record — the same in-the-picture test the review uses. Without zones
    to test against, being in the picture at the flagged moment is all that can be said.
    Other vehicles are never involved: the violation is one vehicle's.

    Pedestrians come most-time-in-the-crosswalk first, so a cap on the selection keeps
    the ones that mattered most.
    """
    violator = next((t for t in tracks if t.kind == "vehicle" and t.track_id == violator_id), None)
    if violator is None:
        # Nothing ties the violation to a vehicle: everyone present at the moment.
        return [t for t in tracks if t.bbox_at(frame_index)]

    zones = [
        [tuple(p) for p in region.get("points") or []]
        for region in ((configuration or {}).get("regions") or {}).get("rois") or []
    ]
    zones = [z for z in zones if len(z) >= 3]
    box = violator.bbox_at(frame_index)
    crosswalks = [z for z in zones if box and _inside(_foot(box), z)][:1] or zones
    shortest = round(MIN_TRACK_SECONDS * (fps or FALLBACK_FPS))

    scored = []
    for track in tracks:
        if track.kind != "pedestrian" or len(track.frame_idxs) < shortest:
            continue
        if crosswalks:
            hits = sum(1 for b in track.bboxes if any(_inside(_foot(b), z) for z in crosswalks))
        else:
            hits = 1 if track.bbox_at(frame_index) else 0
        if hits:
            scored.append((hits, track))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [violator, *(t for _, t in scored)]


def colour_map(selected: Iterable[int]) -> dict[int, str]:
    """Track id -> hue, assigned in fixed slot order.

    Colour follows the entity: the same track is the same colour on the image, on the
    ground plot and on the speed chart, which is the whole reason a reader can connect
    the three. Never cycled — the selection is capped at len(SERIES) instead.
    """
    return {tid: SERIES[i % len(SERIES)] for i, tid in enumerate(selected)}


# ---------------------------------------------------------------------------
# The image
# ---------------------------------------------------------------------------


def _font(size: int):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_boxes(
    image_bytes: bytes,
    tracks: list[Track],
    frame_index: int | None,
    source_size: tuple[int, int] | None,
    colours: dict[int, str],
    violator_id: int | None = None,
) -> Image.Image:
    """The thumbnail with a box per track that was present at `frame_index`.

    Boxes are in source-video pixels and the thumbnail may be any size, so everything
    is scaled by the ratio between them. When the source resolution is unknown the
    boxes are assumed to already be in the image's own space — which is right whenever
    the thumbnail is a full-resolution frame, and ffmpeg's `-frames:v 1` with no scale
    filter makes exactly that.
    """
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    draw = ImageDraw.Draw(image, "RGBA")

    if source_size and source_size[0]:
        scale_x = image.width / source_size[0]
        scale_y = image.height / source_size[1]
    else:
        scale_x = scale_y = 1.0

    stroke = max(2, round(image.width / 480))
    font = _font(max(13, round(image.width / 62)))
    pad = 5

    labels: list[tuple[float, float, str, str]] = []  # x, y-of-box-top, text, colour

    for track in tracks:
        box = track.bbox_at(frame_index)
        if not box:
            continue
        x1, y1, x2, y2 = (
            box[0] * scale_x,
            box[1] * scale_y,
            box[2] * scale_x,
            box[3] * scale_y,
        )
        selected = track.track_id in colours
        colour = colours.get(track.track_id, MUTED)
        width = stroke + 1 if track.track_id == violator_id else stroke

        # A dark halo under every box. The palette was validated against a flat chart
        # surface, and a photograph is not one — a box over pale tarmac needs a
        # separator to stay a box.
        draw.rectangle([x1 - 1, y1 - 1, x2 + 1, y2 + 1], outline=(0, 0, 0, 150), width=width + 2)
        draw.rectangle([x1, y1, x2, y2], outline=colour, width=width)

        if not selected and track.track_id != violator_id:
            # Unselected tracks are context: outlined, but not labelled. A frame with
            # twenty tracks in it should not carry twenty labels.
            continue

        text = track.label
        if track.track_id == violator_id:
            text += " · violator"
        speed = track.speed_at(frame_index)
        if speed is not None:
            # Kept short on purpose: a wide label is a label that collides. One
            # decimal below 100 m/s, none above — anything that fast is a calibration
            # problem and the extra digit is false precision either way.
            text += f"  {speed:.1f}" if speed < 100 else f"  {speed:.0f}"
            text += " m/s"
        labels.append((x1, y1, text, colour))

    # Labels are placed after every box is drawn, so one never hides another's outline,
    # and top-down so the nudging below is deterministic rather than dependent on the
    # order tracks happen to arrive in.
    placed: list[tuple[float, float, float, float]] = []
    for x1, y1, text, colour in sorted(labels, key=lambda item: item[1]):
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        tw, th = right - left, bottom - top
        bw, bh = tw + pad * 2, th + pad * 2

        # Above the box by preference, below it when that would leave the image.
        ty = y1 - bh if y1 - bh > 0 else y1
        tx = min(x1, image.width - bw)

        # Nudge down until the slot is free. Bounded, because a frame dense enough to
        # exhaust this is one where a perfect answer is not worth the pixels — the
        # last candidate is drawn wherever it landed rather than dropped, since a
        # missing label reads as a missing detection.
        for _ in range(8):
            if not any(tx < px2 and tx + bw > px1 and ty < py2 and ty + bh > py1
                       for px1, py1, px2, py2 in placed):
                break
            ty += bh + 2
        placed.append((tx, ty, tx + bw, ty + bh))

        draw.rectangle([tx, ty, tx + bw, ty + bh], fill=colour)
        draw.text((tx + pad, ty + pad - top), text, fill="#ffffff", font=font)

    return image


# Anything above this on the ground plane is a calibration that does not hold, not a
# vehicle. 60 m/s is 216 km/h — fast enough that no junction camera should see it, and
# slow enough not to fire on a genuinely speeding car.
IMPLAUSIBLE_SPEED_MS = 60.0


def implausible(tracks: list[Track], colours: dict[int, str]) -> float | None:
    """The fastest speed among the shown tracks, if it is not believable.

    Surfaced rather than hidden: a reviewer looking at "218 m/s" beside a photograph of
    a suburban junction should be told the number is wrong, because the alternative is
    them trusting it. What it indicts is the calibration — speeds are metres on the
    ground plane, and a wrong projection scales all of them together.
    """
    speeds = [
        s
        for track in tracks
        if track.track_id in colours
        for s in track.speed
        if s is not None
    ]
    fastest = max(speeds, default=0.0)
    return fastest if fastest > IMPLAUSIBLE_SPEED_MS else None


# ---------------------------------------------------------------------------
# The charts
# ---------------------------------------------------------------------------


def _frame(tracks: list[Track], colours: dict[int, str], fps: float | None) -> pd.DataFrame:
    """Both charts read one tidy frame — same rows, different encodings."""
    rows = []
    for track in tracks:
        if track.track_id not in colours:
            continue
        n = len(track.frame_idxs)
        for i in range(n):
            point = track.trajectory[i] if i < len(track.trajectory) else None
            speed = track.speed[i] if i < len(track.speed) else None
            frame = track.frame_idxs[i]
            rows.append(
                {
                    "track": track.label,
                    "track_id": track.track_id,
                    "frame": frame,
                    # Seconds, because that is what someone scrubbing a clip needs.
                    "t": frame / fps if fps else None,
                    "x": point[0] if point else None,
                    "y": point[1] if point else None,
                    "speed": speed,
                    "order": i,
                }
            )
    return pd.DataFrame(rows)


def _scale(colours: dict[int, str], data: pd.DataFrame) -> alt.Scale:
    """A colour scale bound to track labels, so a track keeps its hue when the
    selection changes — a filter must never repaint the survivors."""
    labels = data.drop_duplicates("track_id").set_index("track_id")["track"].to_dict()
    domain = [labels[tid] for tid in colours if tid in labels]
    return alt.Scale(domain=domain, range=[colours[tid] for tid in colours if tid in labels])


_AXIS = alt.Axis(
    grid=True,
    gridColor=GRID,
    gridWidth=1,
    domainColor=GRID,
    tickColor=GRID,
    labelColor=INK_SOFT,
    titleColor=INK_SOFT,
    labelFontSize=11,
    titleFontSize=11,
    titleFontWeight="normal",
)


def _project(h: list[list[float]], point) -> tuple[float, float] | None:
    x, y = point[0], point[1]
    gx, gy, w = (row[0] * x + row[1] * y + row[2] for row in h)
    # w at or below zero is a pixel on or above the horizon: it has no place on the ground.
    if w <= 1e-9:
        return None
    return gx / w, gy / w


def camera_view(
    metadata: dict | None, size: tuple[int, int] | None
) -> Callable[[float, float], tuple[float, float]] | None:
    """A turn of the ground plane that lays it out the way the camera looks at it.

    The ground frame's axes are wherever the calibration put them, so a plot of it raw
    can show the road sideways or mirrored next to the picture it came from. This puts
    the ground under the bottom middle of the picture at the origin, "into the picture"
    up and the picture's right to the right. A rotation (and at most a mirror), never a
    stretch: distances stay metres.
    """
    h = (metadata or {}).get("ground_from_pixel")
    if not h or not size or not size[0] or not size[1]:
        return None
    width, height = size
    origin = _project(h, (width / 2, height))
    right = _project(h, (width * 0.75, height))
    # The middle of the picture can be above the horizon on a shallow camera; step down
    # until a point lands on the ground.
    ahead = next(
        (g for g in (_project(h, (width / 2, height * s)) for s in (0.5, 0.7, 0.9)) if g is not None),
        None,
    )
    if origin is None or right is None or ahead is None:
        return None

    fx, fy = ahead[0] - origin[0], ahead[1] - origin[1]
    length = math.hypot(fx, fy)
    if length < 1e-9:
        return None
    fx, fy = fx / length, fy / length
    # Ahead turned a quarter clockwise, then mirrored if the ground frame is.
    rx, ry = fy, -fx
    if (right[0] - origin[0]) * rx + (right[1] - origin[1]) * ry < 0:
        rx, ry = -rx, -ry
    ox, oy = origin

    def view(x: float, y: float) -> tuple[float, float]:
        dx, dy = x - ox, y - oy
        return dx * rx + dy * ry, dx * fx + dy * fy

    return view


def _viewed(data: pd.DataFrame, view) -> pd.DataFrame:
    if view is None or data.empty:
        return data
    turned = [view(x, y) for x, y in zip(data["x"], data["y"])]
    return data.assign(x=[p[0] for p in turned], y=[p[1] for p in turned])


def ground_zones(metadata: dict | None, configuration: dict | None) -> pd.DataFrame:
    """The configuration's zones, and the edges they name (a crossing's kerbs), on the ground.

    Projected with the metadata's own `ground_from_pixel` rather than the site's current
    calibration, so the zones land where the tracks were measured. The points are the
    configuration's raw pixels, as detection read them. A zone with any point that does
    not project is left out whole — half a polygon is a wrong shape, not a partial one.
    One row per vertex: `zone` names the shape, `kind` is "zone" or "edge".
    """
    h = (metadata or {}).get("ground_from_pixel")
    if not h or not configuration:
        return pd.DataFrame()

    rows = []
    for layer, items in (configuration.get("regions") or {}).items():
        for item in items or []:
            points = item.get("points") or []
            if len(points) < 3:
                continue
            ground = [_project(h, p) for p in points]
            if any(g is None for g in ground):
                continue
            name = item.get("id", layer)
            # Drawn closed, without doubling a closing point the configuration already has.
            ring = ground if ground[0] == ground[-1] else [*ground, ground[0]]
            rows += [{"zone": name, "kind": "zone", "label": name, "order": i, "x": x, "y": y}
                     for i, (x, y) in enumerate(ring)]
            for edge, (a, b) in (item.get("edges") or {}).items():
                if max(a, b) < len(ground):
                    label = edge.replace("_", " ")
                    rows += [{"zone": f"{name}:{edge}", "kind": "edge", "label": label, "order": i, "x": x, "y": y}
                             for i, (x, y) in enumerate((ground[a], ground[b]))]
    return pd.DataFrame(rows)


def ground_plot(
    tracks: list[Track],
    colours: dict[int, str],
    fps: float | None,
    violation_t: float | None,
    zones: pd.DataFrame | None = None,
    view: Callable[[float, float], tuple[float, float]] | None = None,
) -> alt.LayerChart | None:
    """Where the tracks went, seen from above, in metres.

    A separate chart rather than an overlay for the reason at the top of this file.
    Reading it as a map is the point: the axes are the ground plane, so distances
    between two paths are real distances, which is exactly what the perspective image
    cannot tell you. With a `view` (see camera_view) it is turned to face the way the
    camera does, so left and right, near and far, match the picture beside it.
    """
    data = _viewed(_frame(tracks, colours, fps).dropna(subset=["x", "y"]), view)
    if data.empty:
        return None
    zones = _viewed(zones, view) if zones is not None else None
    x_title, y_title = (
        ("across the picture (m)", "into the picture (m)") if view else ("ground plane x (m)", "ground plane y (m)")
    )

    scale = _scale(colours, data)
    base = alt.Chart(data)

    # The axes follow the tracks, not the zones: a zone reaching far up the picture
    # projects tens of metres away, and fitting it would shrink the paths to a smudge.
    # Zones are clipped to the view instead.
    x_domain, y_domain = _padded(data["x"]), _padded(data["y"])
    under: list = []
    if zones is not None and not zones.empty:
        near = zones.groupby("zone").filter(lambda z: _within(z, data))
        if not near.empty:
            under = _zone_marks(near)

    path = base.mark_line(strokeWidth=2, opacity=0.9).encode(
        x=alt.X("x:Q", title=x_title, axis=_AXIS, scale=alt.Scale(domain=x_domain, nice=False)),
        y=alt.Y("y:Q", title=y_title, axis=_AXIS, scale=alt.Scale(domain=y_domain, nice=False)),
        color=alt.Color("track:N", scale=scale, legend=alt.Legend(title=None, orient="top", labelColor=INK)),
        order="order:Q",
        detail="track:N",
    )

    # Hover on the marks rather than a crosshair: this is a spatial plot, so "the
    # nearest point in x" is not a meaningful thing to snap to.
    points = base.mark_circle(size=34, opacity=0).encode(
        x="x:Q",
        y="y:Q",
        color=alt.Color("track:N", scale=scale, legend=None),
        tooltip=[
            alt.Tooltip("track:N", title="Track"),
            alt.Tooltip("t:Q", title="Time (s)", format=".2f"),
            alt.Tooltip("speed:Q", title="Speed (m/s)", format=".2f"),
            alt.Tooltip("x:Q", title="x (m)", format=".1f"),
            alt.Tooltip("y:Q", title="y (m)", format=".1f"),
        ],
    )

    # Direct labels at each path's end. Not decoration: aqua sits under 3:1 on a light
    # surface, and the relief rule for that is visible labels, which these are.
    ends = (
        base.transform_window(rank="rank()", sort=[alt.SortField("order", "descending")], groupby=["track"])
        .transform_filter(alt.datum.rank == 1)
        .mark_text(align="left", dx=8, dy=-6, fontSize=11, fontWeight="bold", color=INK)
        .encode(x="x:Q", y="y:Q", text="track:N")
    )

    marks = [*under, path, points, ends]
    if violation_t is not None:
        moment = data.assign(gap=(data["t"] - violation_t).abs()).sort_values("gap").groupby("track_id").head(1)
        marks.append(
            alt.Chart(moment)
            .mark_point(size=180, shape="diamond", filled=True, stroke="#ffffff", strokeWidth=2)
            .encode(x="x:Q", y="y:Q", color=alt.Color("track:N", scale=scale, legend=None),
                    tooltip=[alt.Tooltip("track:N", title="Track"), alt.Tooltip("t:Q", title="Time (s)", format=".2f")])
        )

    return alt.layer(*marks).properties(height=340).configure_view(strokeWidth=0)


def _padded(values: pd.Series, share: float = 0.15, least: float = 2.0) -> list[float]:
    low, high = float(values.min()), float(values.max())
    pad = max((high - low) * share, least)
    return [low - pad, high + pad]


def _within(zone: pd.DataFrame, data: pd.DataFrame) -> bool:
    cx, cy = data["x"].mean(), data["y"].mean()
    return bool(((zone["x"] - cx).abs().max() <= ZONE_REACH_METRES)
                and ((zone["y"] - cy).abs().max() <= ZONE_REACH_METRES))


def _zone_marks(zones: pd.DataFrame) -> list:
    shapes = zones[zones["kind"] == "zone"]
    edges = zones[zones["kind"] == "edge"]
    marks = []
    if not shapes.empty:
        chart = alt.Chart(shapes)
        marks.append(
            chart.mark_line(color=INK_SOFT, strokeDash=[4, 3], strokeWidth=1, clip=True)
            .encode(x="x:Q", y="y:Q", order="order:Q", detail="zone:N",
                    tooltip=[alt.Tooltip("label:N", title="Zone")])
        )
        marks.append(
            chart.transform_filter(alt.datum.order == 0)
            .mark_text(align="left", dx=4, dy=10, fontSize=10, color=INK_SOFT, clip=True)
            .encode(x="x:Q", y="y:Q", text="label:N")
        )
    if not edges.empty:
        chart = alt.Chart(edges)
        marks.append(
            chart.mark_line(color=INK_SOFT, strokeWidth=3, opacity=0.6, clip=True)
            .encode(x="x:Q", y="y:Q", order="order:Q", detail="zone:N",
                    tooltip=[alt.Tooltip("label:N", title="Edge")])
        )
        marks.append(
            chart.transform_aggregate(x="mean(x)", y="mean(y)", groupby=["zone", "label"])
            .mark_text(dy=-8, fontSize=10, fontStyle="italic", color=INK_SOFT, clip=True)
            .encode(x="x:Q", y="y:Q", text="label:N")
        )
    return marks


def speed_plot(
    tracks: list[Track], colours: dict[int, str], fps: float | None, violation_t: float | None
) -> alt.LayerChart | None:
    """Speed against time, with the moment the rule fired marked.

    One y-axis and one unit. There is no second scale here and there should never be
    one — a second measure gets a second chart. Only the last SPEED_WINDOW_SECONDS of
    the record are drawn; the record runs on past the violation, so it stays in view.
    """
    data = _frame(tracks, colours, fps).dropna(subset=["speed", "t"])
    if data.empty:
        return None
    end = float(data["t"].max())
    start = end - SPEED_WINDOW_SECONDS
    data = data[data["t"] >= start]
    # Pinned to the window: a quantitative axis otherwise starts at zero, which is the
    # start of the video, and squeezes the last ten seconds into a sliver at its end.
    window = alt.Scale(domain=[start, end], zero=False, nice=False)

    scale = _scale(colours, data)
    base = alt.Chart(data)
    nearest = alt.selection_point(nearest=True, on="pointerover", fields=["t"], empty=False)

    line = base.mark_line(strokeWidth=2).encode(
        x=alt.X("t:Q", title="seconds into the video", axis=_AXIS, scale=window),
        y=alt.Y("speed:Q", title="speed (m/s)", axis=_AXIS),
        color=alt.Color("track:N", scale=scale, legend=alt.Legend(title=None, orient="top", labelColor=INK)),
    )

    hover = base.mark_circle(size=90, stroke="#ffffff", strokeWidth=2).encode(
        x="t:Q",
        y="speed:Q",
        color=alt.Color("track:N", scale=scale, legend=None),
        opacity=alt.condition(nearest, alt.value(1), alt.value(0)),
        tooltip=[
            alt.Tooltip("track:N", title="Track"),
            alt.Tooltip("t:Q", title="Time (s)", format=".2f"),
            alt.Tooltip("speed:Q", title="Speed (m/s)", format=".2f"),
            alt.Tooltip("frame:Q", title="Frame"),
        ],
    ).add_params(nearest)

    ends = (
        base.transform_window(rank="rank()", sort=[alt.SortField("t", "descending")], groupby=["track"])
        .transform_filter(alt.datum.rank == 1)
        .mark_text(align="left", dx=6, fontSize=11, fontWeight="bold", color=INK)
        .encode(x="t:Q", y="speed:Q", text="track:N")
    )

    marks = [line, hover, ends]
    if violation_t is not None and start <= violation_t <= end:
        rule = (
            alt.Chart(pd.DataFrame({"t": [violation_t]}))
            .mark_rule(color=INK_SOFT, strokeDash=[4, 4], strokeWidth=1.5)
            .encode(x="t:Q")
        )
        caption = (
            alt.Chart(pd.DataFrame({"t": [violation_t], "label": ["violation"]}))
            .mark_text(align="left", dx=5, dy=-6, baseline="top", fontSize=11, color=INK_SOFT)
            .encode(x="t:Q", y=alt.value(0), text="label:N")
        )
        marks[:0] = [rule, caption]

    return alt.layer(*marks).properties(height=260).configure_view(strokeWidth=0)
