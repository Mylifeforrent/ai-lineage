"""血缘边人工编辑 API（M3，editor+）。

- ``POST /edges``：人工建边（source='manual'），自然键重复 409，混合字段边 400；
- ``PATCH /edges/{id}``：改 transform/note/confidence；
- ``DELETE /edges/{id}``：删除错边。

三类写操作均写 change_log（batch_id=NULL，actor=当前用户），
供历史查看与标签回滚反做。
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Response

from ..changes import edge_key, edge_snapshot, log_change, now
from ..db import get_db
from ..models import EdgeCreate, EdgePatch
from ..security import require_role

router = APIRouter(tags=["edges"])


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _edge_row(conn, edge_id: int):
    return conn.execute(
        "SELECT id, from_dataset, from_field, to_dataset, to_field, transform,"
        " confidence, source, note, created_by, updated_by, created_at, updated_at"
        " FROM edge WHERE id=?", (edge_id,)).fetchone()


def _ensure_refs(conn, from_dataset: str, from_field: str | None,
                 to_dataset: str, to_field: str | None) -> None:
    for dataset_id in dict.fromkeys((from_dataset, to_dataset)):
        if conn.execute("SELECT 1 FROM dataset WHERE id=?",
                        (dataset_id,)).fetchone() is None:
            raise HTTPException(404, f"数据集「{dataset_id}」不存在")
    for dataset_id, field_name in ((from_dataset, from_field),
                                   (to_dataset, to_field)):
        if field_name is not None and conn.execute(
                "SELECT 1 FROM field WHERE dataset_id=? AND name=?",
                (dataset_id, field_name)).fetchone() is None:
            raise HTTPException(404, f"字段「{dataset_id}.{field_name}」不存在")


@router.post("/edges", status_code=201)
def create_edge(body: EdgeCreate, user: dict = Depends(require_role("editor"))):
    """人工新增血缘边；同自然键唯一，字段级/表级必须二选一。"""
    from_dataset = _clean(body.from_dataset)
    to_dataset = _clean(body.to_dataset)
    if not from_dataset or not to_dataset:
        raise HTTPException(400, "from_dataset / to_dataset 必填")
    from_field = _clean(body.from_field)
    to_field = _clean(body.to_field)
    if bool(from_field) != bool(to_field):
        raise HTTPException(
            400, "血缘边必须同时提供上下游字段（字段级）或都不提供（表级）")
    transform = _clean(body.transform)
    note = _clean(body.note)

    with get_db() as conn:
        _ensure_refs(conn, from_dataset, from_field, to_dataset, to_field)
        existing = conn.execute(
            "SELECT id FROM edge WHERE from_dataset=? AND from_field IS ?"
            " AND to_dataset=? AND to_field IS ?",
            (from_dataset, from_field, to_dataset, to_field)).fetchone()
        if existing is not None:
            raise HTTPException(
                409, "同一上下游自然键的血缘边已存在（边唯一，不变量#3）")
        timestamp = now()
        try:
            cur = conn.execute(
                "INSERT INTO edge(from_dataset, from_field, to_dataset, to_field,"
                " transform, confidence, source, note, created_by, updated_by,"
                " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (from_dataset, from_field, to_dataset, to_field, transform,
                 body.confidence, "manual", note, user["username"],
                 user["username"], timestamp, timestamp))
        except sqlite3.IntegrityError:
            # 并发/绕过预检时由唯一索引兜底
            raise HTTPException(
                409, "同一上下游自然键的血缘边已存在（边唯一，不变量#3）") from None
        row = _edge_row(conn, cur.lastrowid)
        log_change(
            conn, entity_kind="edge",
            entity_key=edge_key(from_dataset, from_field, to_dataset, to_field),
            op="added", before=None, after=edge_snapshot(row),
            actor=user["username"])
    return dict(row)


@router.patch("/edges/{edge_id}")
def patch_edge(edge_id: int, body: EdgePatch,
               user: dict = Depends(require_role("editor"))):
    """修改边的转换说明/备注/置信度（endpoints 与 source 不可改）。"""
    provided = body.model_fields_set
    if not provided:
        raise HTTPException(
            400, "至少提供一个可编辑字段（transform / note / confidence）")
    if "confidence" in provided and body.confidence is None:
        raise HTTPException(400, "confidence 不能为空（0~1）")

    with get_db() as conn:
        row = _edge_row(conn, edge_id)
        if row is None:
            raise HTTPException(404, f"血缘边 {edge_id} 不存在")
        new_transform = (_clean(body.transform) if "transform" in provided
                         else row["transform"])
        new_note = _clean(body.note) if "note" in provided else row["note"]
        new_confidence = (body.confidence if "confidence" in provided
                          else row["confidence"])
        before = edge_snapshot(row)
        after = {**before, "transform": new_transform, "note": new_note,
                 "confidence": new_confidence}
        if before == after:
            return dict(row)

        conn.execute(
            "UPDATE edge SET transform=?, note=?, confidence=?, updated_by=?,"
            " updated_at=? WHERE id=?",
            (new_transform, new_note, new_confidence, user["username"],
             now(), edge_id))
        log_change(
            conn, entity_kind="edge",
            entity_key=edge_key(row["from_dataset"], row["from_field"],
                                row["to_dataset"], row["to_field"]),
            op="updated", before=before, after=after, actor=user["username"])
        saved = _edge_row(conn, edge_id)
    return dict(saved)


@router.delete("/edges/{edge_id}", status_code=204)
def delete_edge(edge_id: int, user: dict = Depends(require_role("editor"))):
    """删除一条错边；before 快照写入 change_log 以支持标签回滚恢复。"""
    with get_db() as conn:
        row = _edge_row(conn, edge_id)
        if row is None:
            raise HTTPException(404, f"血缘边 {edge_id} 不存在")
        before = edge_snapshot(row)
        conn.execute("DELETE FROM edge WHERE id=?", (edge_id,))
        log_change(
            conn, entity_kind="edge",
            entity_key=edge_key(row["from_dataset"], row["from_field"],
                                row["to_dataset"], row["to_field"]),
            op="deleted", before=before, after=None, actor=user["username"])
    return Response(status_code=204)
