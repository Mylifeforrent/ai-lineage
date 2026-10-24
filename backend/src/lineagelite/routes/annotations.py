"""标注 API（业务模型 §5.4 / 不变量#5）。

标注是追加式业务说明：只增不改、不写 change_log、不随版本回滚删除。
``target_kind`` + ``target_id`` 是多态关联（数据模型 §5.2）：

- dataset：``<dataset_id>``
- field：``<dataset_id>.<field_name>``
- edge：``<from>--><to>``，字段级为 ``ds.field-->ds.field``，
  表级边为 ``ds.*-->ds.*``（也接受省略 ``.*`` 的 ``ds-->ds``）

目标不存在返回 404，格式不合法返回 400。
"""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from ..changes import now
from ..db import get_db
from ..models import AnnotationCreate
from ..security import require_role

router = APIRouter(tags=["annotations"])


class TargetFormatError(ValueError):
    """target_id 格式不合法（→ 400）。"""


def _parse_edge_side(raw: str) -> tuple[str, str | None]:
    if not raw:
        raise TargetFormatError("血缘边 target_id 两侧不能为空")
    if raw.endswith(".*"):
        dataset = raw[:-2]
        if not dataset:
            raise TargetFormatError("血缘边 target_id 的数据集不能为空")
        return dataset, None
    if "." not in raw:
        # 表级边的简写：ds-->ds
        return raw, None
    dataset, field = raw.rsplit(".", 1)
    if not dataset or not field:
        raise TargetFormatError(
            "血缘边 target_id 格式应为 <dataset>.<field>-->... 或 <dataset>.*-->...")
    return dataset, field


def _parse_edge_target(target_id: str) -> tuple[str, str | None, str, str | None]:
    if "-->" not in target_id:
        raise TargetFormatError("血缘边 target_id 格式应为 <from>--><to>")
    left, right = target_id.split("-->", 1)
    from_dataset, from_field = _parse_edge_side(left)
    to_dataset, to_field = _parse_edge_side(right)
    return from_dataset, from_field, to_dataset, to_field


def _resolve_field_target(conn: sqlite3.Connection, target_id: str) -> None:
    """field target_id 解析并校存在；数据集 ID / 字段名可能含点，取唯一命中。"""
    if "." not in target_id:
        raise TargetFormatError("字段 target_id 格式应为 <dataset_id>.<field_name>")
    matches = []
    start = 0
    while True:
        idx = target_id.find(".", start)
        if idx < 0:
            break
        dataset_id, field_name = target_id[:idx], target_id[idx + 1:]
        if dataset_id and field_name and conn.execute(
                "SELECT 1 FROM field WHERE dataset_id=? AND name=?",
                (dataset_id, field_name)).fetchone() is not None:
            matches.append((dataset_id, field_name))
        start = idx + 1
    if len(matches) > 1:
        raise TargetFormatError(f"字段 target_id「{target_id}」存在歧义，请检查数据集/字段命名")
    if not matches:
        raise LookupError(f"字段「{target_id}」不存在")


def _validate_target(conn: sqlite3.Connection, kind: str, target_id: str) -> None:
    """目标存在性校验：不存在抛 LookupError（→404），格式错抛 TargetFormatError（→400）。"""
    if kind == "dataset":
        if conn.execute("SELECT 1 FROM dataset WHERE id=?",
                        (target_id,)).fetchone() is None:
            raise LookupError(f"数据集「{target_id}」不存在")
        return
    if kind == "field":
        _resolve_field_target(conn, target_id)
        return
    from_dataset, from_field, to_dataset, to_field = _parse_edge_target(target_id)
    if conn.execute(
            "SELECT 1 FROM edge WHERE from_dataset=? AND from_field IS ?"
            " AND to_dataset=? AND to_field IS ?",
            (from_dataset, from_field, to_dataset, to_field)).fetchone() is None:
        raise LookupError(f"血缘边「{target_id}」不存在")


@router.post("/annotations", status_code=201)
def create_annotation(body: AnnotationCreate,
                      user: dict = Depends(require_role("editor"))):
    """追加一条标注（editor+）。标注不做更新/删除，也不写 change_log。"""
    text = body.body.strip()
    if not text:
        raise HTTPException(400, "标注内容不能为空")
    with get_db() as conn:
        try:
            _validate_target(conn, body.target_kind, body.target_id)
        except TargetFormatError as e:
            raise HTTPException(400, str(e)) from None
        except LookupError as e:
            raise HTTPException(404, str(e)) from None
        cur = conn.execute(
            "INSERT INTO annotation(target_kind, target_id, body, author, created_at)"
            " VALUES (?,?,?,?,?)",
            (body.target_kind, body.target_id, text, user["username"], now()))
        row = conn.execute("SELECT * FROM annotation WHERE id=?",
                           (cur.lastrowid,)).fetchone()
    return dict(row)


@router.get("/annotations")
def list_annotations(
    target_kind: Literal["dataset", "field", "edge"] | None = Query(None),
    target_id: str | None = Query(None),
    user: dict = Depends(require_role("viewer")),
):
    """按目标筛选标注（viewer+），按追加顺序（id 升序）返回。"""
    clauses, args = [], []
    if target_kind is not None:
        clauses.append("target_kind=?")
        args.append(target_kind)
    if target_id is not None:
        clauses.append("target_id=?")
        args.append(target_id)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id, target_kind, target_id, body, author, created_at"
            f" FROM annotation{where} ORDER BY id", args).fetchall()
    return [dict(r) for r in rows]
