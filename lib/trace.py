"""The debug view of one review: for the developers, never the clerk.

The review prototype's three views, rebuilt from the review's events: the articles each
legal turn named and which of them the review carried into its rules, what every point
of the review rests on, and the run in order. `report` is all of it as one Markdown file.

The prototype's events had other names (rag_question, rag_answer, rag_refused,
model_call, trajectory) and cited a legal turn as `rag_turn`; the backend names them
question, answer, refused, turn and facts, and cites `source: {tool, turn}`. The views
read the backend's events and say what the prototype said.

Events are the API's ReviewEvent dicts: {sequence, elapsed_seconds, type, data}.
"""

from __future__ import annotations

import re

# "Art. 40.4.1", "Article 11, §3, 5°", "Art. 11 §3, 5°", "Articles 12 and 13" (first number only).
ARTICLE = re.compile(r"\bArt(?:icle)?s?\.?\s*\d+(?:\.\d+)*(?:\s*,?\s*§\s*\d+)?(?:\s*,?\s*\d+°)?", re.I)


def articles(text: str) -> list[str]:
    """Article references named in a text, in order, each once."""
    return list(dict.fromkeys(" ".join(m.group(0).split()) for m in ARTICLE.finditer(text or "")))


def article_key(article: str) -> str:
    """The same article however it is written: 'Art. 11, §3, 5°' and 'Article 11 §3, 5°' both give '11§35°'."""
    return re.sub(r"^art(?:icle)?s?\.?|[\s,]", "", article.lower())


def documents(references: list[str]) -> list[str]:
    """The source documents of an answer's reference list, each once: 'WEGCODE147_….pdf'."""
    return list(dict.fromkeys(r.split(" (part:")[0].strip() for r in references or []))


def norm(text: str) -> str:
    return " ".join((text or "").lower().split())


def _data(events: list[dict], kind: str) -> list[dict]:
    return [e.get("data") or {} for e in events if e.get("type") == kind]


def facts_of(events: list[dict]) -> list[dict] | None:
    """The tracking facts the run read, or None when it never read them."""
    found = _data(events, "facts")
    return found[-1].get("facts", []) if found else None


def review_of(events: list[dict]) -> dict | None:
    found = _data(events, "review")
    return found[-1].get("review") if found else None


def answers_of(events: list[dict]) -> dict[tuple[str, int], dict]:
    """Every answered legal turn by (tool, turn), with the goal its question was for."""
    goals = {(q.get("tool"), q.get("turn")): q.get("goal") for q in _data(events, "question")}
    return {
        (a.get("tool"), a.get("turn")): {**a, "goal": a.get("goal") or goals.get((a.get("tool"), a.get("turn")))}
        for a in _data(events, "answer")
        if not a.get("error")
    }


def _turn_name(tool: str | None, turn: int | None, several: bool) -> str:
    # One legal source is the ordinary case, and then its turn number is enough.
    return f"{tool} turn {turn}" if several else f"turn {turn}"


def _several(events: list[dict]) -> bool:
    return len({q.get("tool") for q in _data(events, "question")}) > 1


def quote_block(text: str) -> str:
    return "\n".join("> " + line for line in text.strip().splitlines())


def _tokens(usage: dict) -> str:
    return (f"in {usage.get('input', 0)} / out {usage.get('output', 0)} / "
            f"cache read {usage.get('cache_read', 0)} tokens")


