"""The chat about one violation: pick or start a chat, ask it questions, read each reply with the steps behind it
folded underneath. Off unless CHAT_ENABLED is set here, and the backend's chat routes are on."""

import html
import os
import time

import streamlit as st

from lib import review
from lib.api import Api, ApiError, ApiUnreachable

ENABLED = os.environ.get("CHAT_ENABLED", "").lower() in ("1", "true", "yes")
REDRAW_SECONDS = 0.4
NEW = "new"


def follow(client: Api, site_id: str, violation_id: str, chat_id: str, after: int) -> review.Progress:
    """Draw the question being answered as its steps arrive: the steps so far, then the reply as it is written."""
    panel = st.empty()
    progress = review.Progress()
    drawn = 0.0
    try:
        for event in client.chat_events(site_id, violation_id, chat_id, after=after):
            progress.add(event)
            if time.monotonic() - drawn >= REDRAW_SECONDS or event.get("type") in ("reply", "done", "error"):
                with panel.container():
                    _steps(progress)
                    if progress.text:
                        st.markdown(progress.text)
                drawn = time.monotonic()
    except (ApiError, ApiUnreachable) as exc:
        progress.broken = str(exc)
    panel.empty()
    return progress


@st.cache_data(show_spinner=False, ttl=3600, max_entries=32)
def _steps_of(base_url: str, site_id: str, violation_id: str, chat_id: str, updated_at: str) -> list[dict]:
    # Keyed on updated_at, which moves with every answer, so a cached chat is never stale.
    return [e for e in Api(base_url).chat_events(site_id, violation_id, chat_id, paced=False) if e.get("type") != "replay"]


def _steps(progress: review.Progress) -> None:
    if progress.timeline:
        st.markdown("\n".join(f"- {html.escape(line[-600:])}" for line in progress.timeline[-14:]),
                    unsafe_allow_html=True)


def _turn_steps(events: list[dict], turn: dict) -> review.Progress:
    return review.collect(e for e in events if turn["first_event"] <= e["sequence"] <= turn["last_event"])


def draw(client: Api, site_id: str, violation_id: str, heading: bool = True) -> None:
    if heading:
        st.markdown("#### Ask about this violation")
    st.caption("For the team, not the clerk: answers give numbers and name the tools and road users they rest on. "
               "Five questions per chat; a new chat starts from the violation again.")
    try:
        chats = client.list_chats(site_id, violation_id)
    except ApiError as exc:
        if exc.status == 404:
            st.info("The chat is off on this backend: set CHAT_ENABLED for site-service.", icon=":material/chat:")
            return
        st.error(str(exc))
        return
    except ApiUnreachable as exc:
        st.error(str(exc))
        return

    labels = {NEW: "New chat"} | {
        c["id"]: f"{c['title'] or 'Untitled'} · {c['questions']} question{'s' if c['questions'] != 1 else ''}"
        for c in chats
    }
    key = f"chat_{violation_id}"
    # A chat started or deleted in the last run is picked here, before the select box is drawn.
    if f"next_{key}" in st.session_state:
        st.session_state[key] = st.session_state.pop(f"next_{key}")
    if st.session_state.get(key) not in labels:
        st.session_state[key] = chats[0]["id"] if chats else NEW
    pick, remove = st.columns([5, 1], vertical_alignment="bottom")
    chosen = pick.selectbox("Chat", list(labels), format_func=labels.get, key=key)

    chat = None
    if chosen != NEW:
        try:
            chat = client.get_chat(site_id, violation_id, chosen)
        except (ApiError, ApiUnreachable) as exc:
            st.error(str(exc))
            return
        if remove.button("Delete", key=f"delete_{chosen}", width="stretch"):
            client.delete_chat(site_id, violation_id, chosen)
            st.session_state[f"next_{key}"] = NEW
            st.rerun()

    if chat:
        events = _steps_of(client.base_url, site_id, violation_id, chat["id"], chat["updated_at"]) \
            if chat["status"] != "answering" else []
        for turn in chat["turns"]:
            with st.chat_message("user"):
                st.markdown(turn["text"])
            if turn["reply"] is None and turn["error"] is None:
                continue
            with st.chat_message("assistant"):
                if turn["reply"] is not None:
                    st.markdown(turn["reply"])
                if turn["error"]:
                    st.error(turn["error"], icon=":material/warning:")
                steps = _turn_steps(events, turn)
                if steps.timeline:
                    with st.expander("How it answered: steps", expanded=False):
                        _steps(steps)
                        st.caption(review.totals(steps))

    following = st.session_state.pop(f"follow_{violation_id}", None)
    if chat and (chat["status"] == "answering" or following):
        with st.chat_message("assistant"):
            with st.status("Answering…", expanded=True) as box:
                progress = follow(client, site_id, violation_id, chat["id"],
                                  after=chat["turns"][-1]["first_event"] if chat["turns"] else -1)
                box.update(label="Lost the stream; reload to follow it again" if progress.broken else "Answered",
                           state="error" if progress.broken or progress.error else "complete", expanded=False)
        if not progress.broken:
            st.rerun()

    full = chat is not None and chat["questions"] >= 5
    busy = chat is not None and chat["status"] == "answering"
    with st.container():
        asked = st.chat_input(
            "This chat has had its five questions; start a new chat." if full
            else "Ask about this violation", disabled=full or busy, key=f"ask_{violation_id}")
    if asked:
        try:
            if chat is None:
                chat = client.start_chat(site_id, violation_id)
                st.session_state[f"next_{key}"] = chat["id"]
            client.ask_chat(site_id, violation_id, chat["id"], asked)
        except (ApiError, ApiUnreachable) as exc:
            st.error(str(exc))
            return
        st.session_state[f"follow_{violation_id}"] = True
        st.rerun()
