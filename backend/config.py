"""
CivicLens Backend — Configuration
Loads environment variables via pydantic-settings.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # Gemini (Phase 3)
    gemini_api_key: str = ""

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # AI confidence threshold (FR-AI2: below this → Low-Confidence queue)
    ai_confidence_threshold: float = 0.6

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
