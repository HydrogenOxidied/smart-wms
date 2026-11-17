"""Application configuration loaded from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for PocketWMS API."""

    app_name: str = "PocketWMS API"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./smart_wms.db"
    jwt_secret: str = "CHANGE_ME_LOCAL_DEV_KEY_9f4b2a1c"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720
    auto_seed_demo: bool = True

    model_config = SettingsConfigDict(
        env_prefix="WMS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
