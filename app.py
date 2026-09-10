"""Entry point and overview.

Streamlit puts whatever is in pages/ in the sidebar automatically; this file is the
landing page and the only place that talks about the system as a whole. Everything it
draws is aggregated client-side, because the API has no cross-site endpoint — violations
are read per site, deliberately, since the list is resolved against the setup that site
is running now.
"""

from __future__ import annotations

import streamlit as st

from lib import ui
from lib.api import ApiError, ApiUnreachable

st.set_page_config(
    page_title="Traffic Violation Console",
    page_icon="🚦",
    layout="wide",
    initial_sidebar_state="expanded",
)

client = ui.sidebar()

st.title("🚦 Traffic Violation Console")
st.caption(
    "Manage camera sites, upload video, run violation detection, and review the "
    "violations found."
)

try:
    sites = client.all_sites()
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()

if not sites:
    ui.empty(
        "No sites yet.",
        "Head to Sites to create one, then Site Setup to give it a video and a configuration.",
    )
    st.stop()

# One request per site. Fine at demo scale and honest about what it is — there is no
# endpoint that answers this in one call, and pretending otherwise would mean caching
# something that goes stale the moment a detection run finishes.
totals = {"total": 0, "detected": 0, "pending": 0, "explained": 0, "failed": 0}
rows = []
for site in sites:
    try:
        page = client.list_violations(site["id"], limit=100)
    except (ApiError, ApiUnreachable):
        page = {"items": [], "total": 0}
    counts = {"detected": 0, "pending": 0, "explained": 0, "failed": 0}
    for violation in page["items"]:
        counts[violation["status"]] = counts.get(violation["status"], 0) + 1
    totals["total"] += page["total"]
    for key in counts:
        totals[key] += counts[key]

    source = site.get("source") or {}
    rows.append(
        {
            "site": site,
            "source": source,
            "violations": page["total"],
            "counts": counts,
        }
    )

st.markdown("### At a glance")
a, b, c, d, e = st.columns(5)
a.metric("Sites", len(sites))
b.metric("Violations", totals["total"])
c.metric("Awaiting review", totals["detected"])
d.metric("Explained", totals["explained"])
e.metric("AI review failed", totals["failed"])

if totals["pending"]:
    st.info(
        f"{totals['pending']} AI review(s) still in progress. "
        "The Violations page updates automatically when they finish.",
        icon="⏳",
    )

st.divider()
st.markdown("### Sites")

for row in rows:
    site, source, counts = row["site"], row["source"], row["counts"]
    with st.container(border=True):
        left, right = st.columns([3, 2])
        with left:
            st.markdown(f"**{site['name']}**")
            st.caption(f"`{site['id']}`  ·  created {ui.ts(site['created_at'], with_seconds=False)}")
            if source:
                metadata = source.get("metadata") or {}
                resolution = metadata.get("resolution") or {}
                bits = [f"{source['kind']} v{source['version']}"]
                if resolution.get("width"):
                    bits.append(f"{resolution['width']}×{resolution['height']}")
                if metadata.get("fps"):
                    bits.append(f"{metadata['fps']:g} fps")
                if metadata.get("duration_seconds"):
                    bits.append(f"{metadata['duration_seconds']:.1f}s")
                st.caption(" · ".join(bits))
            else:
                st.caption("No video attached")

        with right:
            st.markdown(
                ui.labelled_chip("video", source.get("status") if source else None)
                + "&nbsp;&nbsp;&nbsp;"
                + f'<span style="color:#64748b;font-size:0.78rem;">violations</span> '
                + f'<b style="font-size:1.05rem;">{row["violations"]}</b>',
                unsafe_allow_html=True,
            )
            if row["violations"]:
                st.markdown(
                    " ".join(
                        ui.chip(status, f"{status} {n}")
                        for status, n in counts.items()
                        if n
                    ),
                    unsafe_allow_html=True,
                )

        if st.button("Open", key=f"open_{site['id']}"):
            st.session_state["site_id"] = site["id"]
            st.switch_page("pages/4_Violations.py")
