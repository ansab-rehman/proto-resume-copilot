import json
from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Read .env from the repo root (when run from backend/) or the CWD.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    llm_base_url: str = "https://api.z.ai/api/paas/v4/"
    llm_api_key: str = ""
    llm_model: str = "glm-4.6"
    llm_extra_body: dict = {}
    llm_response_format: Literal["json_object", "json_schema"] = "json_object"
    llm_timeout_s: float = 180.0

    max_upload_mb: float = 5
    database_url: str = "sqlite:///./copilot.db"

    @field_validator("llm_extra_body", mode="before")
    @classmethod
    def _parse_extra_body(cls, v):
        if isinstance(v, str):
            return json.loads(v) if v.strip() else {}
        return v

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
