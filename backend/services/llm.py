"""Configurable LLM provider for clip analysis.

Backends: anthropic | openai | groq
Groq is OpenAI-compatible — same SDK, different base_url + key.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod

from config import settings


def _extract_content(content: str, reasoning_fallback: str | None = None) -> str:
    """Normalise output from reasoning models.

    Qwen/Groq reasoning models wrap their chain-of-thought in <think>…</think>
    before the real answer; strip that block so the caller sees only the final
    output. For openai/gpt-oss-* the content field is empty and the answer
    lands in the SDK's `reasoning` attribute — use that as a fallback.
    """
    if content:
        # Strip <think>…</think> blocks (may span multiple lines)
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
    if not content and reasoning_fallback:
        content = reasoning_fallback.strip()
    return content


class LLMProvider(ABC):
    @abstractmethod
    def complete(self, system: str, user: str) -> str:
        """Return the assistant's text response."""


class AnthropicProvider(LLMProvider):
    def __init__(self):
        import anthropic
        self._client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        self._model = settings.LLM_MODEL_ANTHROPIC

    def complete(self, system: str, user: str) -> str:
        msg = self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text


class OpenAIProvider(LLMProvider):
    # gpt-5* / o-series reject max_tokens. Omit the cap entirely so reasoning
    # models can use the model's full output budget (a low max_completion_tokens
    # often gets spent on reasoning and leaves content empty). Groq still needs
    # an explicit max_tokens.
    _max_tokens_param: str | None = None
    _max_tokens: int | None = None

    def __init__(self, base_url: str | None = None, api_key: str | None = None, model: str | None = None):
        from openai import OpenAI
        kwargs: dict = {"api_key": api_key or settings.OPENAI_API_KEY}
        if base_url:
            kwargs["base_url"] = base_url
        self._client = OpenAI(**kwargs)
        self._model = model or settings.LLM_MODEL_OPENAI

    def complete(self, system: str, user: str) -> str:
        create_kwargs: dict = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if self._max_tokens_param and self._max_tokens is not None:
            create_kwargs[self._max_tokens_param] = self._max_tokens
        resp = self._client.chat.completions.create(**create_kwargs)
        msg = resp.choices[0].message
        reasoning = getattr(msg, "reasoning", None)
        return _extract_content(msg.content or "", reasoning)


class GroqProvider(OpenAIProvider):
    _max_tokens_param = "max_tokens"
    _max_tokens = 16384

    def __init__(self):
        super().__init__(
            base_url="https://api.groq.com/openai/v1",
            api_key=settings.GROQ_API_KEY,
            model=settings.LLM_MODEL_GROQ,
        )


def get_llm() -> LLMProvider:
    provider = (settings.LLM_PROVIDER or "anthropic").lower()
    if provider == "anthropic":
        return AnthropicProvider()
    if provider == "groq":
        return GroqProvider()
    return OpenAIProvider()
