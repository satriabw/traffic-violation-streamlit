"""Making sure a video arrives with a frame count in it.

WHY THIS EXISTS. site-service probes a video as it is attached and stores whatever the
container header tells it. Matroska does not record a frame count — ffprobe answers
`nb_frames=N/A` — so an .mkv attaches with fps, duration and resolution but no
`total_frames`. Detection no longer needs it — the ingestion worker counts frames as it
cuts the video into pieces — but the pages show it, and an exact count beats an estimate.
MP4 keeps a sample table, so the same footage in an MP4 probes complete.

So the fix is at the container, before the bytes ever leave here: remux to MP4 and the
count is there to be read. `-c copy` — no re-encode, no quality change, no GPU. On the
59MB Hasselt.mkv it costs about a tenth of a second.

WHY PROBE RATHER THAN GO BY EXTENSION. "Is it .mkv" is a guess at the real question,
which is "will the backend find a frame count in this". Asking ffprobe the same thing
the backend will ask means a container that already carries one is passed through
untouched, and one that does not gets fixed whatever it is called.

NOTHING HERE IS ALLOWED TO BLOCK AN UPLOAD. ffmpeg missing, a codec MP4 cannot hold, a
malformed file — every failure returns the original bytes and lets the backend be the
one to judge them. The worst case is the behaviour you already had.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile

# Long enough for a stream copy of a large file, short enough that a wedged ffmpeg
# gives the page back. A copy is IO-bound and does not decode, so this is generous.
REMUX_TIMEOUT_SECONDS = 120

# What ffprobe prints when the container has no frame count to give.
_UNKNOWN = {"", "N/A", "0"}


def _tool(name: str) -> str | None:
    return shutil.which(name)


def frame_count_of(path: str) -> int | None:
    """The frame count the container declares, or None if it declares none.

    Deliberately the same question site-service's probe asks — `nb_frames` on the first
    video stream — so what this reads and what the backend will read cannot disagree.
    """
    ffprobe = _tool("ffprobe")
    if ffprobe is None:
        return None
    try:
        result = subprocess.run(
            [
                ffprobe, "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=nb_frames",
                "-of", "default=nw=1:nk=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    if value in _UNKNOWN:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _run_remux(source: str, target: str, maps: list[str]) -> bool:
    ffmpeg = _tool("ffmpeg")
    if ffmpeg is None:
        return False
    try:
        result = subprocess.run(
            [
                ffmpeg, "-v", "error", "-y",
                "-i", source,
                *maps,
                "-c", "copy",
                # Moves the index to the front. Costs nothing here and means the
                # backend's probe satisfies itself in one range request rather than
                # reaching for the end of the object.
                "-movflags", "+faststart",
                target,
            ],
            capture_output=True,
            text=True,
            timeout=REMUX_TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False
    return result.returncode == 0 and os.path.getsize(target) > 0


def ensure_frame_count(data: bytes, name: str, content_type: str | None):
    """Return video bytes the backend will be able to read a frame count out of.

    Answers `(data, name, content_type, note)`. `note` is a line for the upload log —
    None when the file was already fine and nothing was done to it.

    The original is returned unchanged on every failure path, so the caller has nothing
    to handle: at worst the upload behaves exactly as it did before this existed.
    """
    if _tool("ffprobe") is None or _tool("ffmpeg") is None:
        # No opinion without the tools to form one. Let it through.
        return data, name, content_type, None

    directory = tempfile.mkdtemp(prefix="tv-remux-")
    source = os.path.join(directory, name)
    stem = os.path.splitext(name)[0]
    target = os.path.join(directory, f"{stem}.mp4")
    try:
        with open(source, "wb") as handle:
            handle.write(data)

        if frame_count_of(source) is not None:
            return data, name, content_type, None

        # Video and audio if MP4 will hold both, video alone if it will not. Detection
        # only ever reads the picture, so losing an incompatible audio track is worth
        # it to get a usable frame count — and far better than refusing the upload.
        for maps in (["-map", "0:v:0", "-map", "0:a?"], ["-map", "0:v:0"]):
            if not _run_remux(source, target, maps):
                continue
            frames = frame_count_of(target)
            if frames is None:
                continue
            with open(target, "rb") as handle:
                remuxed = handle.read()
            return (
                remuxed,
                f"{stem}.mp4",
                "video/mp4",
                f"`{name}` carries no frame count — remuxed to MP4 "
                f"(`-c copy`, no re-encode); {frames:,} frames now readable.",
            )

        return (
            data,
            name,
            content_type,
            f"`{name}` carries no frame count and could not be remuxed. Attaching it "
            "as-is; its frame count will be shown as an estimate.",
        )
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def displayed_frames(metadata: dict) -> tuple[str, bool]:
    """What to show for "Frames", and whether it had to be estimated.

    The estimate is `duration × fps`, which is what the count means. It is marked as an
    estimate rather than shown as a plain number because on variable-rate footage `fps`
    is an average and the product is approximate — and a reader deciding whether a job
    covered the whole video needs to know which of the two they are looking at.
    """
    exact = metadata.get("total_frames")
    if exact:
        return f"{exact:,}", False
    duration, fps = metadata.get("duration_seconds"), metadata.get("fps")
    if duration and fps:
        return f"≈{round(duration * fps):,}", True
    return "—", False
