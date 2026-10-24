"""数据集与字段的基础浏览（M1 验证用；M2 扩展图查询与定位卡预览）。"""

import json

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db
from ..security import require_role

router = APIRouter(tags=["datasets"])


@router.get("/datasets")
def list_datasets(user: dict = Depends(require_role("viewer"))):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT d.id, d.name, COUNT(f.id) AS field_count"
            " FROM dataset d LEFT JOIN field f ON f.dataset_id = d.id"
            " GROUP BY d.id ORDER BY d.id").fetchall()
        # 侧栏搜索需要「数据集 / 字段」两类匹配目标（设计方案 §5.1）
        field_rows = conn.execute(
            "SELECT dataset_id, name FROM field ORDER BY dataset_id, name").fetchall()
    field_names: dict[str, list[str]] = {}
    for field in field_rows:
        field_names.setdefault(field["dataset_id"], []).append(field["name"])
    return [{**dict(row), "field_names": field_names.get(row["id"], [])}
            for row in rows]


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str, user: dict = Depends(require_role("viewer"))):
    with get_db() as conn:
        ds = conn.execute("SELECT id, name, description FROM dataset WHERE id=?",
                          (dataset_id,)).fetchone()
        if ds is None:
            raise HTTPException(404, f"数据集「{dataset_id}」不存在")
        fields = conn.execute(
            "SELECT f.name, f.field_type, f.description, f.src_locator,"
            " f.source_file_id, s.original_name AS source_file_name"
            " FROM field f JOIN source_file s ON s.id = f.source_file_id"
            " WHERE f.dataset_id=? ORDER BY f.name", (dataset_id,)).fetchall()
    out = dict(ds)
    out["fields"] = []
    for r in fields:
        d = dict(r)
        d["src_locator"] = json.loads(d["src_locator"])
        out["fields"].append(d)
    return out
