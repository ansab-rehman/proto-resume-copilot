import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from app.config import Settings
from app.llm import CheckError, LLMError, OpenAICompatClient, strip_fences, structured

from .fakes import FakeLLMClient


class Out(BaseModel):
    n: int


def test_valid_first_try():
    llm = FakeLLMClient({"n": 1})
    assert structured(llm, "sys", "user", Out).n == 1
    assert len(llm.calls) == 1
    assert "JSON Schema" in llm.calls[0][0]["content"]


def test_fenced_output_accepted():
    llm = FakeLLMClient('```json\n{"n": 2}\n```')
    assert structured(llm, "s", "u", Out).n == 2


def test_validation_failure_retries_once_with_error():
    llm = FakeLLMClient("not json", {"n": 3})
    assert structured(llm, "s", "u", Out).n == 3
    assert len(llm.calls) == 2
    assert "invalid" in llm.calls[1][-1]["content"]
    assert llm.calls[1][-2] == {"role": "assistant", "content": "not json"}


def test_two_failures_raise():
    llm = FakeLLMClient("nope")
    with pytest.raises(LLMError, match="malformed"):
        structured(llm, "s", "u", Out)
    assert len(llm.calls) == 2


def test_check_failure_retries_then_uses_user_message():
    def check(o):
        if o.n < 10:
            raise CheckError(f"n={o.n} too small", "Too small. Retry.")

    llm = FakeLLMClient({"n": 1}, {"n": 11})
    assert structured(llm, "s", "u", Out, check).n == 11
    assert "n=1 too small" in llm.calls[1][-1]["content"]

    llm = FakeLLMClient({"n": 1})
    with pytest.raises(LLMError, match="Too small"):
        structured(llm, "s", "u", Out, check)
    assert len(llm.calls) == 2


def test_strip_fences():
    assert strip_fences('```\n{"a":1}\n```') == '{"a":1}'
    assert strip_fences(' {"a":1} ') == '{"a":1}'


@pytest.mark.parametrize("fmt", ["json_object", "json_schema"])
def test_openai_client_passes_configured_format(fmt):
    s = Settings(
        llm_api_key="k", llm_response_format=fmt, llm_extra_body={"thinking": {"type": "disabled"}}
    )
    client = OpenAICompatClient(s)
    seen = {}

    def create(**kwargs):
        seen.update(kwargs)
        msg = SimpleNamespace(content=json.dumps({"n": 5}))
        return SimpleNamespace(
            model="m", choices=[SimpleNamespace(message=msg, finish_reason="stop")]
        )

    client._client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    assert structured(client, "s", "u", Out).n == 5
    assert seen["response_format"]["type"] == fmt
    assert seen["temperature"] == 0
    assert seen["extra_body"] == {"thinking": {"type": "disabled"}}
    if fmt == "json_schema":
        assert seen["response_format"]["json_schema"]["schema"]["properties"]["n"]


def test_extra_body_parsed_from_env_string():
    assert Settings(llm_extra_body='{"a": 1}').llm_extra_body == {"a": 1}
    assert Settings(llm_extra_body="").llm_extra_body == {}
