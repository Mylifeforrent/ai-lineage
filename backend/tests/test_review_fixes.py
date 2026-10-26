"""评审修复回归（R1-R18）：边唯一约束、混合字段边、回滚外键冲突、角色即时生效、
清单行级解析错误、同上下游合并与重导入幂等、上传加固（R1-R7，2026-10-24 轮）；
AI 写类工具角色护栏、SSE 心跳与断开即停、上下文预算、AI 路由限流、草稿语言
（R8-R12，2026-10-26 轮，见 docs/03_dev/08_评审修复批次2026-10-26.md）。"""

import copy
import json
import sqlite3
import time

import pytest

from clew.ai import chat as chat_mod
from clew.config import db_path
from clew.routes import ai as ai_routes

from tests.conftest import csv_bytes, create_user, login, upload
from tests.fixtures import order_xlsx_bytes, source_json_bytes, user_csv_bytes
from tests.test_m4_api import (_call, _configure_llm, _final_answer, _seed,
                               _tool_round)


def _seed_sources(client, headers) -> None:
    upload(client, headers, [
        ("订单明细.xlsx", order_xlsx_bytes(),
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("用户表.csv", user_csv_bytes(), "text/csv"),
        ("源.json", source_json_bytes(), "application/json"),
    ])


def _import_json(client, headers, manifest: dict):
    return client.post("/import", headers=headers,
                       data={"format": "json", "source_file_ids": "1,2,3"},
                       files={"manifest": ("manifest.json",
                                           json.dumps(manifest, ensure_ascii=False).encode(),
                                           "application/json")})


def _import_csv(client, headers, ds_rows, edge_rows):
    return client.post("/import", headers=headers,
                       data={"format": "csv", "source_file_ids": "1,2,3"},
                       files={
                           "manifest_datasets": ("datasets.csv", csv_bytes(ds_rows), "text/csv"),
                           "manifest_lineage": ("lineage.csv", csv_bytes(edge_rows), "text/csv"),
                       })


def _db() -> sqlite3.Connection:
    return sqlite3.connect(db_path())


def _ods_user_manifest(transform: str = "trim") -> dict:
    return {
        "datasets": [
            {"dataset_id": "ods_user", "dataset_name": "用户表", "field_name": "user_id",
             "field_type": "INTEGER", "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"header": "user_id"}},
            {"dataset_id": "ods_user", "dataset_name": "用户表", "field_name": "user_name",
             "field_type": "STRING", "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"column": 2}},
        ],
        "lineage": [
            {"from_dataset": "ods_user", "from_field": "user_id",
             "to_dataset": "ods_user", "to_field": "user_name", "transform": transform},
        ],
    }


# ---------- R1：表级/字段级边的唯一约束（部分唯一索引） ----------

def test_r1_duplicate_edges_blocked_by_partial_unique_index(client):
    login(client)  # 触发 init_db 建库建索引
    ins = ("INSERT INTO edge(from_dataset, from_field, to_dataset, to_field,"
           " source, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
    ts = "2026-01-01T00:00:00+00:00"
    for key in [("A", None, "B", None),  # 表级边：UNIQUE 列含 NULL，靠 uq_edge_table 拦截
                ("A", "f", "B", "g")]:   # 字段级边：靠 uq_edge_field 拦截
        conn = _db()
        conn.execute(ins, (*key, "manual", ts, ts))
        try:
            conn.execute(ins, (*key, "manual", ts, ts))
            dup_ok = True
        except sqlite3.IntegrityError:
            dup_ok = False
        finally:
            conn.close()
        assert not dup_ok, f"自然键 {key} 的重复边未被拦截"


# ---------- R2：混合字段边整行拒绝 ----------

def test_r2_mixed_field_edge_rejected(client):
    headers = login(client)
    _seed_sources(client, headers)
    ds_rows = [
        ["dataset_id", "dataset_name", "field_name", "field_type", "src_file",
         "src_type", "src_locator", "description"],
        ["ods_raw", "订单明细", "order_no", "STRING", "订单明细.xlsx", "xlsx",
         json.dumps({"sheet": "订单", "header_path": ["商品信息", "订单号"],
                     "header_rows": 2, "row_start": 3}), "订单号"],
        ["dwd_order", "订单宽表", "order_no", "STRING", "订单明细.xlsx", "xlsx",
         json.dumps({"sheet": "订单", "column": "C", "row_start": 3}), "订单号宽表"],
    ]
    edge_rows = [
        ["from_dataset", "from_field", "to_dataset", "to_field", "transform",
         "confidence", "note"],
        ["ods_raw", "order_no", "dwd_order", "", "", "", ""],   # 只有上游字段：拒绝
        ["ods_raw", "", "dwd_order", "order_no", "", "", ""],   # 只有下游字段：拒绝
        ["ods_raw", "", "dwd_order", "", "", "", ""],           # 表级边：合法
        ["ods_raw", "order_no", "dwd_order", "order_no", "trim/cast", "1.0", ""],
    ]
    r = _import_csv(client, headers, ds_rows, edge_rows)
    assert r.status_code == 201, r.text
    report = r.json()["report"]
    assert report["summary"] == {"total": 6, "ok": 4, "merged": 0, "rejected": 2}
    rejected = [i for i in report["items"] if i["status"] == "rejected"]
    for item in rejected:
        assert item["kind"] == "edge"
        assert item["reason"] == "血缘边必须同时提供上下游字段（字段级）或都不提供（表级）"

    conn = _db()
    n_mixed = conn.execute(
        "SELECT COUNT(*) FROM edge WHERE (from_field IS NULL) != (to_field IS NULL)"
    ).fetchone()[0]
    n_table = conn.execute(
        "SELECT COUNT(*) FROM edge WHERE from_field IS NULL AND to_field IS NULL"
    ).fetchone()[0]
    conn.close()
    assert n_mixed == 0
    assert n_table == 1


# ---------- R3：按批次回滚遇外键引用 → 409 ----------

def test_r3_rollback_blocked_by_later_batch_fk(client):
    headers = login(client)
    _seed_sources(client, headers)

    # batch1：建 ods_user 两个字段
    r1 = _import_json(client, headers, {**_ods_user_manifest(), "lineage": []})
    assert r1.status_code == 201, r1.text
    batch1 = r1.json()["batch_id"]

    # batch2：边引用 batch1 新增的字段
    manifest2 = {
        "datasets": [],
        "lineage": [
            {"from_dataset": "ods_user", "from_field": "user_name",
             "to_dataset": "ods_user", "to_field": "user_id", "transform": "lookup"},
        ],
    }
    r2 = _import_json(client, headers, manifest2)
    assert r2.status_code == 201, r2.text
    batch2 = r2.json()["batch_id"]

    # 直接回滚 batch1：字段被 batch2 的边引用 → 409
    r = client.post(f"/import/batches/{batch1}/rollback", headers=headers)
    assert r.status_code == 409, r.text
    assert "请先回滚更晚的批次" in r.json()["detail"]

    # 先回滚 batch2（删边）再回滚 batch1 → 均成功，库中清理干净
    assert client.post(f"/import/batches/{batch2}/rollback",
                       headers=headers).status_code == 200
    assert client.post(f"/import/batches/{batch1}/rollback",
                       headers=headers).status_code == 200
    snap = client.get("/lineage/snapshot", headers=headers).json()
    assert snap["fields"] == []
    assert snap["datasets"] == []


# ---------- R4：角色变更即时生效 ----------

def test_r4_role_change_takes_effect_immediately(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "lisi", "editor")
    # 降级前 editor 可上传
    upload(client, editor_headers, [("用户表.csv", user_csv_bytes(), "text/csv")])

    # M1 暂无角色变更接口，直接改库模拟管理员把 lisi 降为 viewer
    conn = _db()
    conn.execute("UPDATE user SET role='viewer' WHERE username='lisi'")
    conn.commit()
    conn.close()

    # 旧 token（JWT 内仍声明 editor）再上传 → 以库中角色为准，403
    r = client.post("/files", headers=editor_headers,
                    files=[("files", ("x.csv", b"a,b\n1,2\n", "text/csv"))])
    assert r.status_code == 403, r.text


# ---------- R5：清单行级解析错误只拒绝该行 ----------

def test_r5_row_parse_error_rejects_row_not_batch(client):
    headers = login(client)
    _seed_sources(client, headers)
    manifest = {
        "datasets": [
            {"dataset_id": "ods_user", "dataset_name": "用户表", "field_name": "user_id",
             "field_type": "INTEGER", "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"header": "user_id"}},
            {"dataset_id": "ods_user", "dataset_name": "用户表", "field_name": "bad_loc",
             "field_type": "STRING", "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": "not-json"},
            {"dataset_id": "ods_user", "dataset_name": "用户表", "field_name": "user_name",
             "field_type": "STRING", "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"column": 2}},
        ],
        "lineage": [
            {"from_dataset": "ods_user", "from_field": "user_id",
             "to_dataset": "ods_user", "to_field": "user_name",
             "transform": "lookup", "confidence": "abc"},
            {"from_dataset": "ods_user", "from_field": "user_id",
             "to_dataset": "ods_user", "to_field": "user_name",
             "transform": "lookup2", "confidence": "1.0"},
        ],
    }
    r = _import_json(client, headers, manifest)
    assert r.status_code == 201, r.text  # 行级错误不整批 400
    report = r.json()["report"]
    assert report["summary"] == {"total": 5, "ok": 3, "merged": 0, "rejected": 2}
    bad_loc = next(i for i in report["items"] if i["ref"] == "ods_user.bad_loc")
    assert bad_loc["status"] == "rejected" and "src_locator" in bad_loc["reason"]
    bad_edge = next(i for i in report["items"]
                    if i["kind"] == "edge" and i["status"] == "rejected")
    assert "confidence" in bad_edge["reason"]

    # 合法行正常入库
    ods = client.get("/datasets/ods_user", headers=headers).json()
    assert [f["name"] for f in ods["fields"]] == ["user_id", "user_name"]


# ---------- R6：同上下游合并 / 重导入幂等 ----------

def test_r6_same_pair_different_transform_merged(client):
    headers = login(client)
    _seed_sources(client, headers)
    manifest = _ods_user_manifest()
    manifest["lineage"] = [
        {"from_dataset": "ods_user", "from_field": "user_id",
         "to_dataset": "ods_user", "to_field": "user_name", "transform": "t1"},
        {"from_dataset": "ods_user", "from_field": "user_id",
         "to_dataset": "ods_user", "to_field": "user_name", "transform": "t2"},
    ]
    r = _import_json(client, headers, manifest)
    assert r.status_code == 201, r.text
    assert r.json()["report"]["summary"]["merged"] == 1

    conn = _db()
    row = conn.execute(
        "SELECT transform FROM edge WHERE from_dataset='ods_user'"
        " AND from_field='user_id' AND to_dataset='ods_user' AND to_field='user_name'"
    ).fetchone()
    conn.close()
    assert row[0] == "t2"  # 库中为后到值


def test_r6_reimport_idempotent_no_change_log(client):
    headers = login(client)
    _seed_sources(client, headers)
    manifest = _ods_user_manifest()

    r1 = _import_json(client, headers, manifest)
    assert r1.status_code == 201, r1.text
    conn = _db()
    before = conn.execute("SELECT COUNT(*) FROM change_log").fetchone()[0]
    conn.close()

    r2 = _import_json(client, headers, manifest)
    assert r2.status_code == 201, r2.text
    report2 = r2.json()["report"]
    assert report2["items"]  # 非空且全部 ok + unchanged
    assert all(i["status"] == "ok" and i["reason"] == "unchanged"
               for i in report2["items"])

    conn = _db()
    after = conn.execute("SELECT COUNT(*) FROM change_log").fetchone()[0]
    conn.close()
    assert after == before  # 第二次导入未新增 change_log


# ---------- R7：上传加固 ----------

def test_r7_upload_empty_file_list_400(client):
    headers = login(client)
    r = client.post("/files", headers=headers)
    assert r.status_code == 400, r.text
    assert "至少上传一个文件" in r.json()["detail"]


def test_r7_upload_oversize_413(client, monkeypatch):
    monkeypatch.setenv("MAX_UPLOAD_MB", "1")
    headers = login(client)
    big = b"a,b\n" + b"1,2\n" * 300_000  # ≈1.4MB，超过 1MB 上限
    r = client.post("/files", headers=headers,
                    files=[("files", ("big.csv", big, "text/csv"))])
    assert r.status_code == 413, r.text


# ---------- R8：写类工具的 editor 角色护栏（08 号） ----------

def test_r8_suggest_lineage_denied_for_viewer_via_chat(client, monkeypatch):
    admin_headers = login(client)
    _seed(client, admin_headers)
    viewer_headers = create_user(client, admin_headers, "viewer_r8a", "viewer")
    editor_headers = create_user(client, admin_headers, "editor_r8a", "editor")
    _configure_llm(monkeypatch)
    ai_routes.ai_chat_limiter.reset()

    def fake_complete(messages, tools=None):
        if not any(m.get("role") == "tool" for m in messages):
            return _tool_round(
                [_call("call_suggest", "suggest_lineage",
                       {"dataset": "ods_order"})])
        return _final_answer("已请求血缘建议。")

    monkeypatch.setattr("clew.ai.llm.complete", fake_complete)

    # viewer：写类工具被角色护栏拒绝且不落库
    r = client.post("/ai/chat", headers=viewer_headers, json={
        "messages": [{"role": "user", "content": "帮我补充血缘"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tool_trace"][0]["tool"] == "suggest_lineage"
    assert body["tool_trace"][0]["ok"] is False
    conn = _db()
    assert conn.execute("SELECT COUNT(*) FROM edge WHERE source='ai'")\
        .fetchone()[0] == 0
    conn.close()

    # editor：同一输入正常落库（有同名字段 dim_user.user_name 可供建议）
    r2 = client.post("/ai/chat", headers=editor_headers, json={
        "messages": [{"role": "user", "content": "帮我补充血缘"}]})
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["tool_trace"][0]["ok"] is True
    assert body2.get("suggestions"), body2
    conn = _db()
    assert conn.execute("SELECT COUNT(*) FROM edge WHERE source='ai'")\
        .fetchone()[0] >= 1
    conn.close()


def test_r8_draft_descriptions_denied_for_viewer_via_chat(client, monkeypatch):
    admin_headers = login(client)
    viewer_headers = create_user(client, admin_headers, "viewer_r8b", "viewer")
    _configure_llm(monkeypatch)
    ai_routes.ai_chat_limiter.reset()

    def fake_complete(messages, tools=None):
        if not any(m.get("role") == "tool" for m in messages):
            return _tool_round(
                [_call("call_draft", "draft_descriptions",
                       {"dataset": "ods_order"})])
        return _final_answer("草稿需要更高权限。")

    monkeypatch.setattr("clew.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=viewer_headers, json={
        "messages": [{"role": "user", "content": "帮我生成描述"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tool_trace"][0]["tool"] == "draft_descriptions"
    assert body["tool_trace"][0]["ok"] is False
    assert "drafts" not in body
    conn = _db()
    assert conn.execute("SELECT COUNT(*) FROM description_draft")\
        .fetchone()[0] == 0
    conn.close()


# ---------- R9：断开即停 + SSE 心跳（08 号） ----------

def test_r9_cancel_stops_further_rounds(client):
    """should_interrupt 置位后：不再发起下一次 LLM 调用并抛 ChatInterrupted。"""
    client_fixture_guards_tmp_db = client  # noqa: F841——client 让 DATA_DIR 指向临时目录
    calls: list[list] = []

    def fake_complete(messages, tools=None):
        calls.append(copy.deepcopy(messages))
        return _tool_round([_call("call_mark", "mark_highlight",
                                  {"fields": [{"dataset": "zz", "field": "yy"}]})])

    with pytest.raises(chat_mod.ChatInterrupted):
        chat_mod._drive(
            [{"role": "user", "content": "持续给我查"}], None, "actor",
            "viewer", fake_complete, None,
            should_interrupt=lambda: len(calls) >= 1)

    assert len(calls) == 1, "中断后仍发起了后续 LLM 调用"


def test_r9_sse_ping_heartbeat(client, monkeypatch):
    admin_headers = login(client)
    _configure_llm(monkeypatch)
    monkeypatch.setattr(ai_routes, "PING_INTERVAL_SECONDS", 0.02)
    monkeypatch.setattr("clew.ai.llm.is_configured", lambda settings: True)
    ai_routes.ai_chat_limiter.reset()

    def fake_stream(messages, tools=None, on_delta=None):
        time.sleep(0.3)  # 期间事件队列为空，应出现心跳注释帧
        return _final_answer("流式回答完成。")

    monkeypatch.setattr("clew.ai.llm.stream_complete", fake_stream)

    with client.stream("POST", "/ai/chat/stream", headers=admin_headers,
                       json={"messages": [{"role": "user", "content": "hi"}]})\
            as response:
        assert response.status_code == 200, response
        body = response.read()
    assert b": ping" in body, body
    assert b"event: done" in body, body


# ---------- R10：工具结果截断 + 上下文预算（08 号） ----------

def test_r10_tool_result_truncated_before_feeding(client, monkeypatch):
    admin_headers = login(client)
    _seed(client, admin_headers)
    _configure_llm(monkeypatch)
    monkeypatch.setattr(chat_mod, "MAX_TOOL_RESULT_CHARS", 100)
    ai_routes.ai_chat_limiter.reset()

    captured: list[list] = []

    def fake_complete(messages, tools=None):
        captured.append(copy.deepcopy(messages))
        if not any(m.get("role") == "tool" for m in messages):
            return _tool_round([_call("call_details", "get_field_details",
                                      {"dataset": "ods_order",
                                       "field": "order_no"})])
        return _final_answer("已截断返回。")

    monkeypatch.setattr("clew.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=admin_headers, json={
        "messages": [{"role": "user", "content": "看看 order_no 的详情"}]})
    assert r.status_code == 200, r.text
    assert r.json()["tool_trace"][0]["ok"] is True

    tool_messages = [m for m in captured[1] if m.get("role") == "tool"]
    assert tool_messages, captured[1]
    content = tool_messages[0]["content"]
    assert "已截断" in content, content
    assert len(content) < 500, content  # 原始结果含 50 行预览，必然更长


def test_r10_context_budget_prunes_oldest_block(client, monkeypatch):
    monkeypatch.setenv("LLM_CONTEXT_TOKEN_BUDGET", "10")  # 极小，强制修剪
    admin_headers = login(client)
    _configure_llm(monkeypatch)
    ai_routes.ai_chat_limiter.reset()

    captured: list[list] = []

    def fake_complete(messages, tools=None):
        captured.append(copy.deepcopy(messages))
        if not any(m.get("role") == "tool" for m in messages):
            return _tool_round([_call("call_mark", "mark_highlight",
                                      {"fields": [{"dataset": "zz",
                                                   "field": "yy"}]})])
        return _final_answer("已修剪历史。")

    monkeypatch.setattr("clew.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=admin_headers, json={
        "messages": [
            {"role": "user", "content": "旧问题AAA这是一段足够长的旧上下文"},
            {"role": "assistant", "content": "旧回答BBB"},
            {"role": "user", "content": "新问题CCC"},
        ]})
    assert r.status_code == 200, r.text

    # 第二次调用时：system + 新问题块（含本轮 assistant/tool），旧块已整块删除
    second = captured[1]
    serialized = json.dumps(second, ensure_ascii=False)
    assert "旧问题AAA" not in serialized, serialized
    assert "新问题CCC" in serialized, serialized
    assert [m["role"] for m in second][0] == "system"
    assert second[1]["role"] == "user"


# ---------- R11：AI 路由限流（08 号） ----------

def test_r11_chat_rate_limit_429(client, monkeypatch):
    limiter_headers = create_user(client, login(client), "limit_user", "viewer")
    ai_routes.ai_chat_limiter.reset()
    # 限流依赖先于处理器执行：Handler 返回 503（未配置）的请求同样计数
    monkeypatch.setattr("clew.ai.llm.is_configured", lambda settings: False)

    for i in range(10):
        r = client.post("/ai/chat", headers=limiter_headers,
                        json={"messages": [{"role": "user",
                                            "content": f"第{i}问"}]})
        assert r.status_code == 503, (i, r.status_code, r.text)  # 未配置 LLM 优先于 429

    r_extra = client.post("/ai/chat", headers=limiter_headers,
                          json={"messages": [{"role": "user", "content": "第10问"}]})
    assert r_extra.status_code == 429, r_extra.text
    assert "频繁" in r_extra.json()["detail"]
    assert int(r_extra.headers["Retry-After"]) >= 1


def test_r11_suggest_rate_limit_429(client):
    editor_headers = create_user(client, login(client), "limit_editor", "editor")
    ai_routes.ai_suggest_limiter.reset()

    for i in range(6):
        r = client.post("/ai/suggest", headers=editor_headers,
                        json={"dataset": "no_such_ds"})
        assert r.status_code == 404, (i, r.status_code, r.text)  # 数据集不存在 → 404

    r_extra = client.post("/ai/suggest", headers=editor_headers,
                          json={"dataset": "no_such_ds"})
    assert r_extra.status_code == 429, r_extra.text


# ---------- R12：描述草稿 prompt 语言参数（08 号） ----------

def test_r12_draft_prompt_follows_lang(client, monkeypatch):
    admin_headers = login(client)
    _seed(client, admin_headers)
    editor_headers = create_user(client, admin_headers, "editor_r12", "editor")
    _configure_llm(monkeypatch)
    ai_routes.ai_chat_limiter.reset()

    prompts: list[str] = []

    def fake_complete(messages, tools=None):
        if len(messages) == 1 and messages[0].get("role") == "user":
            prompts.append(messages[0]["content"])  # 草稿生成调用（单条 user）
            return _final_answer("User id, first column of the CSV source.")
        if not any(m.get("role") == "tool" for m in messages):
            return _tool_round([_call("call_draft", "draft_descriptions",
                                      {"dataset": "ods_order",
                                       "fields": ["order_no"],
                                       "lang": "en"})])
        return _final_answer("草稿已生成。")

    monkeypatch.setattr("clew.ai.llm.complete", fake_complete)

    r = client.post("/ai/chat", headers=editor_headers, json={
        "messages": [{"role": "user", "content": "Draft a description in English"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["drafts"], body
    assert prompts, prompts
    assert "Write one sentence in English" in prompts[0], prompts[0]
    assert "data catalog writer" in prompts[0], prompts[0]
    assert body["drafts"][0]["draft"] == "User id, first column of the CSV source."
