"""Entry point: the page setup and navigation every page shares.

Run with `streamlit run serve.py`, which adds the storage relay; `streamlit run app.py`
works too, without it. Each page under pages/ draws its own content and calls
`ui.sidebar()` first.
"""

from __future__ import annotations

import streamlit as st

from lib import ui

st.set_page_config(
    page_title="Traffic Violation Console",
    page_icon="assets/mark.svg",
    layout="wide",
    initial_sidebar_state="expanded",
)
st.logo("assets/logo.svg", size="large", icon_image="assets/mark.svg")
ui.style()

navigation = st.navigation(
    {
        "Monitoring": [
            st.Page("pages/0_Overview.py", title="Overview", icon=":material/dashboard:", default=True),
            st.Page("pages/2_Site_View.py", title="Site view", icon=":material/videocam:"),
            st.Page("pages/4_Violations.py", title="Violations", icon=":material/report:"),
        ],
        "Operations": [
            st.Page("pages/3_Detection.py", title="Detection", icon=":material/play_circle:"),
        ],
        "Setup": [
            st.Page("pages/1_Sites.py", title="Sites", icon=":material/location_on:"),
            st.Page("pages/2_Site_Setup.py", title="Site setup", icon=":material/tune:"),
            st.Page("pages/5_Files.py", title="Files", icon=":material/folder:"),
        ],
    }
)
navigation.run()
