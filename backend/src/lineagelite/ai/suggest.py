"""M4 启发式血缘建议：AI 建议边必须人工确认后才生效（业务不变量#4）。

启发式（不调用 LLM，可离线运行）：
1. **同名字段优先**：字段名小写并去掉下划线后完全相等 → confidence 0.7；
2. **包含关系其次**：去下划线小写后一方包含另一方（较短者至少 3 个字符）
   → confidence 0.6；
3. 排除已存在的边（两个方向都排除，避免建议出反向重复/环）；
4. 候选以 ``source='ai'`` 落库并写 change_log(added)；
5. ``confirm`` 将 source 改为 manual 并写 change_log(updated)；
   ``reject`` 删除候选边并写 change_log(deleted)。

候选方向：以请求给出的数据集/字段为上游（from），其他数据集的相似字段为下游（to）。
"""

from __future__ import annotations

import sqlite3

from ..changes import edge_key, edge_snapshot, log_change, now

MAX_SUGGESTIONS = 20
EXACT_CONFIDENCE = 0.7
CONTAINMENT_CONFIDENCE = 0.6
MIN_CONTAINMENT_LENGTH = 3

_EDGE_COLUMNS = (
    "id, from_dataset, from_field, to_dataset, to_field, transform,"
    " confidence, source, note, created_by, updated_by, created_at, updated_at"
)


def normalize_field_name(name: str) -> str:
    """契约定义的归一化：小写 + 去掉下划线。"""
    return name.strip().lower().replace("_", "")


def _focus_fields(conn: sqlite3.Connection, dataset: str,
                  field: str | None) -> list[sqlite3.Row]:
    if conn.execute("SELECT 1 FROM dataset WHERE id=?", (dataset,)).fetchone() is None:
        raise LookupError(f"数据集「{dataset}」不存在")
    if field is not None:
        rows = conn.execute(
            "SELECT dataset_id, name FROM field WHERE dataset_id=? AND name=?",
            (dataset, field)).fetchall()
        if not rows:
            raise LookupError(f"字段「{dataset}.{field}」不存在")
        return rows
    return conn.execute(
        "SELECT dataset_id, name FROM field WHERE dataset_id=? ORDER BY name",
        (dataset,)).fetchall()


def _target_fields(conn: sqlite3.Connection,
                   source_dataset: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT dataset_id, name FROM field WHERE dataset_id <> ?"
        " ORDER BY dataset_id, name",
        (source_dataset,)).fetchall()


def _existing_edge_keys(conn: sqlite3.Connection) -> set[tuple]:
    """已存在边的自然键集合（含反向），用于排除重复建议。"""
    keys: set[tuple] = set()
    rows = conn.execute(
        "SELECT from_dataset, from_field, to_dataset, to_field FROM edge").fetchall()
    for row in rows:
        key = (row["from_dataset"], row["from_field"],
               row["to_dataset"], row["to_field"])
        keys.add(key)
        keys.add((row["to_dataset"], row["to_field"],
                  row["from_dataset"], row["from_field"]))
    return keys


def _match(focus_name: str, target_name: str) -> tuple[float, str] | None:
    left = normalize_field_name(focus_name)
    right = normalize_field_name(target_name)
    if not left or not right:
        return None
    if left == right:
        return (EXACT_CONFIDENCE,
                f"同名字段（忽略大小写与下划线）：{focus_name} 与 {target_name}")
    shorter, longer = sorted((left, right), key=len)
    if len(shorter) >= MIN_CONTAINMENT_LENGTH and shorter in longer:
        return (CONTAINMENT_CONFIDENCE,
                "字段名高度相似（忽略大小写与下划线后为包含关系）："
                f"{focus_name} 与 {target_name}")
    return None


