"""The evidence review: drawing a finished one, and following one as it is written.

A REVIEW IS TWO THINGS ON THE API. `GET .../review` is the status and, once completed,
the Review document the agent submitted. `GET .../review/events` is every step it took
to get there — the tracking facts it started from, the questions it put to the legal
source and what came back, the sentences as it wrote them. The document cites the facts
by id and the sources by tool and turn, so the steps are what make those citations
readable; but a finished review plays its steps back at up to 1.5 s apart, so they are
fetched only when asked for, never on every page load.

Nothing here talks to the API except through the `Api` it is handed.
"""

from __future__ import annotations

import html
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import streamlit as st

from lib import ui
from lib.api import Api, ApiError, ApiUnreachable

FLAG = {
    "on_foot": "The person was on foot, so the flag stands",
    "riding": "The person was riding, not walking — the flag likely does not stand",
    "unclear": "Whether the person was on foot cannot be told from the evidence",
}
AUDIENCE = {"legal": "law", "driver": "driver", "site": "site"}
GROUP = {
    "exact": "Measured",
    "relative": "Relative",
    "estimate": "Estimated",
    "check": "Checks for a false flag",
}
# One redraw per this many seconds while following: a review writes hundreds of small
# pieces, and redrawing the panel on each one makes the browser the bottleneck.
REDRAW_SECONDS = 0.25


# ---------------------------------------------------------------------------
# The steps, folded into one state
# ---------------------------------------------------------------------------


