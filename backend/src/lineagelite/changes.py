"""变更日志写入与行快照工具（M3 人工编辑共用）。

``change_log`` 是版本重建的唯一依据（数据模型 §七）：
- 导入路径由 ``import_service`` 写入 ``batch_id=<批次>``；
- 人工编辑路径（字段/边/标签回滚之外）写 ``batch_id=NULL``，actor 取当前登录用户；
- 标注（annotation）追加式、只增不改，**不写 change_log**，也不随回滚删除；
- 版本标签创建以 ``version_tag.created_by/created_at`` 留痕，同样不写 change_log，
  否则「回滚到标签」会把标签本身当作可反做数据删除，违背标签永久保留的语义。

快照只包含业务列（不含 id / 时间戳），字段与边各有固定键集合，
保证同一实体的 before/after 可直接用于版本 diff 与反做。
"""

import json
from datetime import UTC, datetime

# 与导入路径写入的快照键保持一致（import_service._upsert_field / lineage 边快照）
FIELD_SNAPSHOT_KEYS = (
    "dataset_id", "name", "field_type", "source_file_id",
    "src_locator", "description",
)
EDGE_SNAPSHOT_KEYS = (
    "from_dataset", "from_field", "to_dataset", "to_field",
    "transform", "confidence", "source", "note",
)


def now() -> str:
    """统一时间格式：ISO8601 UTC（秒精度）。"""
    return datetime.now(UTC).isoformat(timespec="seconds")


def snapshot(row, keys: tuple[str, ...]) -> dict:
    """从 sqlite3.Row / dict 提取业务快照。"""
    return {key: row[key] for key in keys}


def field_snapshot(row) -> dict:
    return snapshot(row, FIELD_SNAPSHOT_KEYS)


def edge_snapshot(row) -> dict:
    return snapshot(row, EDGE_SNAPSHOT_KEYS)


def edge_key(from_dataset: str, from_field: str | None,
             to_dataset: str, to_field: str | None) -> str:
    """边的多态/日志命名规则（数据模型 §5.2）：字段为空用 ``*``。"""
    return f"{from_dataset}.{from_field or '*'}-->{to_dataset}.{to_field or '*'}"


def log_change(conn, *, entity_kind: str, entity_key: str, op: str,
               before: dict | None, after: dict | None, actor: str,
               batch_id: int | None = None) -> None:
    """追加一条 change_log；调用方保证处于同一事务。"""
    conn.execute(
        "INSERT INTO change_log(batch_id, entity_kind, entity_key, op,"
        " before, after, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (batch_id, entity_kind, entity_key, op,
         json.dumps(before, ensure_ascii=False, sort_keys=True) if before else None,
         json.dumps(after, ensure_ascii=False, sort_keys=True) if after else None,
         actor, now()))


def load_snapshot(raw: str | None) -> dict | None:
    """change_log.before/after（TEXT）→ dict；空值返回 None。"""
    return json.loads(raw) if raw else None
