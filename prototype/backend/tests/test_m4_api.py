"""M4 验收：AI 状态/对话（function calling）与启发式血缘建议全流程。

覆盖接口：
- GET /ai/status（viewer+，未配置/已配置两种状态）
- POST /ai/chat（viewer+）：未配置 503、工具循环、tool_trace、graph 返回、
  工具错误回传、5 轮上限、LLM 上游错误 502
- POST /ai/suggest（editor+）：同名字段/包含关系/排除已存在边/落库 source='ai'
- POST /ai/suggest/confirm（editor+）：ai → manual + change_log(updated)
- POST /ai/suggest/reject（editor+）：删除 + change_log(deleted)

所有 LLM 调用均由 monkeypatch 替换（``lineagelite.ai.llm.complete``），
另有一条用例 monkeypatch ``urllib.request.urlopen`` 验证请求构造，全程不联网。
"""

import copy
import json
import sqlite3

import pytest

from lineagelite.config import db_path

from tests.conftest import create_user, login, upload
from tests.fixtures import order_xlsx_bytes, source_json_bytes, user_csv_bytes

EDGE_FIELDS = ("from_dataset", "from_field", "to_dataset", "to_field")


def _configure_llm(monkeypatch, base_url="https://llm.invalid/v1",
                   api_key="test-key", model="test-model") -> None:
    monkeypatch.setenv("LLM_BASE_URL", base_url)
    monkeypatch.setenv("LLM_API_KEY", api_key)
    monkeypatch.setenv("LLM_MODEL", model)