def suggest_edges(conn: sqlite3.Connection, dataset: str, field: str | None,
                  actor: str) -> list[dict]:
    """生成并落库 AI 候选边，返回本次新增的候选列表。

    返回值严格对应 API 契约：
    ``[{from_dataset, from_field, to_dataset, to_field, confidence, reason}]``。
    同一自然键已有边时跳过，因此重复调用不会重复落库。
    """
    focus_rows = _focus_fields(conn, dataset, field)
    target_rows = _target_fields(conn, dataset)
    existing = _existing_edge_keys(conn)

    candidates: list[dict] = []
    seen: set[tuple] = set()
    for focus in focus_rows:
        for target in target_rows:
            key = (focus["dataset_id"], focus["name"],
                   target["dataset_id"], target["name"])
            if key in existing or key in seen:
                continue
            match = _match(focus["name"], target["name"])
            if match is None:
                continue
            confidence, reason = match
            seen.add(key)
            candidates.append({
                "from_dataset": focus["dataset_id"],
                "from_field": focus["name"],
                "to_dataset": target["dataset_id"],
                "to_field": target["name"],
                "confidence": confidence,
                "reason": reason,
            })

    # 同名字段（0.7）优先于包含关系（0.6）；同置信度按目标字段稳定排序
    candidates.sort(key=lambda item: (
        -item["confidence"], item["to_dataset"], item["to_field"],
        item["from_dataset"], item["from_field"]))
    candidates = candidates[:MAX_SUGGESTIONS]

    timestamp = now()
    for candidate in candidates:
        cur = conn.execute(
            "INSERT INTO edge(from_dataset, from_field, to_dataset, to_field,"
            " transform, confidence, source, note, created_by, updated_by,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (candidate["from_dataset"], candidate["from_field"],
             candidate["to_dataset"], candidate["to_field"],
             None, candidate["confidence"], "ai", candidate["reason"],
             actor, actor, timestamp, timestamp))
        row = conn.execute(
            f"SELECT {_EDGE_COLUMNS} FROM edge WHERE id=?",
            (cur.lastrowid,)).fetchone()
        log_change(
            conn, entity_kind="edge",
            entity_key=edge_key(candidate["from_dataset"],
                                candidate["from_field"],
                                candidate["to_dataset"],
                                candidate["to_field"]),
            op="added", before=None, after=edge_snapshot(row), actor=actor)
    return candidates


def _ai_edge(conn: sqlite3.Connection, from_dataset: str,
             from_field: str | None, to_dataset: str,
             to_field: str | None) -> sqlite3.Row:
    row = conn.execute(
        f"SELECT {_EDGE_COLUMNS} FROM edge"
        " WHERE from_dataset=? AND from_field IS ?"
        " AND to_dataset=? AND to_field IS ? AND source='ai'",
        (from_dataset, from_field, to_dataset, to_field)).fetchone()
    if row is None:
        raise LookupError(
            "AI 建议边不存在或已处理（仅 source='ai' 的候选可确认/拒绝）")
    return row


def confirm_suggestion(conn: sqlite3.Connection, from_dataset: str,
                       from_field: str | None, to_dataset: str,
                       to_field: str | None, actor: str) -> dict:
    """把 AI 候选边转为人工边（source='manual'），写 change_log(updated)。"""
    row = _ai_edge(conn, from_dataset, from_field, to_dataset, to_field)
    before = edge_snapshot(row)
    conn.execute(
        "UPDATE edge SET source='manual', updated_by=?, updated_at=? WHERE id=?",
        (actor, now(), row["id"]))
    after = {**before, "source": "manual"}
    log_change(
        conn, entity_kind="edge",
        entity_key=edge_key(from_dataset, from_field, to_dataset, to_field),
        op="updated", before=before, after=after, actor=actor)
    saved = conn.execute(
        f"SELECT {_EDGE_COLUMNS} FROM edge WHERE id=?", (row["id"],)).fetchone()
    return dict(saved)


def reject_suggestion(conn: sqlite3.Connection, from_dataset: str,
                      from_field: str | None, to_dataset: str,
                      to_field: str | None, actor: str) -> None:
    """删除 AI 候选边，写 change_log(deleted)。"""
    row = _ai_edge(conn, from_dataset, from_field, to_dataset, to_field)
    before = edge_snapshot(row)
    conn.execute("DELETE FROM edge WHERE id=?", (row["id"],))
    log_change(
        conn, entity_kind="edge",
        entity_key=edge_key(from_dataset, from_field, to_dataset, to_field),
        op="deleted", before=before, after=None, actor=actor)
