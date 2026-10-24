"""版本管理：按导入批次/业务标签回滚（change_log 反做）、变更查询与标签 diff。

回滚规则（数据模型 §七）：added→删除、updated→恢复 before、deleted→重插 before，
按日志 id 倒序执行。反做函数对「行已不存在/已存在」均安全，因此同一标签重复回滚
（幂等）不会改变最终状态。

留痕策略：
- 批次回滚沿用 import_batch.rolled_back_at/by；
- 标签回滚写 rollback_record（不写 change_log，避免下次回滚反做回滚日志），
  并把被反做日志所属的 import_batch 同样标记 rolled_back_at/by（标签边界
  不会落在单个批次内部，因此这些批次的数据已被完整反做）；
- 标签创建以 version_tag.created_by/created_at 留痕，标签永久保留。
"""

import sqlite3

from .changes import edge_key, load_snapshot, now
from .db import get_db


def _now() -> str:
    return now()


def _edge_created_by(conn, snap: dict, actor: str, log_id: int) -> str:
    """恢复已删除边时还原原始创建者。

    快照只含业务列（``EDGE_SNAPSHOT_KEYS``），不含审计列；原始创建者从该
    自然键在本次 ``deleted`` 日志之前、最近一条 ``added`` 日志的 actor 还原
    （同一自然键被删除后重建时取重建者）。日志缺失（历史被裁剪）时退回本次
    回滚执行者，保证 ``created_by`` 不为 NULL。
    """
    if snap.get("created_by"):
        return str(snap["created_by"])
    key = edge_key(snap["from_dataset"], snap["from_field"],
                   snap["to_dataset"], snap["to_field"])
    row = conn.execute(
        "SELECT actor FROM change_log WHERE entity_kind='edge'"
        " AND entity_key=? AND op='added' AND id < ? ORDER BY id DESC LIMIT 1",
        (key, log_id)).fetchone()
    return row["actor"] if row is not None else actor


def _restore_row(conn, table: str, snap: dict, actor: str, log_id: int) -> None:
    """重插一行（deleted 的反做）。

    使用幂等写法：目标行已存在时更新为快照值，保证重复回滚安全；
    边的自然键含 NULL，SQLite 的部分唯一索引无法作为 ON CONFLICT 目标，
    因此先查后写。

    审计列：``created_by`` 优先还原原始创建者（见 ``_edge_created_by``），
    已存在的非空值不被覆盖、NULL 时回填；``updated_by`` 记录本次恢复/回滚
    的执行者。
    """
    if table == "dataset":
        conn.execute(
            "INSERT INTO dataset(id, name, description, created_at, updated_at)"
            " VALUES (?,?,?,?,?)"
            " ON CONFLICT(id) DO UPDATE SET name=excluded.name,"
            " description=excluded.description, updated_at=excluded.updated_at",
            (snap["id"], snap["name"], snap["description"], _now(), _now()))
    elif table == "field":
        conn.execute(
            "INSERT INTO field(dataset_id, name, field_type, source_file_id,"
            " src_locator, description, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)"
            " ON CONFLICT(dataset_id, name) DO UPDATE SET"
            " field_type=excluded.field_type,"
            " source_file_id=excluded.source_file_id,"
            " src_locator=excluded.src_locator,"
            " description=excluded.description,"
            " updated_at=excluded.updated_at",
            (snap["dataset_id"], snap["name"], snap["field_type"],
             snap["source_file_id"], snap["src_locator"], snap["description"],
             _now(), _now()))
    elif table == "edge":
        existing = conn.execute(
            "SELECT id FROM edge WHERE from_dataset=? AND from_field IS ? AND"
            " to_dataset=? AND to_field IS ?",
            (snap["from_dataset"], snap["from_field"], snap["to_dataset"],
             snap["to_field"])).fetchone()
        if existing is not None:
            # 已存在的非空 created_by 不被覆盖；历史 NULL 回填原始创建者
            conn.execute(
                "UPDATE edge SET transform=?, confidence=?, source=?, note=?,"
                " created_by=COALESCE(created_by, ?), updated_by=?,"
                " updated_at=? WHERE id=?",
                (snap["transform"], snap["confidence"], snap["source"],
                 snap["note"], _edge_created_by(conn, snap, actor, log_id),
                 actor, _now(), existing["id"]))
            return
        conn.execute(
            "INSERT INTO edge(from_dataset, from_field, to_dataset, to_field,"
            " transform, confidence, source, note, created_by, updated_by,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (snap["from_dataset"], snap["from_field"], snap["to_dataset"],
             snap["to_field"], snap["transform"], snap["confidence"],
             snap["source"], snap["note"],
             _edge_created_by(conn, snap, actor, log_id),
             actor, _now(), _now()))


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


