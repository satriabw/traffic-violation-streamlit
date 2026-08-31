"""Sites — list, create, inspect, delete.

Covers GET/POST /sites and GET/DELETE /sites/{id}, including the two query filters the
list route accepts. Those filters describe the site's *active source*, not the site, and
the caption says so — otherwise "status: failed" reads as a broken site rather than a
source whose last run did not finish.
"""

from __future__ import annotations

import streamlit as st

from lib import ui
from lib.api import SOURCE_KINDS, SOURCE_STATUSES, ApiError, ApiUnreachable

st.set_page_config(page_title="Sites", page_icon="🏢", layout="wide")

client = ui.sidebar()

st.title("🏢 Sites")
st.caption("A site is a durable camera location. Nothing per-run lives on it — that is the source.")

# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

with st.expander("Create a site", expanded=False):
    with st.form("create_site"):
        name = st.text_input("Name", placeholder="Jl. Sudirman — north approach")
        st.caption(
            "A site with no source is valid; the video can be attached later on "
            "Site Setup. Creating one with a source inline runs the same validation "
            "and the same probe, so nothing is skipped by doing it here."
        )
        attach = st.checkbox("Attach a stream URL now")
        stream_url = st.text_input("Stream URL", placeholder="rtsp://…", disabled=not attach)
        st.caption(
            "Only a stream can be attached at creation — a video source needs a file "
            "that has already been uploaded, which is what Site Setup is for."
        )
        submitted = st.form_submit_button("Create site", type="primary")

    if submitted:
        if not name.strip():
            st.warning("A name is required.")
        else:
            source = None
            if attach and stream_url.strip():
                source = {"kind": "stream", "stream_url": stream_url.strip()}
            try:
                created = client.create_site(name.strip(), source)
            except (ApiError, ApiUnreachable) as exc:
                ui.error(exc)
            else:
                st.success(f"Created **{created['name']}** — `{created['id']}`")
                st.session_state["site_id"] = created["id"]
                st.rerun()

# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

filters = st.columns([1, 1, 1, 3])
kind = filters[0].selectbox("Source kind", ["(any)", *SOURCE_KINDS])
status = filters[1].selectbox("Source status", ["(any)", *SOURCE_STATUSES])
per_page = filters[2].selectbox("Per page", [10, 20, 50, 100], index=1)
st.caption("Both filters match the site's **active** source, not its whole history.")

st.session_state.setdefault("sites_offset", 0)

try:
    page = client.list_sites(
        limit=per_page,
        offset=st.session_state["sites_offset"],
        kind=None if kind == "(any)" else kind,
        status=None if status == "(any)" else status,
    )
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

if not page["items"]:
    ui.empty("No sites match.", "Clear the filters, or create one above.")
    st.stop()

st.caption(
    f"Showing {page['offset'] + 1}–{page['offset'] + len(page['items'])} of {page['total']}"
)

for site in page["items"]:
    source = site.get("source") or {}
    metadata = source.get("metadata") or {}
    with st.container(border=True):
        head, actions = st.columns([4, 1])
        with head:
            st.markdown(f"**{site['name']}**")
            st.caption(f"`{site['id']}`")
        with actions:
            if st.button("Select", key=f"sel_{site['id']}", width="stretch"):
                st.session_state["site_id"] = site["id"]
                st.toast(f"Selected {site['name']}")

        cols = st.columns(4)
        cols[0].markdown(ui.labelled_chip("source", source.get("status") if source else None), unsafe_allow_html=True)
        cols[1].caption(f"kind · {source.get('kind', '—')}")
        cols[2].caption(f"version · {source.get('version', '—')}")
        cols[3].caption(f"created · {ui.ts(site['created_at'], with_seconds=False)}")

        if metadata:
            resolution = metadata.get("resolution") or {}
            st.caption(
                " · ".join(
                    filter(
                        None,
                        [
                            f"{resolution['width']}×{resolution['height']}" if resolution.get("width") else None,
                            f"{metadata['fps']:g} fps" if metadata.get("fps") else None,
                            f"{metadata['total_frames']} frames" if metadata.get("total_frames") else None,
                            f"{metadata['duration_seconds']:.2f}s" if metadata.get("duration_seconds") else None,
                        ],
                    )
                )
            )

        with st.expander("Delete"):
            st.caption(
                "A site with recorded violations cannot be deleted — the API answers "
                "409 and deletes nothing. That is deliberate: clearing the violations "
                "has to be a separate, deliberate act."
            )
            confirm = st.text_input(
                "Type the site name to confirm", key=f"confirm_{site['id']}", label_visibility="collapsed",
                placeholder=site["name"],
            )
            if st.button("Delete site", key=f"del_{site['id']}", type="secondary", disabled=confirm != site["name"]):
                try:
                    client.delete_site(site["id"])
                except (ApiError, ApiUnreachable) as exc:
                    ui.error(exc)
                else:
                    st.success("Deleted.")
                    if st.session_state.get("site_id") == site["id"]:
                        st.session_state.pop("site_id")
                    st.rerun()

# ---------------------------------------------------------------------------
# Paging
# ---------------------------------------------------------------------------

back, forward = st.columns(2)
if back.button("← Previous", disabled=page["offset"] == 0, width="stretch"):
    st.session_state["sites_offset"] = max(0, page["offset"] - per_page)
    st.rerun()
if forward.button(
    "Next →",
    disabled=page["offset"] + len(page["items"]) >= page["total"],
    width="stretch",
):
    st.session_state["sites_offset"] = page["offset"] + per_page
    st.rerun()