def process(events: list[dict]) -> str:
    """The run in order: thinking, open questions, each legal turn with its articles and documents, the end."""
    out, thinking, updates = [], [], 0
    several = _several(events)

    def flush():
        if thinking:
            out.append(quote_block("Thinking... " + "".join(thinking)))
            thinking.clear()

    for event in events:
        kind, e = event.get("type"), event.get("data") or {}
        if kind == "thinking":
            thinking.append(e.get("text", ""))
            continue
        if kind in ("manifest", "step", "text", "writing", "budget", "replay"):
            continue
        if kind == "status" and e.get("phase") not in ("reading", "replay", "waiting", "fallback"):
            continue
        flush()
        if kind == "status":
            out.append(f"**{e['phase'].capitalize()}** · {e.get('detail', '')}")
        elif kind == "facts":
            groups: dict[str, int] = {}
            for f in e.get("facts", []):
                groups[f["group"]] = groups.get(f["group"], 0) + 1
            out.append("**Tracking facts read** · " + ", ".join(f"{n} {g}" for g, n in groups.items()))
        elif kind == "questions":
            updates += 1
            rows = ["| id | goal | status | question |", "|---|---|---|---|"]
            rows += [f"| {q['id']} | {q['goal']} | {q['status']} | {q['question']} |" for q in e.get("questions", [])]
            out.append(f"**Open questions, update {updates}**\n\n" + "\n".join(rows))
        elif kind == "question":
            name = _turn_name(e.get("tool"), e.get("turn"), several)
            out.append(f"**Legal {name}** ({e.get('goal')}"
                       f"{', for item ' + str(e['for_question']) if e.get('for_question') else ''}"
                       f"{', with picture' if e.get('attach_frame') else ''}) "
                       f"· asked: “{e.get('question', '')}”")
        elif kind == "answer":
            name = _turn_name(e.get("tool"), e.get("turn"), several)
            if e.get("error"):
                out.append(f"**Legal {name} failed** · {e['error']}")
                continue
            named = articles(e.get("answer", ""))
            out.append(f"Answer in {e.get('seconds')} s · articles named: {', '.join(named) if named else 'none'}\n\n"
                       + quote_block(e.get("answer", ""))
                       + "\n\nDocuments retrieved:\n" + "\n".join(f"- {r}" for r in e.get("references") or []))
            if e.get("revised_query"):
                out.append(f"Site's revised query: {e['revised_query']}")
        elif kind == "refused":
            # Only the legal source's own checks hold a question back, and then it is named.
            out.append(f"**Not sent** · {e.get('tool')}: {e.get('reason', '')}\n\n“{e.get('question', '')}”")
        elif kind == "turn":
            tools = f" · tools {', '.join(e['tools'])}" if e.get("tools") else ""
            request = f" · `{e['request_id']}`" if e.get("request_id") else ""
            out.append(f"_model call {e.get('call')} · {e.get('model')} · {e.get('stop_reason')} · {e.get('seconds')} s · "
                       f"{_tokens(e.get('usage') or {})}{tools}{request}_")
        elif kind == "review":
            out.append("**Review submitted**")
        elif kind == "error":
            out.append(f"**Error** · {e.get('message', '')}")
        elif kind == "done":
            cost = f"${e['cost_usd']}" if e.get("cost_usd") is not None else "cost unknown"
            out.append(f"**Done** · {e.get('outcome')} · {e.get('model')} · {e.get('model_calls', 0)} model calls · "
                       f"{e.get('rag_turns', 0)} legal turns · {cost} · {_tokens(e.get('tokens') or {})}"
                       + "".join(f"\n- finding: {f}" for f in e.get("findings") or []))
    flush()
    return "\n\n".join(out)


