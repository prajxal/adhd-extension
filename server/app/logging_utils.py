import hashlib
import logging

logger = logging.getLogger("readwell")


def text_fingerprint(text: str) -> str:
    """What we log instead of user text: its length and a short hash."""
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
    return f"len={len(text)} sha={digest}"
