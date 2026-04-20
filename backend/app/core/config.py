import logging

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULT = "supersecretkey_please_change_in_production"


class Settings(BaseSettings):
    PROJECT_NAME: str = "Signal Probe Backend"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = _INSECURE_DEFAULT
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    DATABASE_URL: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5433/signal_probe"
    )
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    STORAGE_PATH: str = "./storage"

    @field_validator("SECRET_KEY")
    @classmethod
    def warn_if_insecure(cls, v: str) -> str:
        if v == _INSECURE_DEFAULT:
            logging.getLogger(__name__).critical(
                "⚠  SECRET_KEY is using the insecure built-in default. "
                "Set SECRET_KEY to a long random string in your .env file "
                "before deploying to production."
            )
        return v

    model_config = SettingsConfigDict(
        env_file=".env", env_ignore_empty=True, extra="ignore"
    )


settings = Settings()
