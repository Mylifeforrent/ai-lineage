"""M3 验收：标注、字段/边人工编辑、变更历史、版本标签 diff 与幂等回滚。

覆盖接口：
- POST/GET /annotations（目标存在校验、只增不改）
- PATCH /fields/{ds}/{field}（定位器实文件核查与 resolved 重新物化）
- POST/PATCH/DELETE /edges（source=manual、自然键唯一、混合字段校验）
- GET /changes（过滤 + 倒序 + limit）
- POST/GET /version-tags、GET /version-tags/diff、POST /version-tags/{name}/rollback
- GraphPayload.edges[].id

权限：viewer 全写接口 403；标签回滚仅 admin。
所有数据通过正式上传 + 导入 API 入库。
"""

import json
import sqlite3

from clew.config import db_path

from tests.conftest import create_user, login, upload
from tests.fixtures import order_xlsx_bytes, user_csv_bytes

# 用户表.csv 表头：user_id,user_name,phone；订单明细.xlsx 的订单号在 C 列
XLSX_ORDER_LOCATOR = {"sheet": "订单", "column": "C", "row_start": 3}
CSV_USER_LOCATOR = {"column": 2}


def _seed(client, headers) -> str:
    """上传两类源文件并导入 3 个数据集 / 4 个字段 / 1 字段级边 + 1 表级边。"""
    files = upload(client, headers, [
        ("订单明细.xlsx", order_xlsx_bytes(),
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("用户表.csv", user_csv_bytes(), "text/csv"),
    ])
    source_ids = ",".join(str(f["id"]) for f in files)
    manifest = {
        "datasets": [
            {"dataset_id": "ods_order", "dataset_name": "订单原始",
             "field_name": "order_no", "field_type": "STRING",
             "src_file": "订单明细.xlsx", "src_type": "xlsx",
             "src_locator": XLSX_ORDER_LOCATOR, "description": "订单号"},
            {"dataset_id": "ods_order", "dataset_name": "订单原始",
             "field_name": "user_name", "field_type": "STRING",
             "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": CSV_USER_LOCATOR, "description": "用户名"},
            {"dataset_id": "dwd_order", "dataset_name": "订单宽表",
             "field_name": "order_no", "field_type": "STRING",
             "src_file": "订单明细.xlsx", "src_type": "xlsx",
             "src_locator": XLSX_ORDER_LOCATOR, "description": "宽表订单号"},
            {"dataset_id": "dwd_order", "dataset_name": "订单宽表",
             "field_name": "user_name", "field_type": "STRING",
             "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": CSV_USER_LOCATOR, "description": "宽表用户名"},
            {"dataset_id": "dim_user", "dataset_name": "用户维表",
             "field_name": "user_name", "field_type": "STRING",
             "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": CSV_USER_LOCATOR, "description": "维表用户名"},
        ],
        "lineage": [
            {"from_dataset": "ods_order", "from_field": "order_no",
             "to_dataset": "dwd_order", "to_field": "order_no",
             "transform": "trim/cast", "confidence": 1.0, "note": "导入字段级"},
            {"from_dataset": "ods_order", "from_field": None,
             "to_dataset": "dwd_order", "to_field": None,
             "transform": "table_projection", "confidence": 1.0,
             "note": "导入表级"},
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
    return source_ids


def _import_phone_field(client, headers, source_ids: str) -> None:
    """标签之后追加一次导入（用于验证标签回滚会反做导入批次日志）。"""
    manifest = {
        "datasets": [
            {"dataset_id": "ods_order", "dataset_name": "订单原始",
             "field_name": "phone", "field_type": "STRING",
             "src_file": "用户表.csv", "src_type": "csv",
             "src_locator": {"column": 3}, "description": "手机号"},
        ],
        "lineage": [],
    }
    r = client.post(
        "/import", headers=headers,
        data={"format": "json", "source_file_ids": source_ids},
        files={"manifest": ("manifest.json",
                            json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
                            "application/json")})
    assert r.status_code == 201, r.text
    assert r.json()["report"]["summary"]["rejected"] == 0, r.text


def _subgraph(client, headers, dataset: str = "ods_order", hops: int = 3) -> dict:
    r = client.get("/lineage/subgraph", headers=headers,
                   params={"dataset": dataset, "hops": hops})
    assert r.status_code == 200, r.text
    return r.json()


def _edge_id(client, headers, *, from_dataset: str, from_field: str | None,
             to_dataset: str, to_field: str | None) -> int:
    payload = _subgraph(client, headers)
    for edge in payload["edges"]:
        if (edge["from_dataset"] == from_dataset
                and edge["from_field"] == from_field
                and edge["to_dataset"] == to_dataset
                and edge["to_field"] == to_field):
            return edge["id"]
    raise AssertionError(f"未找到边 {from_dataset}.{from_field}-->"
                         f"{to_dataset}.{to_field}")


def _db_count(sql: str, args: tuple = ()) -> int:
    conn = sqlite3.connect(db_path())
    try:
        return conn.execute(sql, args).fetchone()[0]
    finally:
        conn.close()


def _max_change_id() -> int:
    return _db_count("SELECT COALESCE(MAX(id),0) FROM change_log")


# ---------- 标注 ----------

def test_annotations_append_only_and_target_validation(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "editor_m3", "editor")
    viewer_headers = create_user(client, admin_headers, "viewer_m3", "viewer")
    _seed(client, admin_headers)  # 触发建库并准备标注目标
    log_count = _db_count("SELECT COUNT(*) FROM change_log")

    targets = [
        ("dataset", "ods_order"),
        ("field", "ods_order.order_no"),
        ("edge", "ods_order.order_no-->dwd_order.order_no"),
        ("edge", "ods_order.*-->dwd_order.*"),
        ("edge", "ods_order-->dwd_order"),  # 表级简写
    ]
    created = []
    for kind, target_id in targets:
        r = client.post("/annotations", headers=editor_headers,
                        json={"target_kind": kind, "target_id": target_id,
                              "body": f"{kind} 说明"})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["author"] == "editor_m3"
        assert body["target_kind"] == kind and body["target_id"] == target_id
        created.append(body["id"])

    # 追加式：同一字段再写一条，旧记录仍原样保留
    r = client.post("/annotations", headers=editor_headers,
                    json={"target_kind": "field",
                          "target_id": "ods_order.order_no",
                          "body": "第二条说明"})
    assert r.status_code == 201, r.text
    rows = client.get("/annotations", headers=viewer_headers,
                      params={"target_kind": "field",
                              "target_id": "ods_order.order_no"}).json()
    assert [row["body"] for row in rows] == ["field 说明", "第二条说明"]
    assert [row["id"] for row in rows] == sorted(row["id"] for row in rows)
    assert len(client.get("/annotations", headers=viewer_headers).json()) == 6
    # 标注不写 change_log（只增不改、不随回滚删除）
    assert _db_count("SELECT COUNT(*) FROM change_log") == log_count
    # 没有标注更新/删除接口
    assert client.patch(f"/annotations/{created[0]}", headers=editor_headers,
                        json={"body": "修改"}).status_code in (404, 405)
    assert client.delete(f"/annotations/{created[0]}",
                         headers=editor_headers).status_code in (404, 405)

    # 三种目标不存在 → 404
    for kind, target_id in [
        ("dataset", "no_such"),
        ("field", "ods_order.no_such"),
        ("edge", "ods_order.no_such-->dwd_order.order_no"),
        ("edge", "no_such-->dwd_order"),
    ]:
        r = client.post("/annotations", headers=editor_headers,
                        json={"target_kind": kind, "target_id": target_id,
                              "body": "x"})
        assert r.status_code == 404, (kind, target_id, r.text)

    # 格式不合法 → 400
    for kind, target_id in [("field", "no_dot"), ("edge", "a->b")]:
        r = client.post("/annotations", headers=editor_headers,
                        json={"target_kind": kind, "target_id": target_id,
                              "body": "x"})
        assert r.status_code == 400, (kind, target_id, r.text)

    # 空白内容拒绝；viewer 可读不可写
    assert client.post("/annotations", headers=editor_headers,
                       json={"target_kind": "dataset", "target_id": "ods_order",
                             "body": "   "}).status_code == 400
    assert client.post("/annotations", headers=viewer_headers,
                       json={"target_kind": "dataset", "target_id": "ods_order",
                             "body": "x"}).status_code == 403
    assert client.get("/annotations", headers=viewer_headers).status_code == 200
    assert client.get("/annotations").status_code == 401


# ---------- 字段编辑 ----------

def test_patch_field_description_and_locator_recheck(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "editor_m3", "editor")
    viewer_headers = create_user(client, admin_headers, "viewer_m3", "viewer")
    _seed(client, admin_headers)

    # 改描述/类型
    r = client.patch("/fields/ods_order/user_name", headers=editor_headers,
                     json={"description": "人工修正", "field_type": "TEXT"})
    assert r.status_code == 200, r.text
    assert r.json()["description"] == "人工修正"
    assert r.json()["field_type"] == "TEXT"

    # 改定位器：column 2 → 3，必须重新做结构校验 + 实文件核查并物化 resolved
    r = client.patch("/fields/ods_order/user_name", headers=editor_headers,
                     json={"src_locator": {"column": 3}})
    assert r.status_code == 200, r.text
    locator = r.json()["src_locator"]
    assert locator["type"] == "csv"
    assert locator["input"] == {"column": 3}
    assert locator["resolved"]["column_index"] == 3
    assert locator["resolved"]["header"] == "phone"

    ds = client.get("/datasets/ods_order", headers=editor_headers).json()
    field = next(f for f in ds["fields"] if f["name"] == "user_name")
    assert field["description"] == "人工修正"
    assert field["src_locator"]["resolved"]["column_index"] == 3

    # change_log：同一实体两条 updated，倒序且 actor 正确
    rows = client.get("/changes", headers=editor_headers,
                      params={"entity_kind": "field",
                              "entity_key": "ods_order.user_name"}).json()
    assert [row["op"] for row in rows[:2]] == ["updated", "updated"]
    assert rows[0]["actor"] == "editor_m3"
    assert rows[0]["before"]["src_locator"] != rows[0]["after"]["src_locator"]
    assert rows[1]["before"]["description"] == "用户名"

    # 实文件核查失败 → 409，字段保持原值
    r = client.patch("/fields/ods_order/user_name", headers=editor_headers,
                     json={"src_locator": {"column": 99}})
    assert r.status_code == 409, r.text
    assert "实文件核查失败" in r.json()["detail"]
    assert "超出源文件列数" in r.json()["detail"]
    ds = client.get("/datasets/ods_order", headers=editor_headers).json()
    assert next(f for f in ds["fields"]
                if f["name"] == "user_name")["src_locator"]["resolved"]["column_index"] == 3

    # 结构校验失败 / 类型不一致 → 409
    r = client.patch("/fields/ods_order/user_name", headers=editor_headers,
                     json={"src_locator": {"column": 0}})
    assert r.status_code == 409 and "结构校验失败" in r.json()["detail"]
    r = client.patch("/fields/ods_order/user_name", headers=editor_headers,
                     json={"src_locator": {"type": "json",
                                           "input": {"json_path": "$"}}})
    assert r.status_code == 409 and "不一致" in r.json()["detail"]

    # 参数/权限/不存在
    assert client.patch("/fields/ods_order/user_name", headers=editor_headers,
                        json={}).status_code == 400
    assert client.patch("/fields/ods_order/user_name", headers=editor_headers,
                        json={"src_locator": None}).status_code == 400
    assert client.patch("/fields/ods_order/no_such", headers=editor_headers,
                        json={"description": "x"}).status_code == 404
    assert client.patch("/fields/ods_order/user_name", headers=viewer_headers,
                        json={"description": "x"}).status_code == 403
    assert client.patch("/fields/ods_order/user_name",
                        json={"description": "x"}).status_code == 401


# ---------- 边编辑 ----------

def test_edge_crud_natural_key_and_changes(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "editor_m3", "editor")
    viewer_headers = create_user(client, admin_headers, "viewer_m3", "viewer")
    _seed(client, admin_headers)

    # 新增字段级人工边
    r = client.post("/edges", headers=editor_headers, json={
        "from_dataset": "ods_order", "from_field": "user_name",
        "to_dataset": "dim_user", "to_field": "user_name",
        "transform": "lookup", "confidence": 0.8, "note": "人工补边",
    })
    assert r.status_code == 201, r.text
    edge = r.json()
    edge_id = edge["id"]
    assert isinstance(edge_id, int) and edge["source"] == "manual"
    assert edge["confidence"] == 0.8

    # 同自然键重复 → 409
    r = client.post("/edges", headers=editor_headers, json={
        "from_dataset": "ods_order", "from_field": "user_name",
        "to_dataset": "dim_user", "to_field": "user_name"})
    assert r.status_code == 409, r.text

    # 新增表级人工边；重复同样 409
    table_payload = {"from_dataset": "dwd_order", "to_dataset": "dim_user"}
    r = client.post("/edges", headers=editor_headers, json=table_payload)
    assert r.status_code == 201, r.text
    assert r.json()["from_field"] is None and r.json()["to_field"] is None
    assert isinstance(r.json()["id"], int)
    assert client.post("/edges", headers=editor_headers,
                       json=table_payload).status_code == 409

    # 混合字段边 / 引用不存在 → 400 / 404
    for payload in [
        {"from_dataset": "ods_order", "from_field": "order_no",
         "to_dataset": "dim_user", "to_field": None},
        {"from_dataset": "ods_order", "from_field": None,
         "to_dataset": "dim_user", "to_field": "user_name"},
    ]:
        r = client.post("/edges", headers=editor_headers, json=payload)
        assert r.status_code == 400, r.text
        assert "同时提供上下游字段" in r.json()["detail"]
    assert client.post("/edges", headers=editor_headers, json={
        "from_dataset": "no_such", "to_dataset": "dim_user"}).status_code == 404
    assert client.post("/edges", headers=editor_headers, json={
        "from_dataset": "ods_order", "from_field": "no_such",
        "to_dataset": "dim_user", "to_field": "user_name"}).status_code == 404

    # PATCH：改 transform/note/confidence，写 updated 日志
    r = client.patch(f"/edges/{edge_id}", headers=editor_headers,
                     json={"transform": "lookup/cast", "confidence": 0.5,
                           "note": "修正"})
    assert r.status_code == 200, r.text
    assert r.json()["transform"] == "lookup/cast"
    assert r.json()["confidence"] == 0.5
    assert r.json()["source"] == "manual"

    rows = client.get("/changes", headers=editor_headers,
                      params={"entity_kind": "edge",
                              "entity_key": "ods_order.user_name-->dim_user.user_name"}
                      ).json()
    assert rows[0]["op"] == "updated"
    assert rows[0]["before"]["transform"] == "lookup"
    assert rows[0]["after"]["transform"] == "lookup/cast"
    assert rows[0]["actor"] == "editor_m3"

    # 置信度边界 / 空 patch / 不存在
    assert client.patch(f"/edges/{edge_id}", headers=editor_headers,
                        json={"confidence": 1.5}).status_code == 422
    assert client.patch(f"/edges/{edge_id}", headers=editor_headers,
                        json={"confidence": None}).status_code == 400
    assert client.patch(f"/edges/{edge_id}", headers=editor_headers,
                        json={}).status_code == 400
    assert client.patch("/edges/99999", headers=editor_headers,
                        json={"note": "x"}).status_code == 404

    # DELETE 导入的表级边 → 204，写 deleted 日志，重复删除 404
    imported_table_edge = _edge_id(
        client, editor_headers, from_dataset="ods_order", from_field=None,
        to_dataset="dwd_order", to_field=None)
    assert client.delete(f"/edges/{imported_table_edge}",
                         headers=editor_headers).status_code == 204
    assert client.delete(f"/edges/{imported_table_edge}",
                         headers=editor_headers).status_code == 404
    rows = client.get("/changes", headers=editor_headers,
                      params={"entity_kind": "edge",
                              "entity_key": "ods_order.*-->dwd_order.*"}).json()
    assert rows[0]["op"] == "deleted"
    assert rows[0]["before"]["transform"] == "table_projection"
    assert rows[0]["after"] is None

    # viewer 全写接口 403（角色守卫先于目标存在性检查）
    assert client.post("/edges", headers=viewer_headers,
                       json={"from_dataset": "ods_order",
                             "to_dataset": "dim_user"}).status_code == 403
    assert client.patch(f"/edges/{edge_id}", headers=viewer_headers,
                        json={"note": "x"}).status_code == 403
    assert client.delete(f"/edges/{edge_id}",
                         headers=viewer_headers).status_code == 403


def test_graph_payload_edges_include_unique_id(client):
    headers = login(client)
    _seed(client, headers)
    payload = _subgraph(client, headers)
    ids = [edge["id"] for edge in payload["edges"]]
    assert len(ids) == len(set(ids)) == 2
    assert all(isinstance(edge_id, int) for edge_id in ids)


# ---------- 变更历史 ----------

def test_changes_filter_order_limit_and_permissions(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "editor_m3", "editor")
    viewer_headers = create_user(client, admin_headers, "viewer_m3", "viewer")
    _seed(client, admin_headers)

    assert client.post("/edges", headers=editor_headers, json={
        "from_dataset": "ods_order", "from_field": "user_name",
        "to_dataset": "dim_user", "to_field": "user_name"}).status_code == 201
    for description in ("第一次修正", "第二次修正"):
        assert client.patch("/fields/ods_order/order_no", headers=editor_headers,
                            json={"description": description}).status_code == 200

    rows = client.get("/changes", headers=viewer_headers,
                      params={"entity_kind": "field",
                              "entity_key": "ods_order.order_no"}).json()
    assert len(rows) == 3  # 导入 added + 两次人工 updated
    assert [row["op"] for row in rows[:2]] == ["updated", "updated"]
    assert [row["id"] for row in rows] == sorted(
        (row["id"] for row in rows), reverse=True)
    assert set(rows[0]) == {"id", "op", "before", "after", "actor", "created_at"}
    assert isinstance(rows[0]["before"], dict)
    assert isinstance(rows[0]["after"], dict)

    limited = client.get("/changes", headers=viewer_headers,
                         params={"limit": 1}).json()
    assert len(limited) == 1
    assert limited[0]["id"] == max(row["id"] for row in rows)

    edge_rows = client.get(
        "/changes", headers=viewer_headers,
        params={"entity_kind": "edge",
                "entity_key": "ods_order.user_name-->dim_user.user_name"}).json()
    assert [row["op"] for row in edge_rows] == ["added"]

    # 参数与认证
    assert client.get("/changes", headers=viewer_headers,
                      params={"entity_kind": "tag"}).status_code == 422
    assert client.get("/changes", headers=viewer_headers,
                      params={"limit": 0}).status_code == 422
    assert client.get("/changes").status_code == 401


# ---------- 版本标签 ----------

def test_version_tags_create_list_and_diff(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "editor_m3", "editor")
    viewer_headers = create_user(client, admin_headers, "viewer_m3", "viewer")
    _seed(client, admin_headers)

    before_count = _db_count("SELECT COUNT(*) FROM change_log")
    base_seq = _max_change_id()
    r = client.post("/version-tags", headers=editor_headers,
                    json={"name": "base", "note": "基线"})
    assert r.status_code == 201, r.text
    tag = r.json()
    assert tag["name"] == "base" and tag["note"] == "基线"
    assert tag["change_seq"] == base_seq
    assert tag["created_by"] == "editor_m3"
    # 标签创建以 created_by 留痕，不写入 change_log（避免回滚删除标签）
    assert _db_count("SELECT COUNT(*) FROM change_log") == before_count

    assert client.post("/version-tags", headers=editor_headers,
                       json={"name": "base"}).status_code == 409
    assert client.post("/version-tags", headers=viewer_headers,
                       json={"name": "forbidden"}).status_code == 403

    base_list = client.get("/version-tags", headers=viewer_headers).json()
    assert [row["name"] for row in base_list] == ["base"]

    # 标签后：1 次字段更新 + 1 条新边 + 1 条导入边删除
    assert client.patch("/fields/ods_order/order_no", headers=editor_headers,
                        json={"description": "修正后"}).status_code == 200
    r = client.post("/edges", headers=editor_headers, json={
        "from_dataset": "ods_order", "from_field": "user_name",
        "to_dataset": "dim_user", "to_field": "user_name"})
    assert r.status_code == 201, r.text
    imported_table_edge = _edge_id(
        client, admin_headers, from_dataset="ods_order", from_field=None,
        to_dataset="dwd_order", to_field=None)
    assert client.delete(f"/edges/{imported_table_edge}",
                         headers=editor_headers).status_code == 204

    r = client.post("/version-tags", headers=editor_headers,
                    json={"name": "next"})
    assert r.status_code == 201, r.text
    assert r.json()["change_seq"] > base_seq
    assert [row["name"] for row in
            client.get("/version-tags", headers=viewer_headers).json()] == ["base", "next"]

    diff = client.get("/version-tags/diff", headers=viewer_headers,
                      params={"from": "base", "to": "next"}).json()
    assert diff["summary"] == {"added": 1, "updated": 1, "deleted": 1}
    ops = {(item["entity_kind"], item["entity_key"]): item["op"]
           for item in diff["items"]}
    assert ops == {
        ("field", "ods_order.order_no"): "updated",
        ("edge", "ods_order.user_name-->dim_user.user_name"): "added",
        ("edge", "ods_order.*-->dwd_order.*"): "deleted",
    }
    for item in diff["items"]:
        if item["op"] == "added":
            assert item["before"] is None and item["after"] is not None
        elif item["op"] == "deleted":
            assert item["before"] is not None and item["after"] is None
        else:
            assert item["before"]["description"] == "订单号"
            assert item["after"]["description"] == "修正后"

    # 不存在的标签 / 顺序颠倒
    assert client.get("/version-tags/diff", headers=viewer_headers,
                      params={"from": "no_such", "to": "next"}).status_code == 404
    assert client.get("/version-tags/diff", headers=viewer_headers,
                      params={"from": "next", "to": "base"}).status_code == 400


def test_rollback_to_tag_is_idempotent_and_keeps_annotations(client):
    admin_headers = login(client)
    editor_headers = create_user(client, admin_headers, "editor_m3", "editor")
    viewer_headers = create_user(client, admin_headers, "viewer_m3", "viewer")
    source_ids = _seed(client, admin_headers)

    base_seq = _max_change_id()
    r = client.post("/version-tags", headers=admin_headers,
                    json={"name": "base", "note": "回滚基线"})
    assert r.status_code == 201, r.text
    baseline = client.get("/lineage/snapshot", headers=admin_headers).json()

    imported_field_edge = _edge_id(
        client, admin_headers, from_dataset="ods_order", from_field="order_no",
        to_dataset="dwd_order", to_field="order_no")
    imported_table_edge = _edge_id(
        client, admin_headers, from_dataset="ods_order", from_field=None,
        to_dataset="dwd_order", to_field=None)

    # 标签后的变更：字段 updated / 边 added / 边 updated / 边 deleted / 导入批次 added
    assert client.patch("/fields/ods_order/user_name", headers=editor_headers,
                        json={"description": "改坏", "src_locator": {"column": 3}}
                        ).status_code == 200
    r = client.post("/edges", headers=editor_headers, json={
        "from_dataset": "ods_order", "from_field": "user_name",
        "to_dataset": "dim_user", "to_field": "user_name"})
    assert r.status_code == 201, r.text
    assert client.patch(f"/edges/{imported_field_edge}", headers=editor_headers,
                        json={"transform": "改坏", "confidence": 0.3}
                        ).status_code == 200
    assert client.delete(f"/edges/{imported_table_edge}",
                         headers=editor_headers).status_code == 204
    _import_phone_field(client, admin_headers, source_ids)
    # 标注在标签之后写入：不写 change_log，也不随回滚删除
    assert client.post("/annotations", headers=editor_headers,
                       json={"target_kind": "dataset", "target_id": "ods_order",
                             "body": "回滚也要保留"}).status_code == 201

    expected_reverted = _max_change_id() - base_seq
    assert expected_reverted == 5
    log_count_before_rollback = _db_count("SELECT COUNT(*) FROM change_log")

    # 仅 admin 可回滚
    assert client.post("/version-tags/base/rollback",
                       headers=editor_headers).status_code == 403
    assert client.post("/version-tags/base/rollback",
                       headers=viewer_headers).status_code == 403
    assert client.post("/version-tags/no_such/rollback",
                       headers=admin_headers).status_code == 404

    r = client.post("/version-tags/base/rollback", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"reverted": expected_reverted}

    # 数据回到打标签时；字段定位器/描述一并恢复
    assert client.get("/lineage/snapshot", headers=admin_headers).json() == baseline
    ds = client.get("/datasets/ods_order", headers=admin_headers).json()
    assert [f["name"] for f in ds["fields"]] == ["order_no", "user_name"]
    user_name = next(f for f in ds["fields"] if f["name"] == "user_name")
    assert user_name["description"] == "用户名"
    assert user_name["src_locator"]["resolved"]["column_index"] == 2
    payload = _subgraph(client, admin_headers)
    field_edge = next(e for e in payload["edges"]
                      if e["from_field"] == "order_no" and e["to_field"] == "order_no")
    assert field_edge["transform"] == "trim/cast"
    assert field_edge["confidence"] == 1.0
    assert any(e["from_field"] is None and e["to_field"] is None
               for e in payload["edges"])

    # 回滚本身不写 change_log（否则重复回滚会反做回滚日志）；审计落 rollback_record
    assert _db_count("SELECT COUNT(*) FROM change_log") == log_count_before_rollback
    assert _db_count("SELECT COUNT(*) FROM rollback_record") == 1
    annotations = client.get("/annotations", headers=viewer_headers,
                             params={"target_kind": "dataset",
                                     "target_id": "ods_order"}).json()
    assert [row["body"] for row in annotations] == ["回滚也要保留"]

    # 重复回滚安全：已反做日志被跳过，reverted=0 且状态不变，追加审计
    r = client.post("/version-tags/base/rollback", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"reverted": 0}
    assert client.get("/lineage/snapshot", headers=admin_headers).json() == baseline
    assert _db_count("SELECT COUNT(*) FROM rollback_record") == 2
    assert _db_count(
        "SELECT COUNT(*) FROM rollback_record WHERE actor=? AND tag_name=?",
        ("admin", "base")) == 2


# ---------- 权限矩阵 ----------

def test_viewer_read_only_on_all_m3_endpoints(client):
    admin_headers = login(client)
    viewer_headers = create_user(client, admin_headers, "viewer_m3", "viewer")
    _seed(client, admin_headers)

    assert client.get("/annotations", headers=viewer_headers).status_code == 200
    assert client.get("/changes", headers=viewer_headers).status_code == 200
    assert client.get("/version-tags", headers=viewer_headers).status_code == 200
    assert client.get("/version-tags/diff", headers=viewer_headers,
                      params={"from": "a", "to": "b"}).status_code == 404

    assert client.post("/annotations", headers=viewer_headers, json={
        "target_kind": "dataset", "target_id": "ods_order", "body": "x"}).status_code == 403
    assert client.patch("/fields/ods_order/order_no", headers=viewer_headers,
                        json={"description": "x"}).status_code == 403
    assert client.post("/edges", headers=viewer_headers, json={
        "from_dataset": "ods_order", "to_dataset": "dim_user"}).status_code == 403
    assert client.patch("/edges/1", headers=viewer_headers,
                        json={"note": "x"}).status_code == 403
    assert client.delete("/edges/1", headers=viewer_headers).status_code == 403
    assert client.post("/version-tags", headers=viewer_headers,
                       json={"name": "x"}).status_code == 403
    assert client.post("/version-tags/x/rollback",
                       headers=viewer_headers).status_code == 403
