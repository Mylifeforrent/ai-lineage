"""认证与用户管理：登录、当前用户、admin 管理用户。"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import get_db
from ..models import LoginIn, UserCreate, UserOut
from ..security import (create_token, current_user, hash_password, require_role,
                        verify_password)

router = APIRouter(tags=["auth"])


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginIn):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM user WHERE username=?",
                           (body.username,)).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")
    return TokenOut(access_token=create_token(row["username"], row["role"]),
                    username=row["username"], role=row["role"])


@router.get("/auth/me")
def me(user: dict = Depends(current_user)):
    return user


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, admin: dict = Depends(require_role("admin"))):
    with get_db() as conn:
        if conn.execute("SELECT 1 FROM user WHERE username=?",
                        (body.username,)).fetchone():
            raise HTTPException(409, f"用户「{body.username}」已存在")
        conn.execute(
            "INSERT INTO user(username, password_hash, display_name, role, created_at)"
            " VALUES (?,?,?,?,?)",
            (body.username, hash_password(body.password), body.display_name,
             body.role, datetime.now(UTC).isoformat(timespec="seconds")))
    return UserOut(username=body.username, display_name=body.display_name,
                   role=body.role)


@router.get("/users", response_model=list[UserOut])
def list_users(admin: dict = Depends(require_role("admin"))):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT username, display_name, role FROM user ORDER BY id").fetchall()
    return [UserOut(username=r["username"], display_name=r["display_name"],
                    role=r["role"]) for r in rows]
