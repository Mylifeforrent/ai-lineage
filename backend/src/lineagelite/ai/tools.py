"""LLM 只读工具集（M4）：复用既有查询能力，返回 JSON 可序列化结果。

工具只读，绝不写库；每个函数接收 ``sqlite3.Connection``，由 ``chat.py`` 在
每轮工具调用时通过 ``get_db()`` 打开连接。

- ``search_fields``：字段名/数据集/描述/标注的模糊搜索（数据模型 §3.2 的轻量实现）；
- ``get_field_details``：字段元数据 + 源定位器 + 回源预览 + 标注（复用 preview.py）；
- ``trace_lineage``：N 跳血缘子图（复用 lineage.py 的 GraphPayload）；
- ``get_field_history``：字段的 change_log 变更历史（复用 changes.py 快照解析）。
"""

from __future__ import annotations

import json
import sqlite3

from ..changes import load_snapshot
from ..lineage import DIRECTIONS, MAX_HOPS, LineageNotFound, lineage_subgraph
from ..preview import PreviewError, field_preview

MAX_SEARCH_RESULTS = 20
MAX_HISTORY_ROWS = 50

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_fields",
            "description": (
                "按关键词模糊搜索字段：匹配数据集 ID/名称、字段名、字段描述"
                "以及字段标注；返回最多 20 条。用于定位用户问题中的字段。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "q": {"type": "string",
                          "description": "搜索关键词，例如 order_no 或 订单号"},
                },
                "required": ["q"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_field_details",
            "description": (
                "获取字段详情：类型、描述、源文件定位器、回源预览与标注历史。"
                "回答“这个字段来自哪个文件/哪一列”时使用。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "dataset": {"type": "string", "description": "数据集 ID"},
                    "field": {"type": "string", "description": "字段名"},
                },
                "required": ["dataset", "field"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trace_lineage",
            "description": (
                "按数据集或字段追溯上下游血缘，返回 N 跳子图（GraphPayload："
                "datasets/edges）。回答“从哪来/流向哪里”时使用。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "dataset": {"type": "string", "description": "种子数据集 ID"},
                    "field": {"type": "string",
                              "description": "种子字段名；省略则按数据集追溯"},
                    "direction": {
                        "type": "string",
                        "enum": list(DIRECTIONS),
                        "description": "both=双向，up=仅上游，down=仅下游；默认 both",
                    },
                    "hops": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": MAX_HOPS,
                        "description": f"最大跳数 1~{MAX_HOPS}，默认 3",
                    },
                },
                "required": ["dataset"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_field_history",
            "description": (
                "查询字段的变更历史（change_log 倒序）：谁在何时新增/修改了"
                "字段描述、类型或源定位器。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "dataset": {"type": "string", "description": "数据集 ID"},
                    "field": {"type": "string", "description": "字段名"},
                },
                "required": ["dataset", "field"],
            },
        },
    },
]


class ToolError(ValueError):
    """工具参数或目标不合法；回传给 LLM 以便其自我纠正，不中断对话。"""


def _text(args: dict, key: str, *, required: bool = True) -> str | None:
    value = args.get(key)
    if value is None:
        if required:
            raise ToolError(f"缺少参数「{key}」")
        return None
    if not isinstance(value, str):
        raise ToolError(f"参数「{key}」必须是字符串")
    text = value.strip()
    if required and not text:
        raise ToolError(f"参数「{key}」不能为空")
    return text or None


def _hops(args: dict) -> int:
    value = args.get("hops", 3)
    if isinstance(value, bool) or not isinstance(value, int):
        # 部分模型会把整数写成字符串，这里做一次宽容转换
        try:
            value = int(value)
        except (TypeError, ValueError):
            raise ToolError(f"hops 必须是 1~{MAX_HOPS} 的整数") from None
    if not 1 <= value <= MAX_HOPS:
        raise ToolError(f"hops 必须是 1~{MAX_HOPS} 的整数，收到「{value}」")
    return value


def _direction(args: dict) -> str:
    value = args.get("direction", "both")
    if value is None:
        return "both"
    if not isinstance(value, str) or value not in DIRECTIONS:
        raise ToolError(
            f"direction 必须是 {'/'.join(DIRECTIONS)}，收到「{value}」")
    return value


