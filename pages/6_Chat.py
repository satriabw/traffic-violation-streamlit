"""The chat about one violation, on a page of its own.

Pick a violation (or come from the Violations page with one), see its key frame, and ask about it: what happened,
whether the detection holds, which law may apply, what the driver and the site could do. Each answer is followed as
it is written, and the steps behind it fold out under the reply. Shown only with CHAT_ENABLED.
"""

from __future__ import annotations

import requests
import streamlit as st

from lib import chat, review, ui
from lib.api import ApiError, ApiUnreachable

client = ui.sidebar()
site = ui.site_selector(client)

ui.page_header(
    "Chat",
    "Ask about one violation: what happened, whether the detection holds, which law may apply, "
    "and what the driver and the site could do.",
    eyebrow="Assistant",
)

if not chat.ENABLED:
    ui.empty("The chat is off.", "Set CHAT_ENABLED=1 for this console and for site-service.")
    st.stop()
if site is None:
    ui.empty("Pick a site in the sidebar.")
    st.stop()

try:
    violations = client.list_violations(site["id"], limit=100)["items"]
except (ApiError, ApiUnreachable) as exc:
    ui.error(exc)
    st.stop()
if not violations:
    ui.empty("No violations at this site yet.")
    st.stop()

# Coming from the Violations page picks its violation, even one past the newest hundred.
wanted = st.session_state.pop("chat_violation_id", None)
if wanted and wanted not in {v["id"] for v in violations}:
    try:
        violations.insert(0, client.get_violation(site["id"], wanted))
    except (ApiError, ApiUnreachable):
        wanted = None
if wanted:
    st.session_state["chat_page_violation"] = wanted
by_id = {v["id"]: v for v in violations}
if st.session_state.get("chat_page_violation") not in by_id:
    st.session_state["chat_page_violation"] = violations[0]["id"]


def _label(violation_id: str) -> str:
    v = by_id[violation_id]
    return f"{v['type'].replace('_', ' ').capitalize()} · {v['detected_at'][:19].replace('T', ' ')} · {violation_id[:8]}"


chosen = st.selectbox("Violation", list(by_id), format_func=_label, key="chat_page_violation")
violation = by_id[chosen]

picture, talk = st.columns([2, 3], gap="large")

with picture:
    if violation.get("thumbnail_url"):
        try:
            st.image(ui.fetch_bytes(violation["thumbnail_key"], client.absolute(violation["thumbnail_url"])),
                     width="stretch")
        except requests.RequestException as exc:
            st.error(f"Could not load the image: {exc}", icon=":material/broken_image:")
    else:
        st.info("No picture for this violation yet.", icon=":material/image:")
    st.markdown(
        review.review_chip(violation.get("explanation_status")) + "&nbsp;&nbsp;"
        + f"Detected {violation['detected_at'][:19].replace('T', ' ')} UTC · frame {violation.get('frame_index')}",
        unsafe_allow_html=True,
    )
    st.caption("The review stays on the Violations page; this chat reads the same record and the same legal source.")

with talk:
    chat.draw(client, site["id"], violation["id"], heading=False)
