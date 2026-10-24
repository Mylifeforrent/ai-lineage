"""M5 AI 演进回归测试：SSE 流式对话与 MCP 工具暴露。"""

from __future__ import annotations

import json

from tests.conftest import login, upload
from tests.fixtures import order_xlsx_bytes
from tests.test_m4_api import _configure_llm, _seed


def test_ai_chat_stream_sse_events(client, monkeypatch):
    """SSE 事件序列：tool（高亮声明）→ token（逐字）→ done（含 highlights）。"""
    headers = login(client)
    _seed(client, headers)
    _configure_llm(monkeypatch)

    calls: list[dict] = []

    def fake_stream_complete(messages, tools=None, on_delta=None):
        calls.append({"tools": tools})
        if len(messages) == 2:  # 第一轮：声明高亮（工具轮，不外发 token）
            return {"choices": [{"message": {
                "role": "assistant", "content": "",
                "tool_calls": [{"id": "c1", "type": "function",
                                "function": {"name": "mark_highlight",
                                             "arguments": json.dumps({"fields": [
                                                 {"dataset": "ods_order",
                                                  "field": "order_no"}]})}}]}}]}
        if on_delta is not None:
            on_delta("你好")
            on_delta("，世界")
        return {"choices": [{"message": {"role": "assistant",
                                         "content": "你好，世界"}}]}

    monkeypatch.setattr("lineagelite.ai.llm.stream_complete",
                        fake_stream_complete)

    r = client.post("/ai/chat/stream", headers=headers, json={
        "messages": [{"role": "user", "content": "高亮 order_no"}]})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/event-stream")

    events: list[dict] = []
    current: dict = {}
    for line in r.text.splitlines():
        if line.startswith("event: "):
            current = {"type": line[7:].strip()}
        elif line.startswith("data: "):
            current["data"] = json.loads(line[6:])
            events.append(current)
    assert [event["type"] for event in events] == ["tool", "token", "token", "done"]
    assert events[0]["data"]["tool"] == "mark_highlight"
    assert [e["data"]["delta"] for e in events[1:3]] == ["你好", "，世界"]
    done = events[3]["data"]
    assert done["answer"] == "你好，世界"
    assert done["highlights"] == [{"dataset": "ods_order", "field": "order_no"}]
    # 工具轮不外发 token；第 2 轮仍带 tools（仅第 6 次请求强制收口才不带）
    assert calls[0]["tools"] is not None
    assert calls[1]["tools"] is not None


def test_mcp_server_exposes_readonly_query_tools():
    """MCP server 只暴露 5 个查询工具（不暴露任何写候选/草稿能力）。"""
    import asyncio

    from lineagelite.ai.mcp_server import mcp

    tools = asyncio.run(mcp.list_tools())
    names = {tool.name for tool in tools}
    assert names == {
        "lineage_search_fields", "lineage_field_details", "lineage_trace",
        "lineage_field_history", "lineage_overview"}
