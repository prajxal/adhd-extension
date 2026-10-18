from pathlib import Path

from app.cache import ResponseCache
from app.logging_utils import text_fingerprint
from app.pipeline import cache_key, segment
from app.ratelimit import RateLimiter
from app.schemas import GlossaryEntry, SimplifiedSentence
from app.validation import check_coverage, check_glossary, check_numbers, check_source_ids


def test_segment_numbers_sentences_from_one() -> None:
    sentences = segment("Dr. Smith arrived at 3 p.m. today. He left early. Why?")
    assert [s.id for s in sentences] == [1, 2, 3]
    assert sentences[0].text == "Dr. Smith arrived at 3 p.m. today."


def test_cache_key_changes_with_every_input() -> None:
    base = cache_key("some text", 2, "model-a")
    assert base == cache_key("some text", 2, "model-a")
    assert base != cache_key("some text", 3, "model-a")
    assert base != cache_key("some text", 2, "model-b")
    assert base != cache_key("other text", 2, "model-a")


def test_source_ids_dedupes_and_drops_empty() -> None:
    kept, warnings = check_source_ids(
        [
            SimplifiedSentence(text="a", sourceIds=[2, 2, 1]),
            SimplifiedSentence(text="b", sourceIds=[7]),
        ],
        {1, 2},
    )
    assert [s.sourceIds for s in kept] == [[2, 1]]
    assert len(warnings) == 1


def test_coverage_lists_every_uncovered_id() -> None:
    warnings = check_coverage([SimplifiedSentence(text="a", sourceIds=[2])], [1, 2, 3, 4])
    assert warnings == ["Some details may be missing (original sentences not covered: 1, 3, 4)."]


def test_glossary_dedupes_case_insensitively() -> None:
    kept, _ = check_glossary(
        [GlossaryEntry(term="Vote", definition="d"), GlossaryEntry(term="vote", definition="d")],
        "The vote was held.",
    )
    assert [g.term for g in kept] == ["Vote"]


def test_numbers_match_whole_numbers_only() -> None:
    assert check_numbers("Only 5 people came.", "Only 15 people came.") != []
    assert check_numbers("It costs 5 dollars.", "It costs 5.5 dollars.") != []
    assert check_numbers("It is 4.5% higher.", "It is 4.5% more.") == []
    assert check_numbers("Grew 20%.", "Grew by 20.") == [
        'A number from the original may be missing: "20%".'
    ]
    assert check_numbers("In 1,200 cases.", "In 1,200 cases.") == []
    assert check_numbers("No numbers here.", "None.") == []


def test_numbers_ignore_citation_markers() -> None:
    original = "ADHD[1] affects about 5% of children.[12\u201314][a][note 3][citation needed]"
    assert check_numbers(original, "ADHD affects about 5% of children.") == []
    assert check_numbers("Costs rose [3] by 7%.", "Costs rose.") == [
        'A number from the original may be missing: "7%".'
    ]


def test_percent_written_as_a_word_counts_as_the_number() -> None:
    assert check_numbers("Turnout fell by 12.5%.", "Turnout fell by 12.5 percent.") == []
    assert check_numbers("Costs rose 7 per cent.", "Costs rose by 7%.") == []
    assert check_numbers("Turnout fell by 12.5%.", "Turnout fell by 12.5 points.") != []


def test_rate_limiter_window_slides() -> None:
    now = [0.0]
    limiter = RateLimiter(limit=2, window_s=60, clock=lambda: now[0])
    assert limiter.allow("ip") and limiter.allow("ip")
    assert not limiter.allow("ip")
    assert limiter.allow("other-ip")
    now[0] = 60.0
    assert limiter.allow("ip")


def test_cache_round_trip(tmp_path: Path) -> None:
    cache = ResponseCache(str(tmp_path / "c.sqlite3"))
    assert cache.get("k") is None
    cache.put("k", '{"a": 1}')
    cache.put("k", '{"a": 2}')
    assert cache.get("k") == '{"a": 2}'


def test_fingerprint_hides_text() -> None:
    fp = text_fingerprint("private words")
    assert "private" not in fp
    assert fp.startswith("len=13 sha=")
