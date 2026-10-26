"""应用配置：仓库根 .env（不入库），见 .env.example。"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# 仓库根 .env（包位于 backend/src/clew/，故向上 3 层；符合 AGENTS.md 配置规范）
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
    # M4：OpenAI 兼容 LLM（仓库根 .env 注入；默认空表示未配置，/ai/chat 返回 503）。
    # API Key 允许为空，便于连接无需鉴权的本地 OpenAI 兼容服务。
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    # M5：embedding（语义血缘建议）。OpenAI / 阿里云 DashScope 兼容模式均可，
    # 经 LangChain OpenAIEmbeddings 的 base_url 切换；默认空 = 语义层降级为纯启发式。
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    # 08 号 R10：对话上下文 token 预算（粗略估算，超出整块修剪最旧轮次）
    llm_context_token_budget: int = 96_000


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
