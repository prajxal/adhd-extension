"""Each validation step, end to end through /simplify with FakeProvider."""

from tests.conftest import GOOD, TEXT, MakeClient, with_


def test_happy_path_has_no_warnings(make_client: MakeClient) -> None:
    client, _ = make_client()
    body = client.post("/simplify", json={"text": TEXT, "level": 2}).json()
    assert [s["id"] for s in body["original"]] == [1, 2, 3]
    assert body["warnings"] == []
    assert body["cached"] is False
    assert body["glossary"] == GOOD["glossary"]
    assert body["readability"]["before"] > body["readability"]["after"]


def test_bad_source_ids_are_dropped(make_client: MakeClient) -> None:
    simplified = [
        {"text": "The group moved the vote to March 2025.", "sourceIds": [1, 99]},
        {"text": "12.5% fewer people voted than the year before.", "sourceIds": [2]},
        {"text": "Something the model made up.", "sourceIds": [42]},
        {"text": "Officials did not say why.", "sourceIds": [3, 0, -1]},
    ]
    client, _ = make_client([with_(simplified=simplified)])
    body = client.post("/simplify", json={"text": TEXT}).json()

    valid = {s["id"] for s in body["original"]}
    assert all(set(s["sourceIds"]) <= valid for s in body["simplified"])
    assert [s["sourceIds"] for s in body["simplified"]] == [[1], [2], [3]]
    assert "Something the model made up." not in [s["text"] for s in body["simplified"]]
    assert any("couldn't be matched" in w for w in body["warnings"])


def test_uncovered_sentences_are_flagged(make_client: MakeClient) -> None:
    client, _ = make_client([with_(simplified=GOOD["simplified"][:2])])
    body = client.post("/simplify", json={"text": TEXT}).json()
    assert body["warnings"] == ["Some details may be missing (original sentences not covered: 3)."]


def test_made_up_glossary_terms_are_dropped(make_client: MakeClient) -> None:
    glossary = [
        {"term": "photosynthesis", "definition": "not in the text"},
        {"term": "COMMITTEE", "definition": "a group chosen to decide things"},
        {"term": "postponed", "definition": "moved to a later time"},
        {"term": "Turnout", "definition": "how many people voted"},
        {"term": "officials", "definition": "people with official jobs"},
        {"term": "previous", "definition": "the one before"},
        {"term": "reason", "definition": "why something happened"},
    ]
    client, _ = make_client([with_(glossary=glossary)])
    body = client.post("/simplify", json={"text": TEXT}).json()

    terms = [g["term"] for g in body["glossary"]]
    assert "photosynthesis" not in terms
    assert "COMMITTEE" in terms  # case-insensitive match
    assert len(terms) == 5  # capped
    assert all(t.casefold() in TEXT.casefold() for t in terms)


def test_missing_numbers_are_flagged(make_client: MakeClient) -> None:
    simplified = [
        {"text": "The group moved the vote to March.", "sourceIds": [1]},
        {"text": "Fewer people voted, about 2.5% fewer.", "sourceIds": [2]},
        {"text": "Officials did not say why.", "sourceIds": [3]},
    ]
    client, _ = make_client([with_(simplified=simplified)])
    body = client.post("/simplify", json={"text": TEXT}).json()
    assert body["warnings"] == [
        'A number from the original may be missing: "2025".',
        'A number from the original may be missing: "12.5%".',
    ]
