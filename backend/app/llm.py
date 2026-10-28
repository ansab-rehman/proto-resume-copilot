"""Minimal LLM client: one OpenAI-compatible implementation behind a small protocol."""

import json
import logging
import re
import time
from collections.abc import Callable
from typing import Protocol, TypeVar

import openai
from pydantic import BaseModel, ValidationError

from .config import Settings, get_settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """User-presentable failure (message is safe to show)."""


class CheckError(ValueError):
    """Raised by a `check` hook. `detail` goes back to the model; `user_message` to the user."""

    def __init__(self, detail: str, user_message: str):
        super().__init__(detail)
        self.user_message = user_message


class LLMClient(Protocol):
    model_id: str

    def complete(self, messages: list[dict], schema: type[BaseModel]) -> str: ...


class OpenAICompatClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model_id = settings.llm_model
        self._client = openai.OpenAI(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
            timeout=settings.llm_timeout_s,
            max_retries=2,
        )

    def _response_format(self, schema: type[BaseModel]) -> dict:
        if self.settings.llm_response_format == "json_schema":
            return {
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()},
            }
        return {"type": "json_object"}

    def complete(self, messages: list[dict], schema: type[BaseModel]) -> str:
        start = time.monotonic()
        try:
            resp = self._client.chat.completions.create(
                model=self.model_id,
                messages=messages,
                temperature=0,
                max_tokens=self.settings.llm_max_tokens,
                response_format=self._response_format(schema),
                extra_body=self.settings.llm_extra_body or None,
            )
        except openai.APIError as e:
            log.warning("llm call failed model=%s error=%s", self.model_id, type(e).__name__)
            raise LLMError(f"LLM request failed ({type(e).__name__}). Retry.") from e
        choice = resp.choices[0]
        log.info(
            "llm call model=%s latency_ms=%d finish=%s",
            self.model_id,
            (time.monotonic() - start) * 1000,
            choice.finish_reason,
        )
        return choice.message.content or ""


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


def strip_fences(raw: str) -> str:
    m = _FENCE.match(raw)
    return m.group(1) if m else raw.strip()


def structured(
    llm: LLMClient,
    system: str,
    user: str,
    schema: type[T],
    check: Callable[[T], None] | None = None,
) -> T:
    """Call the model and validate against `schema` (+ `check`); one corrective retry."""
    system = (
        f"{system}\n\nRespond with one JSON object only, no prose, matching this JSON Schema:\n"
        f"{json.dumps(schema.model_json_schema())}"
    )
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for attempt in (1, 2):
        raw = llm.complete(messages, schema)
        try:
            obj = schema.model_validate_json(strip_fences(raw))
            if check:
                check(obj)
            return obj
        except ValueError as e:  # includes pydantic ValidationError
            log.info("llm output rejected attempt=%d kind=%s", attempt, type(e).__name__)
            if attempt == 2:
                if isinstance(e, CheckError):
                    raise LLMError(e.user_message) from e
                raise LLMError("The model returned malformed output twice. Retry.") from e
            detail = _short_error(e)
            messages += [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": f"Your previous response was invalid: {detail}\n"
                    "Return the complete corrected JSON object only.",
                },
            ]
    raise AssertionError("unreachable")


def _short_error(e: ValueError) -> str:
    if isinstance(e, ValidationError):
        return "; ".join(
            f"{'.'.join(map(str, err['loc'])) or '(root)'}: {err['msg']}" for err in e.errors()[:10]
        )
    return str(e)[:1000]


def get_llm() -> LLMClient:
    settings = get_settings()
    if not settings.llm_configured:
        raise LLMError("LLM not configured. Set LLM_API_KEY in .env and restart.")
    return OpenAICompatClient(settings)
