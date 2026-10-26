"""Overview: every site at once.

Aggregated here, because the API has no cross-site endpoint — violations are read per
site, deliberately, since each list is resolved against the setup that site runs now.
Cached for half a minute so moving between pages does not refetch everything.
"""

from __future__ import annotations

import datetime as dt

import altair as alt
import pandas as pd
import streamlit as st

from lib import ui
from lib.api import Api, ApiError, ApiUnreachable

client = ui.sidebar()

# Base mono greys for chart chrome; its one accent for the single series.
INK, INK_SOFT, MUTED, GRID, BASE = "#000000", "#545454", "#757575", "#eeeeee", "#cbcbcb"
SERIES_1 = "#276ef1"
MAX_PER_SITE = 1000


@st.cache_data(ttl=30, show_spinner="Loading sites…")
def load(base_url: str) -> dict:
    api = Api(base_url)
    sites = api.all_sites()
    violations, runs = [], []
    for site in sites:
        offset = 0
        while offset < MAX_PER_SITE:
            page = api.list_violations(site["id"], limit=100, offset=offset)
            for item in page["items"]:
                violations.append({**item, "site": site["name"]})
            offset += 100
            if offset >= page["total"]:
                break
        for run in api.list_runs(site["id"], limit=20)["items"]:
            runs.append({**run, "site": site["name"]})
    return {"sites": sites, "violations": violations, "runs": runs, "at": dt.datetime.now()}


try:
    data = load(client.base_url)
except (ApiError, ApiUnreachable) as exc:
    ui.page_header("Overview")
    ui.error(exc)
    st.stop()

head, refresh = st.columns([6, 1], vertical_alignment="bottom")
with head:
    ui.page_header(
        "Overview",
        f"All sites · updated {data['at']:%H:%M:%S}",
        eyebrow="Monitoring",
    )
if refresh.button("Refresh", icon=":material/refresh:", width="stretch"):
    load.clear()
    st.rerun()

sites, runs = data["sites"], data["runs"]
if not sites:
    ui.empty("No sites yet.", "Create one under Setup > Sites, then give it a source on Site setup.")
    st.stop()

violations = pd.DataFrame(data["violations"])
if violations.empty:
    violations = pd.DataFrame(columns=["site", "site_id", "explanation_status", "detected_at", "type"])
violations["detected_at"] = pd.to_datetime(violations["detected_at"], utc=True)
status = violations["explanation_status"].value_counts()

# ---------------------------------------------------------------------------
# Key figures
# ---------------------------------------------------------------------------

streams = sum(1 for s in sites if (s.get("source") or {}).get("kind") == "stream")
busy = sum(1 for r in runs if r["status"] in ("queued", "running"))
failed_runs = sum(1 for r in runs if r["status"] == "failed")

tiles = st.columns(5)
tiles[0].metric("Sites", len(sites), help=f"{streams} with a live feed", border=True)
tiles[1].metric("Violations", f"{len(violations):,}", border=True)
tiles[2].metric(
    "Awaiting review", int(status.get("detected", 0)),
    help="Detected, not yet sent for the evidence review", border=True,
)
tiles[3].metric(
    "Reviewed", int(status.get("explained", 0)),
    help=f"{int(status.get('pending', 0))} in progress, {int(status.get('failed', 0))} failed",
    border=True,
)
tiles[4].metric(
    "Runs in progress", busy,
    help=f"Among each site's 20 latest runs; {failed_runs} failed", border=True,
)

# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------


def axis(**kwargs) -> alt.Axis:
    return alt.Axis(
        labelColor=MUTED, titleColor=INK_SOFT, gridColor=GRID, domainColor=BASE,
        tickColor=BASE, labelFont="Inter", titleFont="Inter", titleFontWeight=500, **kwargs
    )


def frame(chart: alt.Chart, height: int = 260) -> alt.Chart:
    return chart.properties(height=height).configure_view(stroke=None).configure(
        font="Inter", background="transparent"
    )


left, right = st.columns([3, 2], gap="large")