def _seed(client, headers) -> None:
    """上传三格式源文件并导入 4 个数据集 / 7 个字段 / 1 条字段级边。"""
    files = upload(client, headers, [
        ("订单明细.xlsx", order_xlsx_bytes(),
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("用户表.csv", user_csv_bytes(), "text/csv"),
        ("源.json", source_json_bytes(), "application/json"),
    ])
    source_ids = ",".join(str(f["id"]) for f in files)
    manifest = {
        "datasets": [
            {"dataset_id": "ods_order", "dataset_name": "订单原始",
             "field_name": "order_no", "field_type": "STRING",
             "src_file": "订单明细.xlsx", "src_type": "xlsx",
             "src_locator": {"sheet": "订单", "column": "C", "row_start": 3},
             "description": "订单号"},
            {"dataset_id": "ods_order", "dataset_name": "订单原始",
             "field_name": "user_name", "field_type": "STRING",
             "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"column": 2}, "description": "用户名"},
            {"dataset_id": "dwd_order", "dataset_name": "订单宽表",
             "field_name": "order_no", "field_type": "STRING",
             "src_file": "订单明细.xlsx", "src_type": "xlsx",
             "src_locator": {"sheet": "订单", "column": "C", "row_start": 3},
             "description": "宽表订单号"},
            {"dataset_id": "dwd_order", "dataset_name": "订单宽表",
             "field_name": "user_name", "field_type": "STRING",
             "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"column": 2}, "description": "宽表用户名"},
            {"dataset_id": "dws_order", "dataset_name": "订单汇总",
             "field_name": "ext_order_no", "field_type": "STRING",
             "src_file": "源.json", "src_type": "json",
             "src_locator": {"json_path": "$.data.items[*].order_no"},
             "description": "外部订单号"},
            {"dataset_id": "dim_user", "dataset_name": "用户维表",
             "field_name": "user_name", "field_type": "STRING",
             "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"column": 2}, "description": "维表用户名"},
            {"dataset_id": "dim_user", "dataset_name": "用户维表",
             "field_name": "user_id", "field_type": "STRING",
             "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"column": 1}, "description": "用户ID"},
        ],
        "lineage": [
            {"from_dataset": "ods_order", "from_field": "order_no",
             "to_dataset": "dwd_order", "to_field": "order_no",
             "transform": "trim/cast", "confidence": 1.0, "note": "已存在边"},
        ],
    }
    r = client.post(
        "/import", headers=headers,
        data={"format": "json", "source_file_ids": source_ids},
        files={"manifest": ("manifest.json",
                            json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
                            "application/json")})
    assert r.status_code == 201, r.text
    assert r.json()["report"]["summary"]["rejected"] == 0, r.text


def _db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    return conn


def _db_count(sql: str, args: tuple = ()) -> int:
    conn = _db_conn()
    try:
        return conn.execute(sql, args).fetchone()[0]
    finally:
        conn.close()


def _edge_row(from_dataset: str, from_field: str | None,
              to_dataset: str, to_field: str | None):
    conn = _db_conn()
    try:
        return conn.execute(
            "SELECT * FROM edge WHERE from_dataset=? AND from_field IS ?"
            " AND to_dataset=? AND to_field IS ?",
            (from_dataset, from_field, to_dataset, to_field)).fetchone()
    finally:
        conn.close()


def _candidate_payload(candidate: dict) -> dict:
    return {key: candidate[key] for key in EDGE_FIELDS}


def _final_answer(text: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": text},
                         "finish_reason": "stop"}]}


def _tool_round(calls: list[dict]) -> dict:
    return {"choices": [{
        "message": {"role": "assistant", "content": None, "tool_calls": calls},
        "finish_reason": "tool_calls",
    }]}


def _call(call_id: str, name: str, arguments: dict) -> dict:
    return {"id": call_id, "type": "function",
            "function": {"name": name,
                         "arguments": json.dumps(arguments, ensure_ascii=False)}}


# ---------- LLM 客户端（不联网） ----------

def test_llm_client_uses_openai_compatible_endpoint(monkeypatch):
    """monkeypatch urlopen，验证 URL/鉴权/请求体构造，实际不联网。"""
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.invalid/v1")
    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    monkeypatch.setenv("LLM_MODEL", "test-model")

    captured: dict = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def read(self):
            return (b'{"choices":[{"message":{"role":"assistant",'
                    b'"content":"ok"}}]}')

    def fake_urlopen(request, timeout=None):
        captured["url"] = request.full_url
        captured["headers"] = {key.lower(): value
                               for key, value in request.header_items()}
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(
        "lineagelite.ai.llm.urllib.request.urlopen", fake_urlopen)

    from lineagelite.ai import llm

    tools = [{"type": "function",
              "function": {"name": "search_fields", "parameters": {}}}]
    result = llm.complete([{"role": "user", "content": "hi"}], tools)
    assert result["choices"][0]["message"]["content"] == "ok"
    assert captured["url"] == "https://llm.invalid/v1/chat/completions"
    assert captured["headers"]["authorization"] == "Bearer sk-test"
    assert captured["headers"]["content-type"] == "application/json"
    assert captured["body"]["model"] == "test-model"
    assert captured["body"]["tools"] == tools
    assert captured["body"]["tool_choice"] == "auto"
    assert captured["timeout"] == llm.REQUEST_TIMEOUT_SECONDS

    # 已写全 /chat/completions 时不重复拼接；无 tools 时不发送 tools
    captured.clear()
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.invalid/v1/chat/completions")
    llm.complete([{"role": "user", "content": "hi"}], None)
    assert captured["url"] == "https://llm.invalid/v1/chat/completions"
    assert "tools" not in captured["body"]

    # 未配置（base_url 为空）→ LLMNotConfigured，不发起请求
    monkeypatch.setenv("LLM_BASE_URL", "")
    with pytest.raises(llm.LLMNotConfigured):
        llm.complete([{"role": "user", "content": "hi"}])


# ---------- 状态与未配置 ----------

def test_ai_status_and_chat_requires_configuration(client, monkeypatch):
    admin_headers = login(client)
    viewer_headers = create_user(client, admin_headers, "viewer_m4", "viewer")

    for key in ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"):
        monkeypatch.setenv(key, "")

    def forbidden(*args, **kwargs):
        raise AssertionError("未配置 LLM 时不应调用 LLM")

    monkeypatch.setattr("lineagelite.ai.llm.complete", forbidden)

    r = client.get("/ai/status", headers=viewer_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"configured": False, "model": None}
    assert client.get("/ai/status").status_code == 401

    r = client.post("/ai/chat", headers=viewer_headers,
                    json={"messages": [{"role": "user", "content": "你好"}]})
    assert r.status_code == 503, r.text
    assert r.json()["detail"].startswith("未配置 LLM")

    # 只配置 base_url + model（本地服务可不需要 API Key）即视为已配置
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.invalid/v1")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    assert client.get("/ai/status", headers=viewer_headers).json() == {
        "configured": True, "model": "test-model"}

    seen: dict = {}

    def fake_final(messages, tools=None):
        seen["messages"] = copy.deepcopy(messages)
        seen["tools"] = tools
        return _final_answer("你好，我是 LineageLite 助手。")

    monkeypatch.setattr("lineagelite.ai.llm.complete", fake_final)
    r = client.post("/ai/chat", headers=viewer_headers,
                    json={"messages": [{"role": "user", "content": "你好"}]})
    assert r.status_code == 200, r.text
    assert r.json() == {"answer": "你好，我是 LineageLite 助手。",
                        "tool_trace": []}
    # system 提示由后端固定，且本轮请求携带五个只读工具（含画布高亮信号）
    assert seen["messages"][0]["role"] == "system"
    assert {tool["function"]["name"] for tool in seen["tools"]} == {
        "search_fields", "get_field_details", "trace_lineage",
        "get_field_history", "mark_highlight"}


# ---------- 工具循环与出图 ----------

def test_ai_chat_tool_loop_returns_answer_and_graph(client, monkeypatch):
    headers = login(client)
    _seed(client, headers)
    _configure_llm(monkeypatch)

    calls: list[dict] = []

    def fake_complete(messages, tools=None):
        calls.append({"messages": copy.deepcopy(messages), "tools": tools})
        if len(calls) == 1:
            return _tool_round([
                _call("call_search", "search_fields", {"q": "order_no"}),
                _call("call_details", "get_field_details",
                      {"dataset": "ods_order", "field": "order_no"}),
                _call("call_history", "get_field_history",
                      {"dataset": "ods_order", "field": "order_no"}),
                _call("call_trace", "trace_lineage",
                      {"dataset": "dwd_order", "field": "order_no",
                       "direction": "up", "hops": 2}),
            ])
        return _final_answer("dwd_order.order_no 来自 ods_order.order_no。")

    monkeypatch.setattr("lineagelite.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=headers, json={
        "messages": [{"role": "user",
                      "content": "dwd_order 的 order_no 是从哪来的？"}],
        "focus": {"dataset": "dwd_order", "field": "order_no"},
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"] == "dwd_order.order_no 来自 ods_order.order_no。"
    assert body["tool_trace"] == [
        {"tool": "search_fields", "args": {"q": "order_no"}, "ok": True},
        {"tool": "get_field_details",
         "args": {"dataset": "ods_order", "field": "order_no"}, "ok": True},
        {"tool": "get_field_history",
         "args": {"dataset": "ods_order", "field": "order_no"}, "ok": True},
        {"tool": "trace_lineage",
         "args": {"dataset": "dwd_order", "field": "order_no",
                  "direction": "up", "hops": 2}, "ok": True},
    ]

    # graph 取最后一次 trace_lineage 的 GraphPayload
    graph = body["graph"]
    assert {dataset["id"] for dataset in graph["datasets"]} == {
        "dwd_order", "ods_order"}
    assert any(edge["from_dataset"] == "ods_order"
               and edge["to_dataset"] == "dwd_order"
               and edge["from_field"] == "order_no"
               and edge["to_field"] == "order_no"
               for edge in graph["edges"])

    # 第一次请求：system + user；第二次请求：追加 assistant 与 4 条 tool 消息
    first = calls[0]
    assert [message["role"] for message in first["messages"]] == [
        "system", "user"]
    assert "dwd_order" in first["messages"][0]["content"]
    assert first["tools"] is not None

    second = calls[1]
    assert second["tools"] is not None  # 仅用掉 1 轮，仍可继续调用工具
    tool_messages = [message for message in second["messages"]
                     if message["role"] == "tool"]
    assert [message["tool_call_id"] for message in tool_messages] == [
        "call_search", "call_details", "call_history", "call_trace"]
    search_result = json.loads(tool_messages[0]["content"])
    assert any(item["name"] == "order_no"
               for item in search_result["results"])
    details_result = json.loads(tool_messages[1]["content"])
    assert details_result["dataset"] == "ods_order"
    assert details_result["field"] == "order_no"
    assert details_result["preview"]["file"]["original_name"] == "订单明细.xlsx"
    history_result = json.loads(tool_messages[2]["content"])
    assert history_result["history"]
    assert history_result["history"][0]["op"] == "added"
    trace_result = json.loads(tool_messages[3]["content"])
    assert trace_result["graph"]["datasets"]


def test_ai_chat_mark_highlight_returns_highlights(client, monkeypatch):
    """mark_highlight 校验字段存在性并把去重后的字段放入 highlights。"""
    headers = login(client)
    _seed(client, headers)
    _configure_llm(monkeypatch)

    def fake_complete(messages, tools=None):
        if len(messages) == 2:
            return _tool_round([
                _call("call_mark", "mark_highlight", {"fields": [
                    {"dataset": "ods_order", "field": "order_no"},
                    # 重复项去重、不存在项忽略
                    {"dataset": "ods_order", "field": "order_no"},
                    {"dataset": "ods_order", "field": "no_such_field"},
                ]}),
            ])
        return _final_answer("已高亮 ods_order.order_no 的上下游。")

    monkeypatch.setattr("lineagelite.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=headers, json={
        "messages": [{"role": "user",
                      "content": "把 order_no 的上下游高亮出来"}],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"] == "已高亮 ods_order.order_no 的上下游。"
    assert body["highlights"] == [
        {"dataset": "ods_order", "field": "order_no"}]
    assert body["tool_trace"] == [
        {"tool": "mark_highlight",
         "args": {"fields": [
             {"dataset": "ods_order", "field": "order_no"},
             {"dataset": "ods_order", "field": "order_no"},
             {"dataset": "ods_order", "field": "no_such_field"}]},
         "ok": True},
    ]
    # graph 未返回时不应出现该键
    assert "graph" not in body


def test_ai_chat_mark_highlight_all_invalid_is_tool_error(client, monkeypatch):
    """fields 全部不存在时工具报错回传模型，不产生 highlights。"""
    headers = login(client)
    _seed(client, headers)
    _configure_llm(monkeypatch)

    def fake_complete(messages, tools=None):
        if len(messages) == 2:
            return _tool_round([
                _call("call_mark", "mark_highlight", {"fields": [
                    {"dataset": "no_ds", "field": "no_field"},
                ]}),
            ])
        return _final_answer("没有找到可高亮的字段。")

    monkeypatch.setattr("lineagelite.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=headers, json={
        "messages": [{"role": "user", "content": "高亮一下"}],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tool_trace"][0]["ok"] is False
    assert "highlights" not in body


def test_ai_chat_reports_tool_errors(client, monkeypatch):
    headers = login(client)
    _seed(client, headers)
    _configure_llm(monkeypatch)

    calls: list[dict] = []

    def fake_complete(messages, tools=None):
        calls.append(copy.deepcopy(messages))
        if len(calls) == 1:
            return _tool_round([
                _call("bad_tool", "no_such_tool", {}),
                _call("missing_field", "get_field_details",
                      {"dataset": "ods_order", "field": "missing"}),
            ])
        return _final_answer("没有找到该字段。")

    monkeypatch.setattr("lineagelite.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=headers, json={
        "messages": [{"role": "user", "content": "查一个不存在的字段"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [item["ok"] for item in body["tool_trace"]] == [False, False]
    assert "graph" not in body
    tool_messages = [message for message in calls[1]
                     if message["role"] == "tool"]
    errors = [json.loads(message["content"])["error"]
              for message in tool_messages]
    assert "未知工具" in errors[0]
    assert "不存在" in errors[1]


def test_ai_chat_stops_after_five_tool_rounds(client, monkeypatch):
    headers = login(client)
    _configure_llm(monkeypatch)

    calls: list = []

    def fake_complete(messages, tools=None):
        calls.append(tools)
        return _tool_round([
            _call(f"call_{len(calls)}", "search_fields", {"q": "x"})])

    monkeypatch.setattr("lineagelite.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=headers, json={
        "messages": [{"role": "user", "content": "一直查"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    # 最多执行 5 轮工具；第 6 次请求不带 tools，强制收口
    assert len(body["tool_trace"]) == 5
    assert len(calls) == 6
    assert all(tools is not None for tools in calls[:5])
    assert calls[-1] is None
    assert body["answer"] == ""


def test_ai_chat_maps_llm_error_to_502(client, monkeypatch):
    headers = login(client)
    _configure_llm(monkeypatch)

    from lineagelite.ai import llm

    def boom(messages, tools=None):
        raise llm.LLMError("上游超时")

    monkeypatch.setattr("lineagelite.ai.llm.complete", boom)

    r = client.post("/ai/chat", headers=headers, json={
        "messages": [{"role": "user", "content": "你好"}]})
    assert r.status_code == 502, r.text
    assert "上游超时" in r.json()["detail"]


# ---------- 启发式建议 ----------

def test_ai_suggest_heuristic_exact_containment_and_existing_edges(client):
    headers = login(client)
    _seed(client, headers)

    # 字段级：order_no 的唯一候选是包含关系（dwd_order.order_no 已有边，被排除）
    r = client.post("/ai/suggest", headers=headers,
                    json={"dataset": "ods_order", "field": "order_no"})
    assert r.status_code == 200, r.text
    candidates = r.json()["candidates"]
    assert len(candidates) == 1
    candidate = candidates[0]
    assert set(candidate) == {*EDGE_FIELDS, "confidence", "reason"}
    assert (candidate["from_dataset"], candidate["from_field"],
            candidate["to_dataset"], candidate["to_field"]) == (
        "ods_order", "order_no", "dws_order", "ext_order_no")
    assert candidate["confidence"] == 0.6
    assert "包含" in candidate["reason"]

    row = _edge_row("ods_order", "order_no", "dws_order", "ext_order_no")
    assert row is not None
    assert row["source"] == "ai" and row["confidence"] == 0.6
    assert _db_count(
        "SELECT COUNT(*) FROM change_log WHERE entity_kind='edge'"
        " AND entity_key=? AND op='added'",
        ("ods_order.order_no-->dws_order.ext_order_no",)) == 1

    # 数据集级：同名字段优先（0.7）；已存在的导入边与刚生成的 ai 边都排除
    r = client.post("/ai/suggest", headers=headers,
                    json={"dataset": "ods_order"})
    assert r.status_code == 200, r.text
    candidates = r.json()["candidates"]
    assert len(candidates) == 2
    assert all(item["confidence"] == 0.7 for item in candidates)
    assert all("同名" in item["reason"] for item in candidates)
    keys = {(item["from_dataset"], item["from_field"],
             item["to_dataset"], item["to_field"]) for item in candidates}
    assert keys == {
        ("ods_order", "user_name", "dwd_order", "user_name"),
        ("ods_order", "user_name", "dim_user", "user_name"),
    }
    assert ("ods_order", "order_no", "dwd_order", "order_no") not in keys

    # 重复调用：全部候选边已存在 → 不再落库
    r = client.post("/ai/suggest", headers=headers,
                    json={"dataset": "ods_order"})
    assert r.status_code == 200 and r.json()["candidates"] == []
    assert _db_count("SELECT COUNT(*) FROM edge WHERE source='ai'") == 3

    # 参数不存在
    assert client.post("/ai/suggest", headers=headers,
                       json={"dataset": "no_such"}).status_code == 404
    assert client.post("/ai/suggest", headers=headers,
                       json={"dataset": "ods_order",
                             "field": "no_such"}).status_code == 404


def test_ai_suggest_confirm_reject_flow_and_permissions(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "editor_m4", "editor")
    viewer_headers = create_user(client, admin_headers, "viewer_m4", "viewer")
    _seed(client, admin_headers)

    payload = {"dataset": "ods_order", "field": "user_name"}

    # viewer 无权建议/确认/拒绝；未认证 401
    assert client.post("/ai/suggest", headers=viewer_headers,
                       json=payload).status_code == 403
    assert client.post("/ai/suggest/confirm", headers=viewer_headers,
                       json={"from_dataset": "ods_order",
                             "from_field": "user_name",
                             "to_dataset": "dwd_order",
                             "to_field": "user_name"}).status_code == 403
    assert client.post("/ai/suggest/reject", headers=viewer_headers,
                       json={"from_dataset": "ods_order",
                             "from_field": "user_name",
                             "to_dataset": "dwd_order",
                             "to_field": "user_name"}).status_code == 403
    assert client.post("/ai/suggest", json=payload).status_code == 401

    # editor 生成两条同名字段候选
    r = client.post("/ai/suggest", headers=editor_headers, json=payload)
    assert r.status_code == 200, r.text
    candidates = r.json()["candidates"]
    assert len(candidates) == 2
    assert all(item["confidence"] == 0.7 for item in candidates)
    assert _db_count("SELECT COUNT(*) FROM edge WHERE source='ai'") == 2
    assert _db_count(
        "SELECT COUNT(*) FROM change_log WHERE entity_kind='edge'"
        " AND op='added'") == 3  # 1 条导入边 + 2 条 AI 候选

    confirm_target = next(item for item in candidates
                          if item["to_dataset"] == "dwd_order")
    reject_target = next(item for item in candidates
                         if item["to_dataset"] == "dim_user")

    # 确认：source ai → manual，写 updated 日志
    r = client.post("/ai/suggest/confirm", headers=editor_headers,
                    json=_candidate_payload(confirm_target))
    assert r.status_code == 200, r.text
    edge = r.json()["edge"]
    assert edge["source"] == "manual"
    assert isinstance(edge["id"], int)
    assert edge["confidence"] == 0.7
    assert _edge_row("ods_order", "user_name", "dwd_order",
                     "user_name")["source"] == "manual"

    logs = client.get(
        "/changes", headers=viewer_headers,
        params={"entity_kind": "edge",
                "entity_key": "ods_order.user_name-->dwd_order.user_name"}
    ).json()
    assert [item["op"] for item in logs[:2]] == ["updated", "added"]
    assert logs[0]["actor"] == "editor_m4"
    assert logs[0]["before"]["source"] == "ai"
    assert logs[0]["after"]["source"] == "manual"
    assert logs[1]["after"]["source"] == "ai"

    # 重复确认已转正的边 → 404（只允许操作 source='ai'）
    assert client.post("/ai/suggest/confirm", headers=editor_headers,
                       json=_candidate_payload(confirm_target)
                       ).status_code == 404

    # 拒绝：删除 ai 边，写 deleted 日志
    r = client.post("/ai/suggest/reject", headers=editor_headers,
                    json=_candidate_payload(reject_target))
    assert r.status_code == 204, r.text
    assert r.content == b""
    assert _edge_row("ods_order", "user_name", "dim_user", "user_name") is None
    logs = client.get(
        "/changes", headers=viewer_headers,
        params={"entity_kind": "edge",
                "entity_key": "ods_order.user_name-->dim_user.user_name"}
    ).json()
    assert [item["op"] for item in logs[:2]] == ["deleted", "added"]
    assert logs[0]["before"]["source"] == "ai"
    assert logs[0]["after"] is None

    # 非 AI 边不可确认/拒绝；混合字段 400
    imported = {"from_dataset": "ods_order", "from_field": "order_no",
                "to_dataset": "dwd_order", "to_field": "order_no"}
    assert client.post("/ai/suggest/confirm", headers=editor_headers,
                       json=imported).status_code == 404
    assert client.post("/ai/suggest/reject", headers=editor_headers,
                       json=imported).status_code == 404
    assert _edge_row("ods_order", "order_no", "dwd_order",
                     "order_no")["source"] == "imported"
    assert client.post("/ai/suggest/confirm", headers=editor_headers, json={
        "from_dataset": "ods_order", "from_field": None,
        "to_dataset": "dwd_order", "to_field": "user_name"}).status_code == 400
