"""版本管理：按导入批次回滚（change_log 反做）与变更查询。

回滚规则（数据模型 §七）：added→删除、updated→恢复 before、deleted→重插 before，
按日志 id 倒序执行；批次本身以 rolled_back_at/by 留痕（业务规则#6），
change_log 保持只读历史，保证重导入幂等。
"""

import json
import sqlite3
from datetime import UTC, datetime

from .db import get_db


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _restore_row(conn, table: str, snap: dict) -> None:
    if table == "dataset":
        conn.execute(
            "INSERT INTO dataset(id, name, description, created_at, updated_at)"
            " VALUES (?,?,?,?,?)",
            (snap["id"], snap["name"], snap["description"], _now(), _now()))
    elif table == "field":
        conn.execute(
            "INSERT INTO field(dataset_id, name, field_type, source_file_id,"
            " src_locator, description, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (snap["dataset_id"], snap["name"], snap["field_type"],
             snap["source_file_id"], snap["src_locator"], snap["description"],
             _now(), _now()))
    elif table == "edge":
        conn.execute(
            "INSERT INTO edge(from_dataset, from_field, to_dataset, to_field,"
            " transform, confidence, source, note, created_by, updated_by,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (snap["from_dataset"], snap["from_field"], snap["to_dataset"],
             snap["to_field"], snap["transform"], snap["confidence"],
             snap["source"], snap["note"], snap.get("created_by"),
             snap.get("updated_by"), _now(), _now()))


def _delete_row(conn, table: str, snap: dict) -> None:
    if table == "dataset":
        conn.execute("DELETE FROM dataset WHERE id=?", (snap["id"],))
    elif table == "field":
        conn.execute("DELETE FROM field WHERE dataset_id=? AND name=?",
                     (snap["dataset_id"], snap["name"]))
    elif table == "edge":
        conn.execute(
            "DELETE FROM edge WHERE from_dataset=? AND from_field IS ? AND"
            " to_dataset=? AND to_field IS ?",
            (snap["from_dataset"], snap["from_field"], snap["to_dataset"],
             snap["to_field"]))


def _restore_update(conn, table: str, snap: dict) -> None:
    if table == "dataset":
        conn.execute("UPDATE dataset SET name=?, description=? WHERE id=?",
                     (snap["name"], snap["description"], snap["id"]))
    elif table == "field":
        conn.execute(
            "UPDATE field SET field_type=?, source_file_id=?, src_locator=?,"
            " description=? WHERE dataset_id=? AND name=?",
            (snap["field_type"], snap["source_file_id"], snap["src_locator"],
             snap["description"], snap["dataset_id"], snap["name"]))
    elif table == "edge":
        conn.execute(
            "UPDATE edge SET transform=?, confidence=?, source=?, note=?"
            " WHERE from_dataset=? AND from_field IS ? AND to_dataset=? AND to_field IS ?",
            (snap["transform"], snap["confidence"], snap["source"], snap["note"],
             snap["from_dataset"], snap["from_field"], snap["to_dataset"],
             snap["to_field"]))


def rollback_batch(batch_id: int, actor: str) -> int:
    """反做一个导入批次的全部变更，返回反做的日志条数。"""
    with get_db() as conn:
        batch = conn.execute("SELECT * FROM import_batch WHERE id=?", (batch_id,)).fetchone()
        if batch is None:
            raise LookupError(f"导入批次 {batch_id} 不存在")
        if batch["rolled_back_at"]:
            raise ValueError(f"批次 v{batch['version_no']} 已于 {batch['rolled_back_at']} 回滚")

        logs = conn.execute(
            "SELECT * FROM change_log WHERE batch_id=? ORDER BY id DESC",
            (batch_id,)).fetchall()
        try:
            for log in logs:
                kind, op = log["entity_kind"], log["op"]
                before = json.loads(log["before"]) if log["before"] else None
                after = json.loads(log["after"]) if log["after"] else None
                if op == "added":
                    _delete_row(conn, kind, after)
                elif op == "updated":
                    _restore_update(conn, kind, before)
                elif op == "deleted":
                    _restore_row(conn, kind, before)
        except sqlite3.IntegrityError as e:
            # 后续批次的边引用了本批新增的字段时，删除字段违反复合外键；
            # 抛 ValueError 由路由层转 409（get_db 会回滚已执行的反做）
            raise ValueError(
                "存在后续批次引用本批字段的边，请先回滚更晚的批次") from e

        conn.execute(
            "UPDATE import_batch SET rolled_back_at=?, rolled_back_by=? WHERE id=?",
            (_now(), actor, batch_id))
        return len(logs)


def get_snapshot() -> dict:
    """当前血缘状态快照（用于回滚验证与基础浏览）。"""
    with get_db() as conn:
        datasets = [dict(r) for r in conn.execute("SELECT id, name FROM dataset ORDER BY id")]
        fields = [dict(r) for r in conn.execute(
            "SELECT dataset_id, name, field_type, source_file_id, description"
            " FROM field ORDER BY dataset_id, name")]
        edges = [dict(r) for r in conn.execute(
            "SELECT from_dataset, from_field, to_dataset, to_field, transform,"
            " confidence, source, note FROM edge"
            " ORDER BY from_dataset, from_field, to_dataset, to_field")]
    return {"datasets": datasets, "fields": fields, "edges": edges}
