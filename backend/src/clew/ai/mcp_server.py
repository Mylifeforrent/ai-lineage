"""Clew MCP server（M5，演进规划 07 §4.6）。

把血缘查询能力以 Model Context Protocol（stdio 传输）暴露给外部 AI 客户端
（Claude Desktop / Cursor 等），复用与 REST API 相同的只读查询函数与同一 SQLite 库。

**只读边界**：仅暴露查询类工具；suggest/mark_highlight/描述草稿等写候选或草稿的
能力一律不暴露——外部 agent 不可触发任何写库（业务不变量#4 的延伸）。

运行::

    cd backend && uv run python -m clew.ai.mcp_server

客户端接入示例见 docs/03_dev/07_AI模块演进规划.md §4.6。
"""

from __future__ import annotations

import json

from mcp.server.mcpserver import MCPServer

from ..db import get_db
from .tools import get_field_details, get_field_history, search_fields, trace_lineage

mcp = MCPServer("clew")


@mcp.tool()
def lineage_search_fields(q: str) -> str:
    """按关键词模糊搜索字段（匹配数据集 ID/名称、字段名、字段描述与标注）。"""
    with get_db() as conn:
        result = search_fields(conn, {"q": q})
    return json.dumps(result, ensure_ascii=False)


@mcp.tool()
def lineage_field_details(dataset: str, field: str) -> str:
    """字段详情：类型、描述、源文件定位器、回源预览与标注历史。"""
    with get_db() as conn:
        result = get_field_details(conn, {"dataset": dataset, "field": field})
    return json.dumps(result, ensure_ascii=False, default=str)


@mcp.tool()
def lineage_trace(dataset: str, field: str | None = None,
                  direction: str = "both", hops: int = 3) -> str:
    """按数据集/字段追溯上下游 N 跳血缘子图（GraphPayload：datasets/edges）。"""
    with get_db() as conn:
        result = trace_lineage(conn, {"dataset": dataset, "field": field,
                                      "direction": direction, "hops": hops})
    return json.dumps(result, ensure_ascii=False)


@mcp.tool()
def lineage_field_history(dataset: str, field: str) -> str:
    """字段变更历史（change_log 倒序，最近 50 条）。"""
    with get_db() as conn:
        result = get_field_history(conn, {"dataset": dataset, "field": field})
    return json.dumps(result, ensure_ascii=False, default=str)


@mcp.tool()
def lineage_overview() -> str:
    """数据资产概览：数据集清单（含字段数）与血缘边统计。"""
    with get_db() as conn:
        datasets = [dict(row) for row in conn.execute(
            "SELECT d.id, COALESCE(d.name, '') AS name,"
            " (SELECT COUNT(*) FROM field f WHERE f.dataset_id=d.id) AS field_count"
            " FROM dataset d ORDER BY d.id").fetchall()]
        edges = conn.execute(
            "SELECT source, COUNT(*) AS count FROM edge GROUP BY source").fetchall()
    return json.dumps({
        "datasets": datasets,
        "edges_by_source": {row["source"]: row["count"] for row in edges},
    }, ensure_ascii=False)


if __name__ == "__main__":
    mcp.run()  # 默认 stdio 传输
