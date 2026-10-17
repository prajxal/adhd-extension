from typing import Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMOutputError(Exception):
    """The model answered, but not with JSON matching the schema."""


class LLMProviderError(Exception):
    """The provider could not be reached or returned an error."""


class LLMProvider(Protocol):
    def generate_json(self, system: str, user: str, schema: type[T]) -> T: ...