with left:
    with st.container(border=True):
        st.subheader("Violations detected per day", anchor=False)
        if violations.empty:
            ui.empty("No violations yet.")
        else:
            per_day = (
                violations.assign(day=violations["detected_at"].dt.tz_convert(ui.LOCAL_TZ).dt.tz_localize(None).dt.normalize())
                .groupby("day").size().rename("violations").reset_index()
            )
            span = pd.date_range(per_day["day"].min(), per_day["day"].max(), freq="D")
            per_day = per_day.set_index("day").reindex(span, fill_value=0).rename_axis("day").reset_index()
            chart = alt.Chart(per_day).mark_bar(
                color=SERIES_1, cornerRadiusTopLeft=4, cornerRadiusTopRight=4,
                size=max(6, min(36, 480 // len(per_day))),
            ).encode(
                x=alt.X("yearmonthdate(day):O", title=None, axis=axis(format="%d %b", grid=False, labelAngle=0)),
                y=alt.Y("violations:Q", title=None, axis=axis(tickMinStep=1, domain=False, ticks=False)),
                tooltip=[alt.Tooltip("day:T", title="Day", format="%a %d %b %Y"),
                         alt.Tooltip("violations:Q", title="Violations")],
            )
            st.altair_chart(frame(chart), width="stretch")

with right:
    with st.container(border=True):
        st.subheader("Violations by site", anchor=False)
        by_site = pd.DataFrame(
            {"site": [s["name"] for s in sites]}
        ).merge(
            violations.groupby("site").size().rename("violations").reset_index(), how="left"
        ).fillna({"violations": 0})
        chart = alt.Chart(by_site).mark_bar(
            color=SERIES_1, cornerRadiusTopRight=4, cornerRadiusBottomRight=4, size=18,
        ).encode(
            y=alt.Y("site:N", sort="-x", title=None, axis=axis(domain=False, ticks=False, labelLimit=180)),
            x=alt.X("violations:Q", title=None, axis=axis(tickMinStep=1, domain=False)),
            tooltip=[alt.Tooltip("site:N", title="Site"), alt.Tooltip("violations:Q", title="Violations")],
        )
        st.altair_chart(frame(chart), width="stretch")

# ---------------------------------------------------------------------------
# Sites
# ---------------------------------------------------------------------------

st.subheader("Sites", anchor=False)
st.caption("Select a row to review that site's violations.")

rows = []
for site in sites:
    source = site.get("source") or {}
    mine = violations[violations["site"] == site["name"]]
    counts = mine["explanation_status"].value_counts()
    rows.append(
        {
            "id": site["id"],
            "Site": site["name"],
            "Source": {"stream": "Live feed", "video": "Video"}.get(source.get("kind"), "None"),
            "Source status": source.get("status") or "—",
            "Violations": len(mine),
            "Awaiting review": int(counts.get("detected", 0)),
            "Reviewed": int(counts.get("explained", 0)),
            "Last detected": mine["detected_at"].max().tz_convert(ui.LOCAL_TZ).tz_localize(None) if len(mine) else None,
            "Created": pd.to_datetime(site["created_at"]).tz_convert(ui.LOCAL_TZ).tz_localize(None),
        }
    )
table = pd.DataFrame(rows)
picked = st.dataframe(
    table,
    hide_index=True,
    width="stretch",
    column_order=[c for c in table.columns if c != "id"],
    column_config={
        "Violations": st.column_config.NumberColumn(format="%d"),
        "Last detected": st.column_config.DatetimeColumn(format="D MMM YYYY, HH:mm"),
        "Created": st.column_config.DatetimeColumn(format="D MMM YYYY"),
    },
    on_select="rerun",
    selection_mode="single-row",
    key="overview_sites",
)
if picked.selection.rows:
    st.session_state["site_id"] = table.iloc[picked.selection.rows[0]]["id"]
    st.session_state.pop("violation_id", None)
    st.switch_page("pages/4_Violations.py")

# ---------------------------------------------------------------------------
# Recent runs
# ---------------------------------------------------------------------------

st.subheader("Recent detection runs", anchor=False)
if not runs:
    ui.empty("No detection runs yet.", "Start one under Operations > Detection.")
else:
    recent = pd.DataFrame(
        [
            {
                "Started": pd.to_datetime(r["created_at"]).tz_convert(ui.LOCAL_TZ).tz_localize(None),
                "Site": r["site"],
                "Status": r["status"],
                "Footage": ui.run_span(ui.source_of(client, r["site_id"], r.get("source_id")), r),
                "Types": ", ".join(t.replace("_", " ") for t in r["types"]),
                "Error": r.get("error") or "",
            }
            for r in sorted(runs, key=lambda r: r["created_at"], reverse=True)[:12]
        ]
    )
    st.dataframe(
        recent,
        hide_index=True,
        width="stretch",
        column_config={"Started": st.column_config.DatetimeColumn(format="D MMM, HH:mm:ss")},
    )
