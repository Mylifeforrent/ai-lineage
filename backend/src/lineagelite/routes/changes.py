"""变更历史查询 API（M3，viewer+）。

``GET /changes`` 按实体过滤、id 倒序返回 change_log；before/after 解析为 JSON 对象。
"""

import json
from typing import Literal

from fastapi import APIRouter, Depends, Query

from ..db import get_db
from ..security import require_role

router = APIRouter(tags=["changes"])


@router.get("/changes")
def list_changes(
    entity_kind: Literal["dataset", "field", "edge"] | None = Query(None),
    entity_key: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    user: dict = Depends(require_role("viewer")),
):
    """最近的变更日志（倒序）；可按 entity_kind + entity_key 精确定位某对象。"""
    clauses, args = [], []
    if entity_kind is not None:
        clauses.append("entity_kind=?")
        args.append(entity_kind)
    if entity_key is not None:
        clauses.append("entity_key=?")
        args.append(entity_key)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id, op, before, after, actor, created_at"
            f" FROM change_log{where} ORDER BY id DESC LIMIT ?",
            (*args, limit)).fetchall()
    return [{
        **dict(row),
        "before": json.loads(row["before"]) if row["before"] else None,
        "after": json.loads(row["after"]) if row["after"] else None,
    } for row in rows]
