from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Signal Probe Backend"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "supersecretkey_please_change_in_production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    DATABASE_URL: str = (
        "postgresql+asyncpg://postgres:postgres@localhost:5432/signal_probe"
    )
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    STORAGE_PATH: str = "./storage"

    model_config = SettingsConfigDict(
        env_file=".env", env_ignore_empty=True, extra="ignore"
    )


settings = Settings()
