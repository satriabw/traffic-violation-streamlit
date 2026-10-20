"""Sites — list, create, inspect, delete.

Covers GET/POST /sites and GET/DELETE /sites/{id}. The list route's one filter, kind,
describes the site's *active source*, not the site.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from lib import ui
from lib.api import SOURCE_KINDS, ApiError, ApiUnreachable

client = ui.sidebar()

ui.page_header("Sites", "Fixed camera locations and the source each one reads from.", eyebrow="Setup")

# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

with st.expander("Create a site", expanded=False):
    with st.form("create_site"):
        name = st.text_input("Name", placeholder="Jl. Sudirman — north approach")
        st.caption(
            "You can create a site now and add its video later on Site Setup."
        )
        attach = st.checkbox("Add a live camera feed link now")
        stream_url = st.text_input("Stream URL", placeholder="rtsp://…", disabled=not attach)
        st.caption(
            "Only a live camera feed can be added here. To use a recorded video, upload it "
            "on Site Setup."
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

filters = st.columns([1, 1, 4])
kind = filters[0].selectbox(
    "Source", [None, *SOURCE_KINDS],
    format_func=lambda k: {None: "All sources", "video": "Video", "stream": "Live feed"}[k],
    help="Filters on the source each site uses now.",
)
per_page = filters[1].selectbox("Rows", [10, 20, 50, 100], index=1)

st.session_state.setdefault("sites_offset", 0)

try:
    page = client.list_sites(limit=per_page, offset=st.session_state["sites_offset"], kind=kind)
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

if not page["items"]:
    ui.empty("No sites match.", "Clear the filter, or create one above.")
    st.stop()


def describe(metadata: dict) -> str:
    resolution = metadata.get("resolution") or {}
    return " · ".join(
        filter(
            None,
            [
                f"{resolution['width']}×{resolution['height']}" if resolution.get("width") else None,
                f"{metadata['fps']:.2f} fps" if metadata.get("fps") else None,
                f"{metadata['duration_seconds']:.1f} s" if metadata.get("duration_seconds") else None,
            ],
        )
    )


items = page["items"]
table = pd.DataFrame(
    [
        {
            "Site": site["name"],
            "Source": {"stream": "Live feed", "video": "Video"}.get(
                (site.get("source") or {}).get("kind"), "None"
            ),
            "Version": (site.get("source") or {}).get("version"),
            "Status": (site.get("source") or {}).get("status") or "—",
            "Format": describe((site.get("source") or {}).get("metadata") or {}),
            "Created": pd.to_datetime(site["created_at"]).tz_convert(ui.LOCAL_TZ).tz_localize(None),
        }
        for site in items
    ]
)
picked = st.dataframe(
    table,
    hide_index=True,
    width="stretch",
    column_config={
        "Version": st.column_config.NumberColumn(format="v%d"),
        "Created": st.column_config.DatetimeColumn(format="D MMM YYYY, HH:mm"),
    },
    on_select="rerun",
    selection_mode="single-row",
    key=f"sites_table_{st.session_state['sites_offset']}_{kind}",
)

pager = st.columns([3, 1, 1], vertical_alignment="center")
pager[0].caption(f"{page['offset'] + 1}–{page['offset'] + len(items)} of {page['total']}")
if pager[1].button("Previous", disabled=page["offset"] == 0, width="stretch"):
    st.session_state["sites_offset"] = max(0, page["offset"] - per_page)
    st.rerun()
if pager[2].button("Next", disabled=page["offset"] + len(items) >= page["total"], width="stretch"):
    st.session_state["sites_offset"] = page["offset"] + per_page
    st.rerun()

# ---------------------------------------------------------------------------
# Selected site
# ---------------------------------------------------------------------------

if not picked.selection.rows:
    st.caption("Select a row to see the site's details.")
    st.stop()

site = items[picked.selection.rows[0]]
source = site.get("source") or {}

with st.container(border=True):
    head, act = st.columns([3, 2], vertical_alignment="center")
    with head:
        st.subheader(site["name"], anchor=False)
        st.caption(f"`{site['id']}` · created {ui.ts(site['created_at'], with_seconds=False)}")
    with act:
        buttons = st.columns(3)
        if buttons[0].button("Use site", type="primary", width="stretch"):
            st.session_state["site_id"] = site["id"]
            st.rerun()
        if buttons[1].button("View", width="stretch"):
            st.session_state["site_id"] = site["id"]
            st.switch_page("pages/2_Site_View.py")
        if buttons[2].button("Set up", width="stretch"):
            st.session_state["site_id"] = site["id"]
            st.switch_page("pages/2_Site_Setup.py")

    st.markdown(
        ui.labelled_chip("source", source.get("status") if source else None)
        + "&nbsp;&nbsp;" + ui.source_label(client, source),
        unsafe_allow_html=True,
    )
    if source.get("metadata"):
        st.caption(describe(source["metadata"]))

    with st.expander("Delete site"):
        st.caption(
            "A site that has recorded violations cannot be deleted, so violation records are "
            "never removed by accident. Type the site name to confirm."
        )
        confirm = st.text_input(
            "Site name", key=f"confirm_{site['id']}", label_visibility="collapsed",
            placeholder=site["name"],
        )
        if st.button("Delete site", key=f"del_{site['id']}", disabled=confirm != site["name"]):
            try:
                client.delete_site(site["id"])
            except (ApiError, ApiUnreachable) as exc:
                ui.error(exc)
            else:
                st.success("Deleted.")
                if st.session_state.get("site_id") == site["id"]:
                    st.session_state.pop("site_id")
                st.rerun()
