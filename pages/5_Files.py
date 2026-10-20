"""Files, on their own.

Files are a top-level resource in the API — a video belongs to a site, but a calibration
or an evidence frame does not — so they get a page that does not ask which site you are
on. Site Setup uploads *and attaches* in one go; this page is the other half: upload
without attaching, and look up a file by id.

There is no list endpoint. `GET /files` does not exist, so nothing here can enumerate
the bucket, and the lookup below is by id only. The recently-uploaded list is this
session's own memory, not a read.
"""

from __future__ import annotations

import mimetypes

import streamlit as st

from lib import ui
from lib.api import FILE_TYPES, ApiError, ApiUnreachable

st.set_page_config(page_title="Files", page_icon="📁", layout="wide")

client = ui.sidebar()

st.title("📁 Files")
st.caption(
    "Upload a file, or look up one that was uploaded earlier."
)

upload_tab, lookup_tab = st.tabs(["Upload", "Find by ID"])

# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

with upload_tab:
    uploaded = st.file_uploader("Any file", key="files_upload")
    file_type = st.selectbox(
        "Type",
        FILE_TYPES,
        help=(
            "Choose what the file is. It must match how the file will be used — for "
            "example, a file marked as video cannot be used as a configuration."
        ),
    )

    if uploaded:
        data = uploaded.getvalue()
        content_type = uploaded.type or mimetypes.guess_type(uploaded.name)[0]
        st.caption(f"{uploaded.name} · {ui.bytes_human(len(data))} · `{content_type or 'unknown'}`")

        if st.button("Upload", type="primary"):
            with st.status("Uploading", expanded=True) as box:
                try:
                    st.write("**1/3** Preparing the upload…")
                    reserved = client.create_file(uploaded.name, file_type, len(data), content_type)
                    st.write(f"File ID `{reserved['id']}`")
                    st.caption(f"The upload link is valid for {reserved['upload_expires_in']} seconds.")

                    st.write("**2/3** Uploading…")
                    client.put_object(reserved["upload_url"], data, content_type)
                    st.write("Accepted.")

                    st.write("**3/3** Checking the upload…")
                    confirmed = client.complete_upload(reserved["id"])
                except (ApiError, ApiUnreachable) as exc:
                    box.update(label="Upload failed", state="error")
                    ui.error(exc)
                else:
                    box.update(label=f"Uploaded {uploaded.name}", state="complete")
                    st.success(f"File id `{confirmed['id']}` — status `{confirmed['status']}`")
                    st.code(confirmed["id"], language=None)
                    st.session_state.setdefault("recent_files", [])
                    st.session_state["recent_files"].insert(0, confirmed)
                    del st.session_state["recent_files"][12:]

    recent = st.session_state.get("recent_files") or []
    if recent:
        st.divider()
        st.markdown("#### Uploaded in this session")
        st.caption("Only files uploaded since this page was opened are listed here.")
        for file in recent:
            with st.container(border=True):
                cols = st.columns([3, 1, 1, 1])
                cols[0].markdown(f"**{file['name']}**")
                cols[0].caption(f"`{file['id']}`")
                cols[1].markdown(ui.chip(file["type"]), unsafe_allow_html=True)
                cols[2].markdown(ui.chip(file["status"]), unsafe_allow_html=True)
                cols[3].caption(ui.bytes_human(file.get("size_bytes")))

# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------

with lookup_tab:
    file_id = st.text_input("File id", placeholder="f80b2b35-2cf9-477c-8b49-45c576752f11")
    if file_id.strip():
        try:
            file = client.get_file(file_id.strip())
        except (ApiError, ApiUnreachable) as exc:
            ui.error(exc)
        else:
            cols = st.columns(4)
            cols[0].markdown(f"**{file['name']}**")
            cols[1].markdown(ui.labelled_chip("type", file["type"]), unsafe_allow_html=True)
            cols[2].markdown(ui.labelled_chip("status", file["status"]), unsafe_allow_html=True)
            cols[3].caption(ui.bytes_human(file.get("size_bytes")))
            st.caption(
                f"key `{file['url']}` · created {ui.ts(file['created_at'])}"
            )
            st.caption(
                "`url` is where the file is stored, not a web link. Use the button below to "
                "download it."
            )

            if file.get("download_url"):
                st.link_button("Download file", client.absolute(file["download_url"]))
                if file["type"] == "video":
                    st.video(client.absolute(file["download_url"]))
            st.json(file, expanded=False)