def points(review: dict, tracking: list[dict], events: list[dict]) -> str:
    """Every point of the review next to the facts, legal passage and articles it rests on."""
    facts = {f["id"]: f for f in tracking}
    answers = answers_of(events)
    several = _several(events)
    blocks = []

    def show(title: str, text: str, item: dict) -> None:
        lines = [f"**{title}** {text}"]
        for fid in item.get("tracking_facts") or []:
            f = facts.get(fid)
            lines.append(f"- `{fid}` {f['group']}: {f['statement']}" if f else f"- `{fid}` no such fact")
        if item.get("picture"):
            lines.append("- picture")
        source = item.get("source") or {}
        key = (source.get("tool"), source.get("turn"))
        name = _turn_name(*key, several) if source else None
        answer = answers.get(key, {}).get("answer", "")
        if source:
            if "quote" in item:
                quote = item["quote"]
                found = bool(quote) and norm(quote) in norm(answer)
                lines.append(f"- legal {name}: " + (f"“{quote}” {'found in the answer' if found else 'not in the answer'}"
                                                     if quote else "no quote"))
            else:
                lines.append(f"- legal {name}")
            named = articles(answer)
            lines.append(f"- articles in {name}: {', '.join(named) if named else 'none named in the answer'}")
        if "article" in item:
            named = {article_key(a) for a in articles(answer)}
            if item["article"]:
                ok = bool(articles(item["article"])) and all(article_key(a) in named for a in articles(item["article"]))
                lines.append(f"- article: “{item['article']}” {'named in ' + name if ok else 'not in that answer'}")
            else:
                lines.append("- article: none given" + (", but the answer names " + ", ".join(articles(answer))
                                                         if key in answers and named else ""))
        if "source_as_cited" in item:
            found = key in answers and norm(item["source_as_cited"]) in norm(answer)
            lines.append(f"- source as cited: “{item['source_as_cited']}” {'found in the answer' if found else 'not in the answer'}")
            if key in answers:
                lines.append(f"- documents behind {name}: " + ", ".join(documents(answers[key].get("references"))))
        if len(lines) == 1:
            lines.append("- rests on nothing")
        blocks.append("\n".join(lines))

    if review.get("flag_check"):
        flag = review["flag_check"]
        show(f"Flag check: {flag['status']}.", flag["seen"], flag)
    advice = review.get("clerk_recommendation") or {"justification": []}
    for n, point in enumerate(advice["justification"], 1):
        show(f"Basis {n}.", point["point"], point)
    for title, key in (("Driver:", "driver_recommendations"), ("Site:", "site_recommendations")):
        for item in review.get(key) or []:
            for point in item.get("justification") or []:
                show(title, f"{item['text']} — {point['point']}", point)
            if not item.get("justification"):
                show(title, item["text"], item)
    for c in review.get("legal_candidates") or []:
        show("Rule:", c["rule"], c)
    return "\n\n".join(blocks)


def articles_table(review: dict | None, events: list[dict]) -> str:
    """Each legal turn: the articles its answer names, and which of them the review carried into its rules."""
    answers = answers_of(events)
    several = _several(events)
    cited = " ".join(f"{c.get('article') or ''} {c['source_as_cited']} {c['rule']}"
                     for c in (review or {}).get("legal_candidates", []))
    kept = {article_key(x) for x in articles(cited)}
    rows = ["| turn | goal | articles named in the answer | carried into the review's rules | documents |",
            "|---|---|---|---|---|"]
    for (tool, turn), a in sorted(answers.items(), key=lambda item: (str(item[0][0]), item[0][1] or 0)):
        named = articles(a.get("answer", ""))
        carried = [x for x in named if article_key(x) in kept]
        label = f"{tool} {turn}" if several else str(turn)
        rows.append(f"| {label} | {a['goal']} | {', '.join(named) or 'none'} | {', '.join(carried) or '—'} | "
                    f"{', '.join(documents(a.get('references')))} |")
    return "\n".join(rows)


def report(name: str, events: list[dict]) -> str:
    """The whole debug view as one Markdown file, to read or share outside the page."""
    review, tracking = review_of(events), facts_of(events)
    parts = [f"# Debug trace · {name}", "## Articles per legal turn", articles_table(review, events),
             "## Process", process(events)]
    if review and tracking is not None:
        parts += ["## What each point rests on", points(review, tracking, events)]
    if tracking:
        parts += ["## Tracking facts", "\n".join(f"- `{f['id']}` {f['group']}: {f['statement']}" for f in tracking)]
    return "\n\n".join(parts) + "\n"
