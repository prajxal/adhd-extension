import json
import re
from typing import Any

from app.llm.base import T
from app.meaning.judge import JudgeOutput

SENTENCE_LINE = re.compile(r"^\[(\d+)\] (.*)$")
SIMPLIFIED_LINE = re.compile(r"^\((\d+)\) ")


class FakeProvider:
    """
    Returns canned responses, in order (the last one repeats).
    Each item can be a dict, a JSON string, or an Exception to raise.
    With no canned responses it echoes each numbered sentence back (and the judge
    calls everything faithful), so the server runs end to end without an API key.
    """

    def __init__(self, responses: list[Any] | None = None) -> None:
        self._responses = list(responses or [])
        self.calls: list[tuple[str, str]] = []

    def generate_json(self, system: str, user: str, schema: type[T]) -> T:
        self.calls.append((system, user))
        if not self._responses:
            if schema is JudgeOutput:
                return schema.model_validate(self._all_faithful(user))
            return schema.model_validate(self._echo(user))
        index = min(len(self.calls), len(self._responses)) - 1
        item = self._responses[index]
        if isinstance(item, Exception):
            raise item
        raw = item if isinstance(item, str) else json.dumps(item)
        return schema.model_validate_json(raw)

    @staticmethod
    def _echo(user: str) -> dict[str, Any]:
        sentences = [m.groups() for line in user.splitlines() if (m := SENTENCE_LINE.match(line))]
        return {
            "simplified": [{"text": text, "sourceIds": [int(sid)]} for sid, text in sentences],
            "tldr": sentences[0][1] if sentences else "",
            "glossary": [],
        }

    @staticmethod
    def _all_faithful(user: str) -> dict[str, Any]:
        indexes = [
            int(m.group(1)) for line in user.splitlines() if (m := SIMPLIFIED_LINE.match(line))
        ]
        return {"sentences": [{"index": i, "label": "faithful"} for i in indexes], "omissions": []}
