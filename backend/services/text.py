import re


def preprocess_text(body: str, context_label: str = "", title: str = "", max_words: int = 1200) -> str:
    """Clean pasted story text for TTS: strip markdown, normalize whitespace,
    optionally prepend context, truncate to max_words."""
    # Strip markdown links [text](url) → text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', body)
    # Strip bold/italic
    text = re.sub(r'\*{1,2}([^\*]+)\*{1,2}', r'\1', text)
    # Strip blockquote markers
    text = re.sub(r'^>\s?', '', text, flags=re.MULTILINE)
    # Strip strikethrough
    text = re.sub(r'~~([^~]+)~~', r'\1', text)
    # Collapse multiple newlines
    text = re.sub(r'\n{3,}', '\n\n', text).strip()

    parts = []
    if title:
        parts.append(title.rstrip("."))
    if context_label:
        parts.append(f"Posted in {context_label}")
    if parts:
        full = ". ".join(p for p in parts if p) + ". " + text
    else:
        full = text

    words = full.split()
    if len(words) > max_words:
        full = " ".join(words[:max_words]) + "..."
    return full
