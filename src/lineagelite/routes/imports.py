"""导入与版本：三步导入 API、批次/报告查询、按批次回滚。"""

import json

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from .. import versioning
from ..db import get_db
from ..import_service import run_import
from ..manifest import read_csv_manifest, read_json_manifest, read_xlsx_manifest
from ..security import require_role

router = APIRouter(tags=["import"])


@router.post("/import", status_code=201)
async def import_data(
    format: str = Form(...),  # noqa: A002 — 与清单格式同名，对外 API 语义
    source_file_ids: str = Form(...),
    user: dict = Depends(require_role("editor")),
    manifest: UploadFile | None = None,          # xlsx / json 单文件清单
    manifest_datasets: UploadFile | None = None,  # csv：datasets.csv
    manifest_lineage: UploadFile | None = None,   # csv：lineage.csv
):
    fmt = format.lower()
    try:
        ids = [int(x) for x in source_file_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "source_file_ids 必须是逗号分隔的文件 ID") from None
    if not ids:
        raise HTTPException(400, "至少绑定一个源文件")

    with get_db() as conn:
        bound = []
        for fid in ids:
            row = conn.execute(
                "SELECT id, original_name, src_type FROM source_file WHERE id=?",
                (fid,)).fetchone()
            if row is None:
                raise HTTPException(404, f"源文件 {fid} 不存在")
            bound.append(dict(row))

    try:
        if fmt == "csv":
            if manifest_datasets is None or manifest_lineage is None:
                raise HTTPException(400, "csv 格式需要上传 manifest_datasets 与 manifest_lineage 两个文件")
            ds_recs, edge_recs = read_csv_manifest(
                await manifest_datasets.read(), await manifest_lineage.read())
        elif fmt == "xlsx":
            if manifest is None:
                raise HTTPException(400, "xlsx 格式需要上传含 datasets/lineage 双 sheet 的清单文件")
            ds_recs, edge_recs = read_xlsx_manifest(await manifest.read())
        elif fmt == "json":
            if manifest is None:
                raise HTTPException(400, "json 格式需要上传 {datasets:[], lineage:[]} 清单文件")
            ds_recs, edge_recs = read_json_manifest(await manifest.read())
        else:
            raise HTTPException(400, f"format 必须是 csv/xlsx/json，收到「{fmt}」")
    except ValueError as e:
        raise HTTPException(400, str(e)) from None

    if not ds_recs and not edge_recs:
        raise HTTPException(400, "清单为空")

    batch_id, version_no, report = run_import(user["username"], fmt, bound,
                                              ds_recs, edge_recs)
    return {"batch_id": batch_id, "version_no": version_no, "report": report}


@router.get("/import/batches")
def list_batches(user: dict = Depends(require_role("viewer"))):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, version_no, file_names, format, created_by, created_at,"
            " rolled_back_at FROM import_batch ORDER BY version_no DESC").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["file_names"] = json.loads(d["file_names"]) if d["file_names"] else []
        out.append(d)
    return out


@router.get("/import/batches/{batch_id}")
def get_batch(batch_id: int, user: dict = Depends(require_role("viewer"))):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM import_batch WHERE id=?", (batch_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"导入批次 {batch_id} 不存在")
    d = dict(row)
    d["file_names"] = json.loads(d["file_names"]) if d["file_names"] else []
    d["report"] = json.loads(d["report"]) if d["report"] else None
    return d


@router.post("/import/batches/{batch_id}/rollback")
def rollback(batch_id: int, admin: dict = Depends(require_role("admin"))):
    try:
        reverted = versioning.rollback_batch(batch_id, admin["username"])
    except LookupError as e:
        raise HTTPException(404, str(e)) from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    return {"batch_id": batch_id, "reverted": reverted}


@router.get("/lineage/snapshot")
def snapshot(user: dict = Depends(require_role("viewer"))):
    """当前血缘状态（M1 验证用；M2 将替换为递归 CTE 子图查询）。"""
    return versioning.get_snapshot()
