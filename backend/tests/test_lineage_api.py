"""M2 验收：递归 CTE 子图、字段种子语义、三格式源文件回源预览。

链路固定为 d0→d1→d2→d3→d4，每跳同时包含 1 条字段级边与 1 条表级边；
所有数据均通过正式上传 + 导入 API 入库。
"""

import json
import sqlite3

from lineagelite.config import db_path

from tests.conftest import create_user, login, upload
from tests.fixtures import order_xlsx_bytes, source_json_bytes, user_csv_bytes

CHAIN = ["d0", "d1", "d2", "d3", "d4"]

# 与 tests/fixtures.py 中 order_xlsx_bytes 的表头一致
ORDER_XLSX_HEADER_PATH = ["商品信息", "订单号"]


def _chain_manifest() -> dict:
    datasets = []
    for index, dataset_id in enumerate(CHAIN):
        locator = ({"sheet": "订单", "header_path": ORDER_XLSX_HEADER_PATH,
                    "header_rows": 2, "row_start": 3}
                   if index == 0 else
                   {"sheet": "订单", "column": "C", "row_start": 3})
        datasets.append({
            "dataset_id": dataset_id, "dataset_name": f"链路{dataset_id}",
            "field_name": "order_no", "field_type": "STRING",
            "src_file": "订单明细.xlsx", "src_type": "xlsx",
            "src_locator": locator, "description": "订单号",
        })
        datasets.append({
            "dataset_id": dataset_id, "dataset_name": f"链路{dataset_id}",
            "field_name": "user_name", "field_type": "STRING",
            "src_file": "用户表.csv", "src_type": "csv",
            "src_locator": {"column": 2}, "description": "用户名",
        })
    datasets.append({
        "dataset_id": "d0", "dataset_name": "链路d0",
        "field_name": "ext_order_no", "field_type": "STRING",
        "src_file": "源.json", "src_type": "json",
        "src_locator": {"json_path": "$.data.items[*].order_no"},
        "description": "外部订单号",
    })

    lineage = []
    for i in range(len(CHAIN) - 1):
        lineage.append({
            "from_dataset": CHAIN[i], "from_field": "order_no",
            "to_dataset": CHAIN[i + 1], "to_field": "order_no",
            "transform": "trim/cast", "confidence": 1.0, "note": "字段级",
        })
        lineage.append({
            "from_dataset": CHAIN[i], "from_field": None,
            "to_dataset": CHAIN[i + 1], "to_field": None,
            "transform": "table_projection", "confidence": 1.0, "note": "表级",
        })
    return {"datasets": datasets, "lineage": lineage}