def _reverse_log(conn, log, actor: str) -> None:
    """反做一条 change_log；批次回滚与标签回滚共用。"""
    kind, op = log["entity_kind"], log["op"]
    before = load_snapshot(log["before"])
    after = load_snapshot(log["after"])
    if op == "added":
        _delete_row(conn, kind, after)
    elif op == "updated":
        _restore_update(conn, kind, before)
    elif op == "deleted":
        _restore_row(conn, kind, before, actor, log["id"])


def _reverse_logs(conn, logs, conflict_message: str, actor: str) -> None:
    try:
        for log in logs:
            _reverse_log(conn, log, actor)
    except sqlite3.IntegrityError as e:
        # 外键/唯一约束冲突：抛 ValueError 由路由层转 409（get_db 回滚整个事务）
        raise ValueError(conflict_message) from e


def rollback_batch(batch_id: int, actor: str) -> int:
    """反做一个导入批次的全部变更，返回反做的日志条数。"""
    with get_db() as conn:
        batch = conn.execute("SELECT * FROM import_batch WHERE id=?",
                             (batch_id,)).fetchone()
        if batch is None:
            raise LookupError(f"导入批次 {batch_id} 不存在")
        if batch["rolled_back_at"]:
            raise ValueError(
                f"批次 v{batch['version_no']} 已于 {batch['rolled_back_at']} 回滚")

        logs = conn.execute(
            "SELECT * FROM change_log WHERE batch_id=? ORDER BY id DESC",
            (batch_id,)).fetchall()
        _reverse_logs(
            conn, logs,
            "存在后续批次引用本批字段的边，请先回滚更晚的批次", actor)

        conn.execute(
            "UPDATE import_batch SET rolled_back_at=?, rolled_back_by=? WHERE id=?",
            (_now(), actor, batch_id))
        return len(logs)


# ---------- 版本标签 ----------

def _tag_row(conn, name: str):
    return conn.execute("SELECT * FROM version_tag WHERE name=?",
                        (name,)).fetchone()


def create_tag(name: str, note: str | None, actor: str) -> dict:
    """在 change_log 当前末尾打业务标签。"""
    with get_db() as conn:
        if _tag_row(conn, name) is not None:
            raise ValueError(f"版本标签「{name}」已存在")
        change_seq = conn.execute(
            "SELECT COALESCE(MAX(id), 0) AS n FROM change_log").fetchone()["n"]
        # batch_id 仅作信息性记录（回滚不依赖它）：取当前最近导入批次
        batch_id = conn.execute(
            "SELECT MAX(id) AS n FROM import_batch").fetchone()["n"]
        conn.execute(
            "INSERT INTO version_tag(name, note, batch_id, change_seq,"
            " created_by, created_at) VALUES (?,?,?,?,?,?)",
            (name, note, batch_id, change_seq, actor, _now()))
        return dict(_tag_row(conn, name))


