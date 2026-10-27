"""The evidence review: drawing a finished one, and following one as it is written.

A REVIEW IS TWO THINGS ON THE API. `GET .../review` is the status and, once completed,
the Review document the agent submitted. `GET .../review/events` is every step it took
to get there — the tracking facts it started from, the questions it put to the legal
source and what came back, the sentences as it wrote them. The document cites the facts
by id and the sources by tool and turn, so the steps are what make those citations
readable; but a finished review plays its steps back at up to 1.5 s apart, so they are
fetched only when asked for, never on every page load.

THE CLERK SEES THE ADVICE, NEVER WHAT IT RESTS ON. The clerk card is the recommendation
with its basis points, the summary, the advice for the driver and the site, and each rule
with its article. Tracking facts, sources, quotes and documents are in the debug view
only (lib/trace.py), which is for the developers.

Nothing here talks to the API except through the `Api` it is handed.
"""

from __future__ import annotations

import html
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import streamlit as st

from lib import trace, ui
from lib.api import Api, ApiError, ApiUnreachable

FLAG = {
    "on_foot": "The person was on foot, so the flag stands",
    "riding": "The person was riding, not walking — the flag likely does not stand",
    "unclear": "Whether the person was on foot cannot be told from the evidence",
}
AUDIENCE = {"legal": "law", "driver": "driver", "site": "site"}
# One redraw per this many seconds while following: a review writes hundreds of small
# pieces, and redrawing the panel on each one makes the browser the bottleneck.
REDRAW_SECONDS = 0.25


# ---------------------------------------------------------------------------
# The steps, folded into one state
# ---------------------------------------------------------------------------


@dataclass
class Progress:
    """Everything the event stream has said so far, folded into what a page draws."""

    # Every event as it came, for the debug view, which reads the run in order.
    events: list[dict] = field(default_factory=list)
    step: str = ""
    # The lines the person watching reads as the agent's progress, in order.
    timeline: list[str] = field(default_factory=list)
    facts: dict[str, dict] = field(default_factory=dict)
    questions: dict[int, dict] = field(default_factory=dict)
    exchanges: list[dict] = field(default_factory=list)
    thinking: str = ""
    # Text the model wrote outside a tool call.
    text: str = ""
    # Questions put to a paced source so far, and how many it allows.
    budget: dict | None = None
    turns: list[dict] = field(default_factory=list)
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
        self.events.append(event)
        data = event.get("data") or {}
        self.elapsed = event.get("elapsed_seconds", self.elapsed)
        if kind == "manifest":
            self.model = data.get("model")
        elif kind == "status":
            # reading, asking, waiting, fallback: where the run is, in a line of its own.
            self._line(data.get("detail", ""))
        elif kind == "facts":
            self.facts = {f["id"]: f for f in data.get("facts", [])}
            groups: dict[str, int] = {}
            for fact in data.get("facts", []):
                groups[fact["group"]] = groups.get(fact["group"], 0) + 1
            self._line("The tracking gives " + ", ".join(f"{n} {g}" for g, n in groups.items()) + " facts")
        elif kind == "step":
            self.step = data.get("text", "")
            self._line(self.step + "…")
        elif kind == "thinking":
            self.thinking += data.get("text", "")
            if self.timeline and self.timeline[-1].startswith("Thinking..."):
                self.timeline[-1] += data.get("text", "")
            else:
                self.timeline.append("Thinking... " + data.get("text", ""))
        elif kind == "text":
            self.text += data.get("text", "")
        elif kind == "questions":
            questions = data.get("questions", [])
            still = sum(q["status"] == "open" for q in questions)
            if not self.questions:
                self._line(f"Unsure about {len(questions)} things: " + "; ".join(q["question"] for q in questions))
            else:
                settled = [q["question"] for q in questions if q["status"] != "open"]
                self._line(f"{still} still open" + (f"; settled: {settled[-1]}" if settled else ""))
            self.questions = {q["id"]: q for q in questions}
        elif kind == "question":
            self.exchanges.append({**data, "answer": None})
            self._line(f"Asking the legal source (turn {data.get('turn')}): {data.get('question', '')}")
        elif kind == "answer":
            for exchange in reversed(self.exchanges):
                if exchange.get("tool") == data.get("tool") and exchange.get("turn") == data.get("turn"):
                    exchange["answer"] = data
                    break
            # Which documents it rests on is for the developers: those are in the debug view only.
            self._line(f"Turn {data.get('turn')} failed: {data['error']}" if data.get("error")
                       else f"The legal source answered in {data.get('seconds', 0):.0f} s")
        elif kind == "budget":
            self.budget = data
        elif kind == "refused":
            # Only the legal source's own checks hold a question back.
            self._line(f"Not sent to {data.get('tool')}: {data.get('reason', '')} — “{data.get('question', '')}”")
        elif kind == "turn":
            self.turns.append(data)
        elif kind == "writing":
            # Where a rule was cited from is what it rests on: the debug view's, not the watcher's.
            if data.get("field") != "source_as_cited":
                key = (data.get("field", ""), data.get("index", 0))
                self.writing[key] = self.writing.get(key, "") + data.get("text", "")
        elif kind == "review":
            self.review = data.get("review")
        elif kind == "done":
            # The model asked for; one a turn fell back to is in that turn's own model.
            self.done = data
            self.model = data.get("model") or self.model
        elif kind == "error":
            self.error = data.get("message")

    def _line(self, text: str) -> None:
        if text:
            self.timeline.append(text)


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


