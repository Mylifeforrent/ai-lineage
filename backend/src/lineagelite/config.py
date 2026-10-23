"""应用配置：仓库根 .env（不入库），见 .env.example。"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# 仓库根 .env（包位于 backend/src/lineagelite/，故向上 3 层；符合 AGENTS.md 配置规范）
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


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
    # 允许跨域的前端来源（逗号分隔）；默认仅本机 Vite 开发服务器
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


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
