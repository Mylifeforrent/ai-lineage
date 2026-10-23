"""应用入口：路由装配、启动初始化（建库 + 初始管理员种子）。"""

import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import get_db, init_db
from .routes import auth, datasets, files, imports
from .security import hash_password


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    with get_db() as conn:
        has_user = conn.execute("SELECT 1 FROM user LIMIT 1").fetchone()
    if has_user is None:
        s = get_settings()
        with get_db() as conn:
            conn.execute(
                "INSERT INTO user(username, password_hash, display_name, role, created_at)"
                " VALUES (?,?,?,?,datetime('now'))",
                (s.admin_username, hash_password(s.admin_password),
                 "初始管理员", "admin"))
        print(f"已创建初始管理员「{s.admin_username}」（密码来自 ADMIN_PASSWORD）",
              file=sys.stderr)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="LineageLite", version="0.1.0",
                  description="轻量级 AI 数据血缘工具（M1：数据底座）",
                  lifespan=lifespan)
    # TODO(M2): 前端接入时收紧 allow_origins（当前 * 通配仅为 M1 后端联调临时配置）
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"])
    app.include_router(auth.router)
    app.include_router(files.router)
    app.include_router(imports.router)
    app.include_router(datasets.router)
    return app


app = create_app()