def draw(review: dict) -> None:
    """A completed review, as the clerk reads it: the advice and nothing it rests on."""
    review = ui.unescape(review)
    flag = review.get("flag_check") or {}
    status = flag.get("status")
    # On foot is the ordinary case and needs no banner; the other two change how the
    # whole review reads, so they come first.
    if status in ("riding", "unclear"):
        (st.warning if status == "riding" else st.info)(
            f"**{FLAG[status]}.** {flag.get('seen', '')}",
            icon=":material/block:" if status == "riding" else ":material/help:",
        )

    clerk = review.get("clerk_recommendation")
    if clerk:
        with st.container(border=True):
            st.markdown("##### Recommended next step")
            st.markdown(f"**{clerk['text']}**")
            points = clerk.get("justification") or []
            if points:
                st.markdown("**Basis**")
                st.markdown("\n".join(f"{n}. {point['point']}" for n, point in enumerate(points, 1)))
            st.caption("Guidance only: the clerk decides.")

    if review.get("summary"):
        st.markdown(review["summary"])

    for title, key in (("For the driver", "driver_recommendations"), ("For the site", "site_recommendations")):
        items = review.get(key) or []
        if items:
            st.markdown(f"**{title}**")
            st.markdown("\n".join(f"- {item['text']}" for item in items))

    legal = review.get("legal_candidates") or []
    if legal:
        st.markdown("**Rules that may apply**")
        st.markdown(
            "\n".join(
                f"- **{candidate.get('article') or 'article not given by the legal source'}** · {candidate['rule']}"
                for candidate in legal
            )
        )
        st.caption("Candidates as the legal source cited them, not a legal finding: the clerk decides.")

    unsure = review.get("still_unsure") or []
    if unsure:
        st.markdown("**Still unsure**")
        st.markdown("\n".join(f"- {line}" for line in unsure))


def draw_steps(progress: Progress) -> None:
    """A running review: what it has done so far, and what it is writing."""
    st.caption(
        f"{progress.elapsed:.0f}s in"
        + (f" · legal source {progress.budget['used']} of {progress.budget['limit']} questions"
           if progress.budget and progress.budget.get("limit") else "")
    )
    if progress.timeline:
        st.markdown("\n".join(f"- {html.escape(line[-600:])}" for line in progress.timeline[-12:]),
                    unsafe_allow_html=True)

    if progress.questions:
        st.markdown("**What it is unsure about**")
        for question in progress.questions.values():
            goal = AUDIENCE.get(question.get("goal"), question.get("goal", ""))
            st.markdown(
                ui.chip(question["status"]) + "&nbsp;&nbsp;" + html.escape(question["question"])
                + f' <span style="color:#757575;font-size:.8rem;">· {html.escape(goal)}</span>',
                unsafe_allow_html=True,
            )

    if progress.text:
        st.markdown(ui.unescape(progress.text))

    if progress.writing and progress.review is None:
        st.markdown("**Writing the review**")
        st.markdown("\n\n".join(ui.unescape(text) for text in progress.writing.values()))


def totals(progress: Progress) -> str:
    """The run's totals, one line: model calls, legal turns, cost, tokens."""
    done = progress.done or {}
    usage = done.get("tokens") or {}
    model = done.get("model") or progress.model or ""
    fallbacks = sorted({t["model"] for t in progress.turns if t.get("model") and t["model"] != model})
    parts = [
        model + (f" (fell back to {', '.join(fallbacks)})" if fallbacks else ""),
        f"{done.get('model_calls', 0)} model calls",
        f"{done.get('rag_turns', 0)} legal turns",
        f"${done['cost_usd']}" if done.get("cost_usd") is not None else "",
        f"{usage.get('input', 0) + usage.get('output', 0):,} tokens" if usage else "",
        f"{progress.elapsed:.0f}s",
    ]
    return " · ".join(p for p in parts if p)


def debug(progress: Progress, name: str) -> None:
    """The prototype's debug view: citations by legal turn, what each point rests on, the
    process, and all three as a Markdown file. For the developers, never the clerk."""
    events = progress.events
    review = trace.review_of(events)
    tracking = trace.facts_of(events)
    st.markdown("**Debug** · for developers, not the clerk")
    if progress.done:
        st.caption(totals(progress))
        for finding in progress.done.get("findings") or []:
            st.caption(f"finding: {finding}")
    with st.expander("Citations: articles per legal turn", expanded=True):
        st.markdown(trace.articles_table(review, events))
    if review and tracking is not None:
        with st.expander("What each point rests on"):
            st.markdown(trace.points(review, tracking, events))
    with st.expander("Process: thinking, open questions, legal turns"):
        st.markdown(trace.process(events))
    st.download_button(
        "Download debug trace (Markdown)",
        trace.report(name, events),
        file_name=f"{name}-debug.md",
        mime="text/markdown",
    )


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
                    draw_steps(progress)
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
