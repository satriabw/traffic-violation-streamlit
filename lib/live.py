"""Watching a site: its live feed, and its configuration drawn over the picture.

A BROWSER CANNOT PLAY RTSP, so a live feed is read here instead: one ffmpeg per stream
URL, kept as a cached resource, decoding a couple of frames a second to JPEG on stdout.
Every viewer of the same feed shares that one reader, and it stops itself once nobody
has asked for a frame in a while — so leaving the page does not leave ffmpeg running.

THE REGIONS ARE IN THE CONFIGURATION'S PIXELS, not the picture's. A configuration
carries the `camera` size it was drawn against; the points are scaled from that onto
whatever size the frame or player actually is. Without a `camera` block the source's
own resolution stands in, which is what the configuration was drawn on in practice.
"""

from __future__ import annotations

import io
import socket
import subprocess
import threading
import time
import urllib.parse
from dataclasses import dataclass

import requests
import streamlit as st
from PIL import Image, ImageDraw

from lib.api import Api, ApiError, ApiUnreachable
from lib.evidence import SERIES, _font

# One colour per region layer: the first three slots of the categorical palette.
LAYERS = {
    "lanes": ("Lanes", SERIES[0]),
    "rois": ("ROIs", SERIES[1]),
    "traffic_lights": ("Traffic lights", SERIES[2]),
}

FPS = 2
IDLE_SECONDS = 30


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@st.cache_data(show_spinner=False, ttl=600, max_entries=64)
def configuration(base_url: str, site_id: str) -> tuple[dict | None, dict | None]:
    """The site's active configuration document and its row, or (None, None)."""
    client = Api(base_url)
    try:
        row = client.get_active_doc(site_id, "configurations")
        if row is None:
            return None, None
        file = client.get_file(row["file_id"])
        if not file.get("download_url"):
            return None, row
        response = requests.get(client.absolute(file["download_url"]), timeout=30)
        response.raise_for_status()
        return response.json(), row
    except (ApiError, ApiUnreachable, requests.RequestException, ValueError):
        return None, None


def drawn_size(document: dict | None, source: dict | None) -> tuple[int, int] | None:
    """The pixel space the regions were drawn in."""
    camera = (document or {}).get("camera") or {}
    if camera.get("width") and camera.get("height"):
        return int(camera["width"]), int(camera["height"])
    resolution = ((source or {}).get("metadata") or {}).get("resolution") or {}
    if resolution.get("width") and resolution.get("height"):
        return int(resolution["width"]), int(resolution["height"])
    return None


def regions(document: dict | None, layers: set[str]) -> list[tuple[str, str, list]]:
    """(layer, id, points) for every region in the layers switched on."""
    out = []
    for layer, items in ((document or {}).get("regions") or {}).items():
        if layer in layers:
            for item in items or []:
                if len(item.get("points") or []) >= 3:
                    out.append((layer, item.get("id", layer), item["points"]))
    return out


def draw_regions(
    jpeg: bytes,
    shapes: list[tuple[str, str, list]],
    space: tuple[int, int] | None,
    labels: bool = True,
) -> Image.Image:
    """The frame with each region outlined and lightly filled, scaled from `space`."""
    image = Image.open(io.BytesIO(jpeg)).convert("RGB")
    if not shapes:
        return image
    sx, sy = (image.width / space[0], image.height / space[1]) if space else (1.0, 1.0)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width = max(2, image.width // 400)
    font = _font(max(14, image.width // 70))
    for layer, region_id, points in shapes:
        colour = LAYERS[layer][1]
        rgb = tuple(int(colour[i : i + 2], 16) for i in (1, 3, 5))
        xy = [(x * sx, y * sy) for x, y in points]
        draw.polygon(xy, fill=(*rgb, 50))
        draw.line([*xy, xy[0]], fill=(*rgb, 255), width=width, joint="curve")
        if labels:
            x, y = min(xy, key=lambda p: (p[1], p[0]))
            box = draw.textbbox((x, y), region_id, font=font)
            draw.rectangle(
                (box[0] - 4, box[1] - 2, box[2] + 4, box[3] + 2), fill=(*rgb, 230)
            )
            draw.text((x, y), region_id, fill=(255, 255, 255, 255), font=font)
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


# ---------------------------------------------------------------------------
# Live feed
# ---------------------------------------------------------------------------


def reachable_url(stream_url: str) -> str:
    """The feed's URL as this machine can open it.

    Sources are stored as the backend's containers see them (`rtsp://tv-rtsp:8554/…`),
    and a compose service name does not resolve on the host. When it does not, the
    published port on 127.0.0.1 is the usual way in, so that is the guess offered.
    """
    parts = urllib.parse.urlsplit(stream_url)
    if not parts.hostname:
        return stream_url
    try:
        socket.gethostbyname(parts.hostname)
        return stream_url
    except OSError:
        netloc = parts.netloc.replace(parts.hostname, "127.0.0.1", 1)
        return urllib.parse.urlunsplit(parts._replace(netloc=netloc))


@dataclass
class Frame:
    jpeg: bytes
    at: float


class FeedReader:
    """One ffmpeg decoding a feed to JPEGs, keeping only the newest."""

    def __init__(self, url: str):
        self.url = url
        self._lock = threading.Lock()
        self._frame: Frame | None = None
        self._error: str | None = None
        self._asked = time.time()
        self._process: subprocess.Popen | None = None
        self._thread: threading.Thread | None = None

    def latest(self) -> tuple[Frame | None, str | None]:
        with self._lock:
            self._asked = time.time()
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, daemon=True)
                self._thread.start()
            return self._frame, self._error

    def _run(self) -> None:
        while time.time() - self._asked < IDLE_SECONDS:
            try:
                self._process = subprocess.Popen(
                    [
                        "ffmpeg", "-hide_banner", "-loglevel", "error",
                        *(["-rtsp_transport", "tcp"] if self.url.startswith("rtsp") else []),
                        "-i", self.url,
                        "-vf", f"fps={FPS}", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "5", "-",
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
            except OSError as exc:
                self._set_error(f"ffmpeg could not start: {exc}")
                return
            self._pump(self._process)
            if self._process.poll() is None:
                self._process.kill()
            stderr = (self._process.stderr.read() or b"").decode(errors="replace").strip()
            if time.time() - self._asked < IDLE_SECONDS:
                self._set_error(stderr.splitlines()[-1] if stderr else "The feed ended.")
                time.sleep(2)

    def _pump(self, process: subprocess.Popen) -> None:
        """Split ffmpeg's stdout into JPEGs on their start/end markers."""
        buffer = b""
        while time.time() - self._asked < IDLE_SECONDS:
            chunk = process.stdout.read1(1 << 16)
            if not chunk:
                return
            buffer += chunk
            while True:
                start = buffer.find(b"\xff\xd8")
                end = buffer.find(b"\xff\xd9", start + 2)
                if start < 0 or end < 0:
                    break
                with self._lock:
                    self._frame = Frame(buffer[start : end + 2], time.time())
                    self._error = None
                buffer = buffer[end + 2 :]

    def _set_error(self, message: str) -> None:
        with self._lock:
            self._error = message


@st.cache_resource(show_spinner=False, max_entries=16)
def feed(url: str) -> FeedReader:
    return FeedReader(url)