def _upload_sources(client, headers) -> list[dict]:
    return upload(client, headers, [
        ("订单明细.xlsx", order_xlsx_bytes(),
         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        ("用户表.csv", user_csv_bytes(), "text/csv"),
        ("源.json", source_json_bytes(), "application/json"),
    ])


def _import_manifest(client, headers, manifest: dict, source_files: list[dict]):
    # 使用上传响应中的真实 ID，避免依赖临时库的自增顺序
    source_file_ids = ",".join(str(f["id"]) for f in source_files)
    return client.post(
        "/import", headers=headers,
        data={"format": "json", "source_file_ids": source_file_ids},
        files={"manifest": ("manifest.json",
                            json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
                            "application/json")})


def _seed_chain(client, headers) -> None:
    source_files = _upload_sources(client, headers)
    r = _import_manifest(client, headers, _chain_manifest(), source_files)
    assert r.status_code == 201, r.text
    assert r.json()["report"]["summary"]["rejected"] == 0, r.text


def _subgraph(client, headers, **params):
    return client.get("/lineage/subgraph", headers=headers, params=params)


def _dataset_ids(payload: dict) -> list[str]:
    return [d["id"] for d in payload["datasets"]]


# ---------- 数据集种子：跳数与方向 ----------

def test_dataset_seed_hops_3_covers_whole_chain(client):
    headers = login(client)
    _seed_chain(client, headers)

    r = _subgraph(client, headers, dataset="d1", hops=3)
    assert r.status_code == 200, r.text
    payload = r.json()
    assert _dataset_ids(payload) == CHAIN  # d1 出发 3 跳恰好覆盖 d0..d4
    assert len(payload["edges"]) == 8  # 4 条字段级 + 4 条表级
    assert all(d["fields"] for d in payload["datasets"])


def test_dataset_seed_hops_1_and_direction_up(client):
    headers = login(client)
    _seed_chain(client, headers)

    r = _subgraph(client, headers, dataset="d1", hops=1)
    assert r.status_code == 200, r.text
    assert _dataset_ids(r.json()) == ["d0", "d1", "d2"]

    r = _subgraph(client, headers, dataset="d1", hops=3, direction="up")
    assert r.status_code == 200, r.text
    payload = r.json()
    assert _dataset_ids(payload) == ["d0", "d1"]  # 上游只到 d0
    assert len(payload["edges"]) == 2  # d0→d1 的字段级 + 表级


# ---------- 字段种子：字段级边传播 + 表级边全连通 ----------

def test_field_seed_propagates_along_field_edges(client):
    headers = login(client)
    _seed_chain(client, headers)

    up = _subgraph(client, headers, dataset="d1", field="order_no",
                   hops=1, direction="up")
    assert up.status_code == 200, up.text
    assert _dataset_ids(up.json()) == ["d0", "d1"]

    down = _subgraph(client, headers, dataset="d1", field="order_no",
                     hops=2, direction="down")
    assert down.status_code == 200, down.text
    assert _dataset_ids(down.json()) == ["d1", "d2", "d3"]


def test_field_seed_table_edge_connects_all_fields(client):
    headers = login(client)
    _seed_chain(client, headers)

    # user_name 没有字段级边；d1→d0 的表级边应让 d0 全字段连通
    r = _subgraph(client, headers, dataset="d1", field="user_name",
                  hops=1, direction="up")
    assert r.status_code == 200, r.text
    payload = r.json()
    assert _dataset_ids(payload) == ["d0", "d1"]
    d0 = next(d for d in payload["datasets"] if d["id"] == "d0")
    assert [f["name"] for f in d0["fields"]] == ["ext_order_no", "order_no", "user_name"]

    # 闭包内数据集之间的全部边（含表级边）都要返回
    table_edges = [e for e in payload["edges"]
                   if e["from_field"] is None and e["to_field"] is None]
    assert len(table_edges) == 1
    assert table_edges[0]["from_dataset"] == "d0"
    assert table_edges[0]["to_dataset"] == "d1"


def test_graph_payload_shape_matches_contract(client):
    headers = login(client)
    _seed_chain(client, headers)

    payload = _subgraph(client, headers, dataset="d1", hops=1).json()
    for dataset in payload["datasets"]:
        assert set(dataset) == {"id", "name", "fields"}
        for field in dataset["fields"]:
            assert set(field) == {"name", "field_type", "description",
                                  "src_locator", "source_file"}
            assert set(field["src_locator"]) == {"type", "input", "resolved"}
            assert set(field["source_file"]) == {"id", "original_name"}

    for edge in payload["edges"]:
        assert set(edge) == {"id", "from_dataset", "from_field", "to_dataset",
                             "to_field", "transform", "confidence", "source", "note"}
        assert isinstance(edge["id"], int)  # M3：人工编辑/删除按边主键定位
        assert edge["source"] == "imported"
        assert 0 <= edge["confidence"] <= 1

    sample = next(f for d in payload["datasets"] if d["id"] == "d0"
                  for f in d["fields"] if f["name"] == "order_no")
    assert sample["src_locator"]["type"] == "xlsx"
    assert sample["src_locator"]["input"]["header_path"] == ORDER_XLSX_HEADER_PATH
    assert sample["src_locator"]["resolved"]["column_index"] == 3
    assert sample["source_file"]["original_name"] == "订单明细.xlsx"


# ---------- 回源预览：csv / xlsx / json ----------

def _seed_preview_sources(client, headers) -> None:
    source_files = _upload_sources(client, headers)
    manifest = {"datasets": [
        {"dataset_id": "src_demo", "dataset_name": "回源样例",
         "field_name": "order_no", "field_type": "STRING",
         "src_file": "订单明细.xlsx", "src_type": "xlsx",
         "src_locator": {"sheet": "订单", "header_path": ORDER_XLSX_HEADER_PATH,
                         "header_rows": 2, "row_start": 3},
         "description": "XLSX 多级表头字段"},
        {"dataset_id": "src_demo", "dataset_name": "回源样例",
         "field_name": "user_name", "field_type": "STRING",
         "src_file": "用户表.csv", "src_type": "csv",
         "src_locator": {"column": 2}, "description": "CSV 字段"},
        {"dataset_id": "src_demo", "dataset_name": "回源样例",
         "field_name": "ext_order_no", "field_type": "STRING",
         "src_file": "源.json", "src_type": "json",
         "src_locator": {"json_path": "$.data.items[*].order_no"},
         "description": "JSONPath 字段"},
    ], "lineage": []}
    r = _import_manifest(client, headers, manifest, source_files)
    assert r.status_code == 201, r.text
    assert r.json()["report"]["summary"]["rejected"] == 0, r.text


def test_preview_csv(client):
    headers = login(client)
    _seed_preview_sources(client, headers)

    r = client.get("/fields/src_demo/user_name/preview", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file"]["original_name"] == "用户表.csv"
    assert len(body["file"]["sha256"]) == 64  # sha256 内容去重依据
    assert body["file"]["src_type"] == "csv"
    assert body["verification"]["status"] == "passed"
    assert body["verification"]["version_no"] == 1
    assert body["locator"]["type"] == "csv"
    preview = body["preview"]
    assert preview["header"] == ["user_id", "user_name", "phone"]
    assert preview["column_index"] == 2
    assert preview["rows"] == [["1", "张三", "138*"], ["2", "李四", "139*"]]


def test_preview_xlsx_with_merged_multi_header(client):
    headers = login(client)
    _seed_preview_sources(client, headers)

    r = client.get("/fields/src_demo/order_no/preview", headers=headers)
    assert r.status_code == 200, r.text
    preview = r.json()["preview"]
    assert preview["sheet"] == "订单"
    assert "B1:F1" in preview["merged_ranges"]
    assert preview["column_index"] == 3  # 订单号在 C 列
    assert preview["row_start"] == 3
    assert len(preview["header_rows"]) == 2
    assert preview["rows"] == [
        [None, "S001", "SO-1001", 2, 9.9, 19.8, 5],
        [None, "S002", "SO-1002", 1, 59.0, 59.0, 0],
    ]


def test_preview_json(client):
    headers = login(client)
    _seed_preview_sources(client, headers)

    r = client.get("/fields/src_demo/ext_order_no/preview", headers=headers)
    assert r.status_code == 200, r.text
    preview = r.json()["preview"]
    assert preview["json_path"] == "$.data.items[*].order_no"
    assert preview["hits"] == 2
    assert preview["samples"] == ["SO-1001", "SO-1002"]


def test_preview_404_and_stale_locator_409(client):
    headers = login(client)
    _seed_preview_sources(client, headers)

    assert client.get("/fields/src_demo/nope/preview",
                      headers=headers).status_code == 404
    assert client.get("/fields/no_such/nope/preview",
                      headers=headers).status_code == 404

    # 模拟源文件改版后 sheet 已不存在（定位器物化结果仍在）
    stale = {"type": "xlsx",
             "input": {"sheet": "已删除的工作表", "column": "C"},
             "resolved": {"column_index": 3}}
    conn = sqlite3.connect(db_path())
    conn.execute(
        "UPDATE field SET src_locator=? WHERE dataset_id='src_demo' AND name='order_no'",
        (json.dumps(stale, ensure_ascii=False),))
    conn.commit()
    conn.close()

    r = client.get("/fields/src_demo/order_no/preview", headers=headers)
    assert r.status_code == 409, r.text
    assert "不存在" in r.json()["detail"]


def test_preview_stale_row_range_409(client):
    headers = login(client)
    _seed_preview_sources(client, headers)

    def set_locator(locator: dict) -> None:
        conn = sqlite3.connect(db_path())
        conn.execute(
            "UPDATE field SET src_locator=? WHERE dataset_id='src_demo' AND name='order_no'",
            (json.dumps(locator, ensure_ascii=False),))
        conn.commit()
        conn.close()

    # row_start 超出工作表总行数（fixture：2 行表头 + 2 行数据）
    set_locator({"type": "xlsx",
                 "input": {"sheet": "订单", "column": "C", "row_start": 99},
                 "resolved": {"column_index": 3, "row_start": 99}})
    r = client.get("/fields/src_demo/order_no/preview", headers=headers)
    assert r.status_code == 409, r.text
    assert "row_start=99" in r.json()["detail"]

    # row_end 超出工作表总行数
    set_locator({"type": "xlsx",
                 "input": {"sheet": "订单", "column": "C",
                           "row_start": 3, "row_end": 99},
                 "resolved": {"column_index": 3, "row_start": 3, "row_end": 99}})
    r = client.get("/fields/src_demo/order_no/preview", headers=headers)
    assert r.status_code == 409, r.text
    assert "row_end=99" in r.json()["detail"]


# ---------- 认证与参数校验 ----------

def test_lineage_and_preview_require_auth(client):
    headers = login(client)
    _seed_chain(client, headers)

    assert client.get("/lineage/subgraph", params={"dataset": "d1"}).status_code == 401
    assert client.get("/fields/d0/order_no/preview").status_code == 401


def test_hops_out_of_range_rejected(client):
    headers = login(client)
    _seed_chain(client, headers)

    assert _subgraph(client, headers, dataset="d1", hops=6).status_code == 422
    assert _subgraph(client, headers, dataset="d1", hops=0).status_code == 422
    assert _subgraph(client, headers, dataset="d1",
                     direction="sideways").status_code == 422


def test_unknown_seed_404(client):
    headers = login(client)
    _seed_chain(client, headers)

    assert _subgraph(client, headers, dataset="nope", hops=1).status_code == 404
    assert _subgraph(client, headers, dataset="d1", field="nope",
                     hops=1).status_code == 404


def test_viewer_can_read_lineage_and_preview(client):
    admin_headers = login(client)
    _seed_chain(client, admin_headers)
    viewer_headers = create_user(client, admin_headers, "viewer_m2", "viewer")

    assert _subgraph(client, viewer_headers, dataset="d1",
                     hops=1).status_code == 200
    assert client.get("/fields/d0/order_no/preview",
                      headers=viewer_headers).status_code == 200
