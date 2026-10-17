import hashlib
import time

import pysbd
import textstat
from pydantic import ValidationError

from app.cache import ResponseCache
from app.llm.base import LLMOutputError, LLMProvider
from app.logging_utils import logger, text_fingerprint
from app.prompts import PROMPT_VERSION, build_system_prompt, build_user_content
from app.schemas import (
    LLMOutput,
    OriginalSentence,
    Readability,
    SimplifyResponse,
    normalise_whitespace,
)
from app.validation import check_coverage, check_glossary, check_numbers, check_source_ids


def segment(text: str) -> list[OriginalSentence]:
    """Splits normalised text into sentences numbered from 1."""
    segmenter = pysbd.Segmenter(language="en", clean=False)
    parts = [s.strip() for s in segmenter.segment(text)]
    return [OriginalSentence(id=i, text=s) for i, s in enumerate((p for p in parts if p), 1)]


def cache_key(normalised_text: str, level: int, model: str) -> str:
    raw = "\x1f".join([normalised_text, str(level), PROMPT_VERSION, model])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def fk_grade(text: str) -> float:
    return round(float(textstat.flesch_kincaid_grade(text)), 1) if text.strip() else 0.0


class SimplifyService:
    def __init__(self, provider: LLMProvider, cache: ResponseCache, model: str) -> None:
        self._provider = provider
        self._cache = cache
        self._model = model

    def simplify(self, text: str, level: int) -> SimplifyResponse:
        started = time.perf_counter()
        normalised = normalise_whitespace(text)
        key = cache_key(normalised, level, self._model)

        hit = self._cache.get(key)
        if hit is not None:
            response = SimplifyResponse.model_validate_json(hit).model_copy(update={"cached": True})
            self._log(normalised, level, response, started)
            return response

        original = segment(normalised)
        output = self._generate(
            build_system_prompt(level),
            build_user_content([(s.id, s.text) for s in original]),
        )

        simplified, warnings = check_source_ids(output.simplified, {s.id for s in original})
        warnings += check_coverage(simplified, [s.id for s in original])
        glossary, _ = check_glossary(output.glossary, normalised)
        simplified_text = " ".join(s.text for s in simplified)
        warnings += check_numbers(normalised, simplified_text)

        response = SimplifyResponse(
            original=original,
            simplified=simplified,
            tldr=output.tldr.strip(),
            glossary=glossary,
            readability=Readability(before=fk_grade(normalised), after=fk_grade(simplified_text)),
            cached=False,
            warnings=warnings,
        )
        self._cache.put(key, response.model_dump_json())
        self._log(normalised, level, response, started)
        return response

    def _generate(self, system: str, user: str) -> LLMOutput:
        """Parse/validation failures are retried once; provider errors are not."""
        for attempt in (1, 2):
            try:
                return self._provider.generate_json(system, user, LLMOutput)
            except (ValidationError, LLMOutputError):
                # Never log the exception text: it can contain the model's rewrite of user text.
                logger.warning("llm output invalid attempt=%d", attempt)
        raise LLMOutputError("The AI returned an invalid response twice.")

    @staticmethod
    def _log(text: str, level: int, response: SimplifyResponse, started: float) -> None:
        logger.info(
            "simplify %s level=%d sentences=%d cached=%s warnings=%d ms=%d",
            text_fingerprint(text),
            level,
            len(response.original),
            response.cached,
            len(response.warnings),
            (time.perf_counter() - started) * 1000,
        )
