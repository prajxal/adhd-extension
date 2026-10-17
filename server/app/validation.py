"""Cheap guards against hallucination. Each function is pure and returns (result, warnings)."""

import re

from app.schemas import GlossaryEntry, SimplifiedSentence

MAX_GLOSSARY = 5
NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?%?")
# Reference markers copied with page text, e.g. Wikipedia's [1], [12-14], [a], [note 3].
CITATION_RE = re.compile(
    r"\[(?:\d+(?:\s*[-\u2013,]\s*\d+)*|[a-z]|(?:note|nb)\s*\d+|citation needed)\]",
    re.IGNORECASE,
)


def numbers_in(text: str) -> list[str]:
    """Numbers in the text, ignoring citation markers."""
    return NUMBER_RE.findall(CITATION_RE.sub(" ", text))


def check_source_ids(
    simplified: list[SimplifiedSentence], valid_ids: set[int]
) -> tuple[list[SimplifiedSentence], list[str]]:
    """Drops unknown sourceIds; drops sentences left with none."""
    kept: list[SimplifiedSentence] = []
    dropped = 0
    for sentence in simplified:
        ids = list(dict.fromkeys(i for i in sentence.sourceIds if i in valid_ids))
        if ids:
            kept.append(SimplifiedSentence(text=sentence.text, sourceIds=ids))
        else:
            dropped += 1
    warnings = []
    if dropped:
        noun = "sentence" if dropped == 1 else "sentences"
        warnings.append(
            f"Removed {dropped} simplified {noun} that couldn't be matched to the original."
        )
    return kept, warnings


def check_coverage(simplified: list[SimplifiedSentence], original_ids: list[int]) -> list[str]:
    covered = {i for s in simplified for i in s.sourceIds}
    missing = [i for i in original_ids if i not in covered]
    if not missing:
        return []
    ids = ", ".join(str(i) for i in missing)
    return [f"Some details may be missing (original sentences not covered: {ids})."]


def check_glossary(
    glossary: list[GlossaryEntry], original_text: str
) -> tuple[list[GlossaryEntry], list[str]]:
    """Keeps only terms that appear in the original (case-insensitive), deduped, max 5."""
    haystack = original_text.casefold()
    kept: list[GlossaryEntry] = []
    seen: set[str] = set()
    for entry in glossary:
        term = entry.term.strip()
        key = term.casefold()
        if not term or key in seen or key not in haystack:
            continue
        seen.add(key)
        kept.append(GlossaryEntry(term=term, definition=entry.definition.strip()))
    return kept[:MAX_GLOSSARY], []


def _contains_number(text: str, number: str) -> bool:
    # Match the whole number only: "5" must not match inside "15" or "5.5".
    pattern = rf"(?<![\d.,]){re.escape(number)}(?!\d|[.,]\d)"
    return re.search(pattern, text) is not None


def check_numbers(original_text: str, simplified_text: str) -> list[str]:
    numbers = list(dict.fromkeys(numbers_in(original_text)))
    return [
        f'A number from the original may be missing: "{n}".'
        for n in numbers
        if not _contains_number(simplified_text, n)
    ]
