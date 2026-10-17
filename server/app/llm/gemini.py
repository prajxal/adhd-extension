from google import genai
from google.genai import errors, types

from app.llm.base import LLMOutputError, LLMProviderError, T

TIMEOUT_MS = 60_000


class GeminiProvider:
    def __init__(self, api_key: str, model: str) -> None:
        self._model = model
        self._client = genai.Client(
            api_key=api_key, http_options=types.HttpOptions(timeout=TIMEOUT_MS)
        )

    def generate_json(self, system: str, user: str, schema: type[T]) -> T:
        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=0.2,
                ),
            )
        except errors.APIError as exc:
            # Only the status code: provider messages can echo request content.
            raise LLMProviderError(f"Gemini API error (status {exc.code})") from None
        except Exception as exc:  # network failures, timeouts
            raise LLMProviderError(f"Gemini request failed ({type(exc).__name__})") from None

        text = response.text
        if not text:
            raise LLMOutputError("empty response")
        return schema.model_validate_json(text)
