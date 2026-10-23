"""应用配置：仓库根 .env（不入库），见 .env.example。"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    secret_key: str = "dev-secret-change-me"
    jwt_expire_hours: int = 24
    data_dir: str = "./data"
    admin_username: str = "admin"
    admin_password: str = "admin123"
    max_upload_mb: int = 50  # 单个源文件上传大小上限（MB）


def get_settings() -> Settings:
    return Settings()


def db_path(settings: Settings | None = None) -> Path:
    s = settings or get_settings()
    return Path(s.data_dir) / "lineage.db"


def files_dir(settings: Settings | None = None) -> Path:
    s = settings or get_settings()
    return Path(s.data_dir) / "files"


def resolve_storage(rel_path: str) -> Path:
    """把 source_file.storage_path（相对 data_dir）解析为绝对路径。"""
    return Path(get_settings().data_dir) / rel_path
