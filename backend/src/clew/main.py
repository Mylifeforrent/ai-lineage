"""应用入口：路由装配、启动初始化（建库 + 初始管理员种子）。"""

import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import get_db, init_db
from .routes import (ai, annotations, auth, changes, datasets, edges, fields,
                     files, imports, lineage, preview, version_tags)
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
    app = FastAPI(title="Clew", version="0.1.0",
                  description="字段级 AI 数据血缘工具（M4：AI 对话与血缘建议）",
                  lifespan=lifespan)
    # M2：前端已接入，跨域来源由 CORS_ORIGINS 显式配置；认证走 Bearer
    # 而非 Cookie，无需 allow_credentials（避免通配来源下的凭证回显）。
    origins = [origin.strip() for origin in get_settings().cors_origins.split(",")
               if origin.strip()]
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_credentials=False,
        allow_methods=["*"], allow_headers=["*"])
    app.include_router(auth.router)
    app.include_router(files.router)
    app.include_router(imports.router)
    app.include_router(datasets.router)
    app.include_router(lineage.router)
    app.include_router(preview.router)
    # M3
    app.include_router(annotations.router)
    app.include_router(fields.router)
    app.include_router(edges.router)
    app.include_router(changes.router)
    app.include_router(version_tags.router)
    # M4
    app.include_router(ai.router)
    return app


app = create_app()
