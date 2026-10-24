"""认证与 RBAC：pbkdf2 口令哈希、JWT 签发/校验、FastAPI 角色守卫。"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, Request

from .config import get_settings
from .db import get_db

ROLE_ORDER = {"viewer": 0, "editor": 1, "admin": 2}
PBKDF2_ITERATIONS = 240_000


def hash_password(plain: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", plain.encode(), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def create_token(username: str, role: str) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=s.jwt_expire_hours)).timestamp()),
    }
    return jwt.encode(payload, s.secret_key, algorithm="HS256")


def _bearer_payload(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "缺少 Bearer 凭据")
    try:
        return jwt.decode(
            auth.removeprefix("Bearer "),
            get_settings().secret_key,
            algorithms=["HS256"],
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "凭据无效或已过期") from None


def current_user(request: Request) -> dict:
    payload = _bearer_payload(request)
    return {"username": payload["sub"], "role": payload["role"]}


def require_role(minimum: str):
    """角色守卫依赖：声明当前路由的最低角色（viewer < editor < admin）。

    角色以数据库当前值为准（JWT 中的 role 仅在登录时签发），
    保证管理员变更角色后旧 token 立即按新角色生效。
    """

    def guard(user: dict = Depends(current_user)) -> dict:
        with get_db() as conn:
            row = conn.execute("SELECT role FROM user WHERE username=?",
                               (user["username"],)).fetchone()
        if row is None:
            raise HTTPException(401, "用户不存在或已删除")
        if ROLE_ORDER[row["role"]] < ROLE_ORDER[minimum]:
            raise HTTPException(403, f"需要 {minimum} 及以上角色")
        return {"username": user["username"], "role": row["role"]}

    return guard