def search_fields(conn: sqlite3.Connection, args: dict) -> dict:
    query = _text(args, "q")
    pattern = f"%{query.lower()}%"
    rows = conn.execute(
        "SELECT f.dataset_id, COALESCE(d.name, '') AS dataset_name,"
        " f.name, f.field_type, f.description"
        " FROM field f JOIN dataset d ON d.id = f.dataset_id"
        " WHERE lower(f.dataset_id) LIKE :pattern"
        "    OR lower(COALESCE(d.name, '')) LIKE :pattern"
        "    OR lower(f.name) LIKE :pattern"
        "    OR lower(COALESCE(f.description, '')) LIKE :pattern"
        "    OR EXISTS ("
        "         SELECT 1 FROM annotation a"
        "         WHERE a.target_kind = 'field'"
        "           AND a.target_id = f.dataset_id || '.' || f.name"
        "           AND lower(a.body) LIKE :pattern)"
        " ORDER BY CASE"
        "            WHEN lower(f.name) = :exact THEN 0"
        "            WHEN lower(f.name) LIKE :prefix THEN 1"
        "            ELSE 2 END,"
        "          f.dataset_id, f.name"
        " LIMIT :limit",
        {"pattern": pattern, "exact": query.lower(),
         "prefix": f"{query.lower()}%", "limit": MAX_SEARCH_RESULTS},
    ).fetchall()
    return {"query": query, "results": [dict(row) for row in rows]}


def get_field_details(conn: sqlite3.Connection, args: dict) -> dict:
    dataset = _text(args, "dataset")
    field = _text(args, "field")

    dataset_row = conn.execute(
        "SELECT id, name, description FROM dataset WHERE id=?",
        (dataset,)).fetchone()
    if dataset_row is None:
        raise ToolError(f"数据集「{dataset}」不存在")

    row = conn.execute(
        "SELECT f.name, f.field_type, f.description, f.src_locator,"
        " s.id AS source_file_id, s.original_name, s.src_type, s.sha256"
        " FROM field f JOIN source_file s ON s.id = f.source_file_id"
        " WHERE f.dataset_id=? AND f.name=?",
        (dataset, field)).fetchone()
    if row is None:
        raise ToolError(f"字段「{dataset}.{field}」不存在")

    try:
        locator = json.loads(row["src_locator"])
    except (TypeError, json.JSONDecodeError):
        locator = {"type": None, "input": None, "resolved": None}

    annotations = conn.execute(
        "SELECT body, author, created_at FROM annotation"
        " WHERE target_kind='field' AND target_id=? ORDER BY id",
        (f"{dataset}.{field}",)).fetchall()

    result = {
        "dataset": dataset,
        "dataset_name": dataset_row["name"],
        "dataset_description": dataset_row["description"],
        "field": row["name"],
        "field_type": row["field_type"],
        "description": row["description"],
        "src_locator": locator,
        "source_file": {
            "id": row["source_file_id"],
            "original_name": row["original_name"],
            "src_type": row["src_type"],
            "sha256": row["sha256"],
        },
        "annotations": [dict(item) for item in annotations],
    }
    # 回源预览失败（定位失效/源文件缺失）不阻断字段详情，转为可读错误
    try:
        result["preview"] = field_preview(conn, dataset, field)
    except (LookupError, PreviewError) as exc:
        result["preview"] = {"error": str(exc)}
    return result


def trace_lineage(conn: sqlite3.Connection, args: dict) -> dict:
    dataset = _text(args, "dataset")
    field = _text(args, "field", required=False)
    direction = _direction(args)
    hops = _hops(args)
    try:
        graph = lineage_subgraph(conn, dataset, field, hops, direction)
    except LineageNotFound as exc:
        raise ToolError(str(exc)) from None
    except ValueError as exc:
        raise ToolError(str(exc)) from None
    return {
        "dataset": dataset,
        "field": field,
        "direction": direction,
        "hops": hops,
        "graph": graph,
    }


def get_field_history(conn: sqlite3.Connection, args: dict) -> dict:
    dataset = _text(args, "dataset")
    field = _text(args, "field")
    if conn.execute("SELECT 1 FROM field WHERE dataset_id=? AND name=?",
                    (dataset, field)).fetchone() is None:
        raise ToolError(f"字段「{dataset}.{field}」不存在")

    rows = conn.execute(
        "SELECT id, op, actor, created_at, before, after FROM change_log"
        " WHERE entity_kind='field' AND entity_key=?"
        " ORDER BY id DESC LIMIT ?",
        (f"{dataset}.{field}", MAX_HISTORY_ROWS)).fetchall()
    history = [{
        "id": row["id"],
        "op": row["op"],
        "actor": row["actor"],
        "created_at": row["created_at"],
        "before": load_snapshot(row["before"]),
        "after": load_snapshot(row["after"]),
    } for row in rows]
    return {"dataset": dataset, "field": field, "history": history}


TOOL_FUNCS = {
    "search_fields": search_fields,
    "get_field_details": get_field_details,
    "trace_lineage": trace_lineage,
    "get_field_history": get_field_history,
}


def run_tool(conn: sqlite3.Connection, name: str, args: dict | None) -> dict:
    """按名称执行工具；未知工具/非法参数抛 :class:`ToolError`。"""
    func = TOOL_FUNCS.get(name)
    if func is None:
        raise ToolError(f"未知工具「{name}」，可用工具：{', '.join(TOOL_FUNCS)}")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise ToolError("工具参数必须是 JSON 对象")
    return func(conn, args)
