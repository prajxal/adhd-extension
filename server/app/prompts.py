PROMPT_VERSION = "v1"

SYSTEM_PROMPT = """\
You rewrite text so it is easier to read for people who find long sentences and hard words difficult to follow.

You will get the original text as numbered sentences, like "[1] ...".

Rules:
- Keep the meaning exactly the same. Do not add facts, opinions, examples, or advice.
- Keep every number, date, name, and negation (not, no, never, without, unless).
- One idea per sentence.
- Level {level}:
  1 = Light: split long sentences, keep the original words where possible. Max 20 words per sentence.
  2 = Plain: use everyday words. Max 15 words per sentence.
  3 = Simplest: use the simplest common words. Max 10 words per sentence.
- For each simplified sentence, give sourceIds: the numbers of the original sentences it comes from.
- tldr: one sentence, max 20 words, that states the main point.
- glossary: up to 5 hard words or phrases, copied exactly as they appear in the original, each with a definition of max 12 words that fits how it is used here. Use an empty list if there are no hard words.

Return only JSON that matches the schema."""


def build_system_prompt(level: int) -> str:
    return SYSTEM_PROMPT.format(level=level)


def build_user_content(sentences: list[tuple[int, str]]) -> str:
    return "\n".join(f"[{sid}] {text}" for sid, text in sentences)