@dataclass
class Progress:
    """Everything the event stream has said so far, folded into what a page draws."""

    step: str = ""
    steps: list[tuple[float, str]] = field(default_factory=list)
    facts: dict[str, dict] = field(default_factory=dict)
    questions: dict[int, dict] = field(default_factory=dict)
    exchanges: list[dict] = field(default_factory=list)
    thinking: str = ""
    writing: dict[tuple[str, int], str] = field(default_factory=dict)
    review: dict | None = None
    error: str | None = None
    done: dict | None = None
    model: str | None = None
    replay: bool = False
    # Set when the stream itself broke off, rather than the review reporting an error.
    broken: str | None = None
    elapsed: float = 0.0

    def add(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "replay":
            self.replay = True
            return
        data = event.get("data") or {}
        self.elapsed = event.get("elapsed_seconds", self.elapsed)
        if kind == "manifest":
            self.model = data.get("model")
        elif kind == "facts":
            self.facts = {f["id"]: f for f in data.get("facts", [])}
        elif kind == "step":
            self.step = data.get("text", "")
            self.steps.append((self.elapsed, self.step))
            self.thinking = ""
        elif kind == "thinking":
            self.thinking += data.get("text", "")
        elif kind == "questions":
            self.questions = {q["id"]: q for q in data.get("questions", [])}
        elif kind == "question":
            self.exchanges.append({**data, "answer": None})
        elif kind == "answer":
            for exchange in reversed(self.exchanges):
                if exchange.get("tool") == data.get("tool") and exchange.get("turn") == data.get("turn"):
                    exchange["answer"] = data
                    break
        elif kind == "refused":
            self.steps.append((self.elapsed, f"Refused {data.get('tool')}: {data.get('reason')}"))
        elif kind == "writing":
            key = (data.get("field", ""), data.get("index", 0))
            self.writing[key] = self.writing.get(key, "") + data.get("text", "")
        elif kind == "review":
            self.review = data.get("review")
        elif kind == "done":
            self.done = data
            self.model = data.get("model") or self.model
        elif kind == "error":
            self.error = data.get("message")

    def answer_for(self, source: dict | None) -> dict | None:
        """The exchange a review's `source: {tool, turn}` points at."""
        if not source:
            return None
        for exchange in self.exchanges:
            if exchange.get("tool") == source.get("tool") and exchange.get("turn") == source.get("turn"):
                return exchange
        return None


def collect(events: Iterable[dict], stop_after: str | None = None) -> Progress:
    progress = Progress()
    for event in events:
        progress.add(event)
        if stop_after and event.get("type") == stop_after:
            break
    return progress


@st.cache_data(show_spinner="Reading the review's steps…", ttl=3600, max_entries=64)
def steps_of(base_url: str, site_id: str, violation_id: str, updated_at: str) -> Progress:
    """A finished review's steps, all of them. Cached on the violation's updated_at, which
    moves whenever a review starts or finishes, so a review run again is read again."""
    return collect(Api(base_url).review_events(site_id, violation_id))


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------


def _facts_line(ids: list[str], progress: Progress | None) -> str:
    if not ids:
        return ""
    if progress is None or not progress.facts:
        return "Tracking facts: " + ", ".join(f"`{i}`" for i in ids)
    named = [progress.facts[i]["statement"] if i in progress.facts else f"`{i}`" for i in ids]
    return "Tracking facts: " + "; ".join(named)


def _basis(points: list[dict], progress: Progress | None) -> None:
    for point in points:
        st.markdown(f"- {point['point']}")
        notes = []
        if point.get("tracking_facts"):
            notes.append(_facts_line(point["tracking_facts"], progress))
        if point.get("picture"):
            notes.append("seen in the key frame")
        source = point.get("source")
        if source:
            notes.append(f"{source['tool'].replace('_', ' ')}, turn {source['turn']}")
        if notes:
            st.caption("  \n".join(notes))
        if point.get("quote"):
            st.markdown(f"> {point['quote']}")


def _recommendation(item: dict, progress: Progress | None) -> None:
    st.markdown(item["text"])
    if item.get("justification"):
        with st.expander("What this rests on"):
            _basis(item["justification"], progress)


def draw(review: dict, progress: Progress | None = None) -> None:
    """A completed review. `progress` is optional: given the steps, fact ids and source
    turns are written out in full; without them they are shown as ids."""
    review = ui.unescape(review)
    flag = review.get("flag_check") or {}
    status = flag.get("status")
    note = FLAG.get(status, status or "")
    if status == "riding":
        st.warning(f"**{note}.**", icon=":material/block:")
    elif status == "unclear":
        st.info(f"**{note}.**", icon=":material/help:")
    else:
        st.success(f"**{note}.**", icon=":material/check_circle:")
    if flag.get("seen"):
        st.markdown(flag["seen"])
    if flag.get("tracking_facts") or flag.get("picture"):
        st.caption(
            "  \n".join(
                part
                for part in (
                    _facts_line(flag.get("tracking_facts") or [], progress),
                    "seen in the key frame" if flag.get("picture") else "",
                )
                if part
            )
        )

    st.markdown("**Summary**")
    st.markdown(review.get("summary", ""))

    clerk = review.get("clerk_recommendation")
    if clerk:
        st.markdown("**Recommendation to the clerk**")
        _recommendation(clerk, progress)

    for title, key in (("For the driver", "driver_recommendations"), ("For the site", "site_recommendations")):
        items = review.get(key) or []
        if items:
            st.markdown(f"**{title}**")
            for item in items:
                with st.container(border=True):
                    _recommendation(item, progress)

    legal = review.get("legal_candidates") or []
    if legal:
        st.markdown("**Rules that may apply**")
        for candidate in legal:
            article = f" — {candidate['article']}" if candidate.get("article") else ""
            st.markdown(f"- **{candidate['rule']}**{article}")
            cited = candidate.get("source_as_cited")
            if cited:
                st.caption(cited)
        st.caption("Candidates the legal source pointed to, not a legal finding.")

    unsure = review.get("still_unsure") or []
    if unsure:
        st.markdown("**Still unsure**")
        for line in unsure:
            st.markdown(f"- {line}")

    final = review.get("open_questions_final") or []
    if final and progress is not None and progress.questions:
        with st.expander("The questions it set itself"):
            for item in final:
                question = progress.questions.get(item["id"], {})
                st.markdown(
                    ui.chip(item["status"]) + "&nbsp;&nbsp;" + html.escape(question.get("question", f"question {item['id']}")),
                    unsafe_allow_html=True,
                )


def draw_steps(progress: Progress, live: bool = False) -> None:
    """The steps a review took: where it is now, what it asked, what it is writing."""
    if live and progress.step:
        st.markdown(f"**{progress.step}…**")
        st.caption(f"{progress.elapsed:.0f}s in")
    if live and progress.thinking:
        st.caption(progress.thinking[-400:])

    if progress.questions:
        st.markdown("**Open questions**")
        for question in progress.questions.values():
            goal = AUDIENCE.get(question.get("goal"), question.get("goal", ""))
            st.markdown(
                ui.chip(question["status"]) + "&nbsp;&nbsp;" + html.escape(question["question"])
                + f' <span style="color:#757575;font-size:.8rem;">· {html.escape(goal)}</span>',
                unsafe_allow_html=True,
            )

    if progress.exchanges:
        st.markdown("**Asked the legal source**")
        for exchange in progress.exchanges:
            answer = exchange.get("answer")
            title = f"Turn {exchange.get('turn')} · {exchange.get('question', '')[:90]}"
            with st.expander(title, expanded=live and answer is None):
                st.markdown(f"*{exchange.get('question', '')}*")
                if answer is None:
                    st.caption("Waiting for the answer…")
                elif answer.get("error"):
                    st.error(answer["error"], icon=":material/cloud_off:")
                else:
                    st.markdown(ui.unescape(answer.get("answer", "")))
                    if answer.get("references"):
                        st.caption("References: " + "; ".join(answer["references"]))
                    if answer.get("seconds") is not None:
                        st.caption(f"Answered in {answer['seconds']:.0f}s")

    if live and progress.writing and progress.review is None:
        st.markdown("**Writing the review**")
        st.markdown("\n\n".join(ui.unescape(text) for text in progress.writing.values()))

    if progress.facts and not live:
        with st.expander(f"Tracking facts ({len(progress.facts)})"):
            by_group: dict[str, list[dict]] = {}
            for fact in progress.facts.values():
                by_group.setdefault(fact.get("group", ""), []).append(fact)
            for group, facts in by_group.items():
                st.markdown(f"**{GROUP.get(group, group)}**")
                for fact in facts:
                    st.markdown(f"- `{fact['id']}` {fact['statement']}")

    if progress.steps and not live:
        with st.expander("Every step"):
            for elapsed, text in progress.steps:
                st.markdown(f"`{elapsed:6.1f}s` {html.escape(text)}", unsafe_allow_html=True)

    if progress.done:
        calls = progress.done.get("tool_calls") or {}
        usage = progress.done.get("usage") or {}
        parts = [progress.done.get("model") or "", f"{progress.done.get('model_calls', 0)} model turns"]
        if calls:
            parts.append(", ".join(f"{n}× {tool.replace('_', ' ')}" for tool, n in calls.items()))
        tokens = (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0)
        if tokens:
            parts.append(f"{tokens:,} tokens")
        parts.append(f"{progress.elapsed:.0f}s")
        st.caption(" · ".join(p for p in parts if p))


def follow(client: Api, site_id: str, violation_id: str) -> Progress:
    """Draw a running review's steps as they arrive; returns once it has finished.

    Blocks the script while it streams, which is what a Streamlit page wants here: the
    panel redraws in place, and any click on the page reruns the script and drops the
    stream with it.
    """
    panel = st.empty()
    progress = Progress()
    drawn = 0.0
    try:
        for event in client.review_events(site_id, violation_id):
            progress.add(event)
            if time.monotonic() - drawn >= REDRAW_SECONDS or event.get("type") in ("review", "done", "error"):
                with panel.container():
                    draw_steps(progress, live=True)
                drawn = time.monotonic()
    except (ApiError, ApiUnreachable) as exc:
        progress.broken = str(exc)
    panel.empty()
    return progress


def chip_label(status: str | None) -> str:
    """The violation's explanation_status, in the review's words."""
    return {
        "detected": "not reviewed",
        "pending": "reviewing",
        "explained": "reviewed",
        "failed": "review failed",
    }.get(status or "", status or "none")


def review_chip(status: str | None, prefix: Any = None) -> str:
    label = chip_label(status)
    return ui.chip(status, f"{label} {prefix}" if prefix is not None else label)