def list_tags() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, note, batch_id, change_seq, created_by, created_at"
            " FROM version_tag ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def rollback_to_tag(name: str, actor: str) -> int:
    """反做标签 change_seq 之后的全部 change_log（含人工编辑），返回条数。

    反做不写 change_log；重复调用因 ``_restore_row/_delete_row`` 幂等而安全，
    每次调用追加一条 rollback_record 审计。被反做日志所属的导入批次同步写
    ``rolled_back_at/by``，使版本抽屉的批次状态与数据现状一致。
    """
    with get_db() as conn:
        tag = _tag_row(conn, name)
        if tag is None:
            raise LookupError(f"版本标签「{name}」不存在")
        to_seq = conn.execute(
            "SELECT COALESCE(MAX(id), 0) AS n FROM change_log").fetchone()["n"]
        logs = conn.execute(
            "SELECT * FROM change_log WHERE id > ? ORDER BY id DESC",
            (tag["change_seq"],)).fetchall()
        _reverse_logs(
            conn, logs,
            "回滚遇引用完整性冲突：请先删除晚于该标签、引用将被删除字段的血缘边",
            actor)
        # 被反做日志所属的批次数据已整体回到标签时点，同步标记批次状态，
        # 避免版本抽屉把已失效批次继续显示为「有效」。重复回滚保留首次时间。
        batch_ids = sorted({log["batch_id"] for log in logs
                            if log["batch_id"] is not None})
        if batch_ids:
            placeholders = ", ".join("?" for _ in batch_ids)
            conn.execute(
                f"UPDATE import_batch SET"
                f" rolled_back_at=COALESCE(rolled_back_at, ?),"
                f" rolled_back_by=COALESCE(rolled_back_by, ?)"
                f" WHERE id IN ({placeholders})",
                (_now(), actor, *batch_ids))
        conn.execute(
            "INSERT INTO rollback_record(tag_name, from_change_seq, to_change_seq,"
            " reverted, actor, created_at) VALUES (?,?,?,?,?,?)",
            (name, tag["change_seq"], to_seq, len(logs), actor, _now()))
        return len(logs)


def tag_diff(from_name: str, to_name: str) -> dict:
    """两个业务标签之间的净变更（change_log 区间按 entity_key 归并）。

    - 区间内首次出现的 before 作为区间起点状态，最后一次 after 作为终点状态；
    - 起点/终点均为空（区间内先增后删）视为无净变更；
    - 净增/净删/值变化分别计入 added/deleted/updated。
    """
    with get_db() as conn:
        from_tag = _tag_row(conn, from_name)
        to_tag = _tag_row(conn, to_name)
    if from_tag is None:
        raise LookupError(f"版本标签「{from_name}」不存在")
    if to_tag is None:
        raise LookupError(f"版本标签「{to_name}」不存在")
    if from_tag["change_seq"] > to_tag["change_seq"]:
        raise ValueError(
            f"起始标签「{from_name}」晚于结束标签「{to_name}」，无法计算 diff")

    with get_db() as conn:
        logs = conn.execute(
            "SELECT * FROM change_log WHERE id > ? AND id <= ? ORDER BY id",
            (from_tag["change_seq"], to_tag["change_seq"])).fetchall()

    states: dict[tuple[str, str], dict] = {}
    for log in logs:
        key = (log["entity_kind"], log["entity_key"])
        entry = states.get(key)
        if entry is None:
            # 区间首条日志的 before 代表区间起点状态
            entry = {"before": load_snapshot(log["before"]), "after": None}
            states[key] = entry
        entry["after"] = load_snapshot(log["after"])

    items = []
    summary = {"added": 0, "updated": 0, "deleted": 0}
    for (entity_kind, entity_key), entry in sorted(states.items()):
        before, after = entry["before"], entry["after"]
        if before is None and after is None:
            continue
        if before is None:
            op = "added"
        elif after is None:
            op = "deleted"
        elif before != after:
            op = "updated"
        else:
            continue
        summary[op] += 1
        items.append({
            "entity_kind": entity_kind,
            "entity_key": entity_key,
            "op": op,
            "before": before,
            "after": after,
        })
    return {
        "summary": summary,
        "items": items,
    }


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
