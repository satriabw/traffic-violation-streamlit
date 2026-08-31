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
    "Reserve a key, PUT the bytes straight to object storage, then confirm. File bytes "
    "never pass through the API — it only ever hands out signed URLs."
)

upload_tab, lookup_tab = st.tabs(["Upload", "Look up by id"])

# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

with upload_tab:
    uploaded = st.file_uploader("Any file", key="files_upload")
    file_type = st.selectbox(
        "Type",
        FILE_TYPES,
        help=(
            "Not cosmetic — it decides the key the object is stored under, and the "
            "endpoints that reference a file check it. A configuration attached from a "
            "file typed `video` is refused."
        ),
    )

    if uploaded:
        data = uploaded.getvalue()
        content_type = uploaded.type or mimetypes.guess_type(uploaded.name)[0]
        st.caption(f"{uploaded.name} · {ui.bytes_human(len(data))} · `{content_type or 'unknown'}`")

        if st.button("Upload", type="primary"):
            with st.status("Uploading", expanded=True) as box:
                try:
                    st.write("**1/3** Reserving a key…")
                    reserved = client.create_file(uploaded.name, file_type, len(data), content_type)
                    st.write(f"`{reserved['id']}` — status `{reserved['status']}`")
                    st.caption(
                        f"The URL is good for {reserved['upload_expires_in']}s. It is a "
                        "spending authorisation, which is why the size cap is applied "
                        "when it is issued rather than after the bytes have arrived."
                    )

                    st.write("**2/3** PUTting to object storage…")
                    client.put_object(reserved["upload_url"], data, content_type)
                    st.write("Accepted.")

                    st.write("**3/3** Confirming…")
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
        st.caption("This session's memory — the API has no endpoint that lists files.")
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
                "`url` is the object key, not a URL — the column name is inherited from "
                "the design. `download_url` below is signed fresh on every read, which "
                "is why it is never stored."
            )

            if file.get("download_url"):
                st.link_button("Open the signed download URL", file["download_url"])
                if file["type"] == "video":
                    st.video(file["download_url"])
            st.json(file, expanded=False)
