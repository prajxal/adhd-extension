"""
Rule checks for the meaning check (English only, no LLM).

Each simplified sentence is compared with its own sources (via sourceIds). Rules that
look at a whole source ("was this number dropped?") report on the first simplified
sentence mapped to that source, so the reader sees each issue once.
"""

import re
from dataclasses import dataclass
from typing import Literal

from app.schemas import OriginalSentence, SimplifiedSentence
from app.validation import normalise_numbers, numbers_in

Rule = Literal["number", "negation", "hedge", "name"]
Severity = Literal["problem", "check"]

SEVERITY: dict[Rule, Severity] = {
    "number": "problem",
    "negation": "problem",
    "hedge": "check",
    "name": "check",
}

RIGHT_QUOTE = "\u2019"  # typographic apostrophe, as in "can\u2019t"
WORD_RE = re.compile(rf"[A-Za-z]+(?:['{RIGHT_QUOTE}][A-Za-z]+)?")

NEGATION_WORDS = frozenset(
    [
        "not",
        "no",
        "never",
        "without",
        "unless",
        "none",
        "nobody",
        "nothing",
        "neither",
        "nor",
        "cannot",
    ]
)
# Words that carry a negative meaning without a negation word. Treated as negation on
# either side so faithful rewrites like "refused" → "did not allow" aren't flagged.
IMPLIED_NEGATIVE_RE = re.compile(
    r"^(?:refus|fail|miss|lack|den(?:y|ied|ies)|reject|ban(?:s|ned)?$|prevent|forbid|"
    r"prohibit|insufficient|unable|impossible|absent|avoid|exclud|declin|without|neither|nor)",
)
HEDGE_WORDS = frozenset(
    [
        "may",
        "might",
        "could",
        "can",
        "possibly",
        "probably",
        "likely",
        "unlikely",
        "suggest",
        "suggests",
        "suggested",
        "appear",
        "appears",
        "appeared",
        "approximately",
        "about",
        "around",
        "estimate",
        "estimates",
        "estimated",
        "some",
    ]
)


@dataclass(frozen=True)
class RuleFinding:
    rule: Rule
    severity: Severity
    reason: str


def _words(text: str) -> list[str]:
    return [w.lower().replace(RIGHT_QUOTE, "'") for w in WORD_RE.findall(text)]


def _explicit_negations(text: str) -> list[str]:
    return [w for w in _words(text) if w in NEGATION_WORDS or w.endswith("n't")]


def _has_negative_meaning(text: str) -> bool:
    return bool(_explicit_negations(text)) or any(
        IMPLIED_NEGATIVE_RE.match(w) for w in _words(text)
    )


def _hedges(text: str) -> list[str]:
    return [w for w in _words(text) if w in HEDGE_WORDS]


def _contains_number(text: str, number: str) -> bool:
    # Whole numbers only: "5" must not match inside "15" or "5.5".
    pattern = rf"(?<![\d.,]){re.escape(number)}(?!\d|[.,]\d)"
    return re.search(pattern, normalise_numbers(text)) is not None


def _quote(items: list[str]) -> str:
    return ", ".join(f'"{i}"' for i in dict.fromkeys(items))


def _capitalised_words(sentence: str) -> list[str]:
    words = WORD_RE.findall(sentence)
    # Skip the first word (sentence case) and the pronoun "I".
    return [w for w in words[1:] if w[0].isupper() and w != "I"]


def check_passage(
    original: list[OriginalSentence], simplified: list[SimplifiedSentence]
) -> list[list[RuleFinding]]:
    """Returns rule findings for each simplified sentence (same order and length)."""
    by_id = {s.id: s.text for s in original}
    # Which simplified sentences each source maps to; the first one gets source-level issues.
    mapped: dict[int, list[int]] = {}
    for index, sentence in enumerate(simplified):
        for sid in sentence.sourceIds:
            mapped.setdefault(sid, []).append(index)

    raw: list[dict[str, list[str]]] = [{} for _ in simplified]

    def note(index: int, kind: str, item: str) -> None:
        raw[index].setdefault(kind, []).append(item)

    # Per simplified sentence: compare with its own sources.
    for index, sentence in enumerate(simplified):
        sources = " ".join(by_id[i] for i in sentence.sourceIds if i in by_id)
        for number in numbers_in(sentence.text):
            if not _contains_number(sources, number):
                note(index, "number_new", number)
        added = _explicit_negations(sentence.text)
        if added and not _has_negative_meaning(sources):
            note(index, "negation_added", added[0])
        source_words = {w.lower() for w in WORD_RE.findall(sources)}
        for word in _capitalised_words(sentence.text):
            if word.lower() not in source_words:
                note(index, "name_new", word)

    # Per source: was something dropped across all the sentences it maps to?
    for sid, indexes in mapped.items():
        source = by_id.get(sid)
        if source is None:
            continue
        group = " ".join(simplified[i].text for i in indexes)
        first = indexes[0]
        for number in numbers_in(source):
            if not _contains_number(group, number):
                note(first, "number_dropped", number)
        lost = _explicit_negations(source)
        if lost and not _has_negative_meaning(group):
            note(first, "negation_lost", lost[0])
        hedges = _hedges(source)
        if hedges and not _hedges(group):
            note(first, "hedge_lost", hedges[0])

    return [_to_findings(r) for r in raw]


def _to_findings(raw: dict[str, list[str]]) -> list[RuleFinding]:
    """At most one reason per rule, worded for the reader."""
    findings: list[RuleFinding] = []
    new, dropped = raw.get("number_new", []), raw.get("number_dropped", [])
    if new or dropped:
        parts = []
        if new:
            parts.append(f"{_quote(new)} isn't in the original")
        if dropped:
            parts.append(f"{_quote(dropped)} from the original is missing")
        findings.append(_finding("number", "Number check: " + "; ".join(parts) + "."))
    if raw.get("negation_lost"):
        word = raw["negation_lost"][0]
        findings.append(_finding("negation", f'Negation may be lost (original says "{word}").'))
    elif raw.get("negation_added"):
        word = raw["negation_added"][0]
        findings.append(
            _finding("negation", f'Adds a negation ("{word}") the original doesn\'t have.')
        )
    if raw.get("hedge_lost"):
        word = raw["hedge_lost"][0]
        findings.append(_finding("hedge", f'May sound more certain than the original ("{word}").'))
    if raw.get("name_new"):
        findings.append(_finding("name", f"{_quote(raw['name_new'])} isn't in the original."))
    return findings


def _finding(rule: Rule, reason: str) -> RuleFinding:
    return RuleFinding(rule=rule, severity=SEVERITY[rule], reason=reason)
