from typing import Literal

from pydantic import BaseModel, Field, field_validator

MIN_TEXT_CHARS = 20
MAX_TEXT_CHARS = 3000


def normalise_whitespace(text: str) -> str:
    return " ".join(text.split())


class SimplifyRequest(BaseModel):
    text: str
    level: Literal[1, 2, 3] = 2

    @field_validator("text")
    @classmethod
    def _length(cls, value: str) -> str:
        n = len(normalise_whitespace(value))
        if n < MIN_TEXT_CHARS or n > MAX_TEXT_CHARS:
            raise ValueError(f"text must be {MIN_TEXT_CHARS}-{MAX_TEXT_CHARS} characters")
        return value


class OriginalSentence(BaseModel):
    id: int
    text: str


class SimplifiedSentence(BaseModel):
    text: str
    sourceIds: list[int]  # camelCase on the wire, matching the spec


class GlossaryEntry(BaseModel):
    term: str
    definition: str


class Readability(BaseModel):
    before: float
    after: float


class LLMOutput(BaseModel):
    """The JSON shape we ask the LLM to return."""

    simplified: list[SimplifiedSentence]
    tldr: str
    glossary: list[GlossaryEntry] = Field(default_factory=list)


class SimplifyResponse(BaseModel):
    original: list[OriginalSentence]
    simplified: list[SimplifiedSentence]
    tldr: str
    glossary: list[GlossaryEntry]
    readability: Readability
    cached: bool
    warnings: list[str]


Status = Literal["ok", "check", "problem"]


class Repair(BaseModel):
    """An accepted auto-repair. The sentence's status/reasons describe `text`."""

    text: str
    previous: str
    fixed: list[str]


class CheckSentence(BaseModel):
    index: int
    status: Status
    reasons: list[str]
    repair: Repair | None = None


class CheckSummary(BaseModel):
    ok: int
    check: int
    problem: int
    repaired: int = 0


class CheckResponse(BaseModel):
    sentences: list[CheckSentence]
    summary: CheckSummary
    judge: Literal["llm", "rules"]
    cached: bool
