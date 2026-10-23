"""源文件托管：上传（sha256 去重）、列表、下载（设计方案 §3.6）。"""

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..config import files_dir, get_settings, resolve_storage
from ..db import get_db
from ..security import require_role

router = APIRouter(prefix="/files", tags=["files"])

ALLOWED_TYPES = {"csv", "xlsx", "json"}


def _src_type_of(filename: str) -> str:
    suffix = Path(filename).suffix.lstrip(".").lower()
    if suffix not in ALLOWED_TYPES:
        raise HTTPException(400, f"仅支持 {', '.join(sorted(ALLOWED_TYPES))} 文件，收到「{filename}」")
    return suffix


@router.post("", status_code=201)
async def upload(files: list[UploadFile] | None = None,
                 user: dict = Depends(require_role("editor"))):
    """批量上传第一手源文件；同内容（sha256 相同）复用已有记录。"""
    if not files:
        raise HTTPException(400, "至少上传一个文件")
    max_upload_mb = get_settings().max_upload_mb
    max_bytes = max_upload_mb * 1024 * 1024
    out = []
    for f in files:
        src_type = _src_type_of(f.filename or "")
        data = await f.read()
        if not data:
            raise HTTPException(400, f"文件「{f.filename}」为空")
        if len(data) > max_bytes:
            raise HTTPException(
                413, f"文件「{f.filename}」超过单文件大小上限 {max_upload_mb}MB")
        sha = hashlib.sha256(data).hexdigest()
        # 文件名保留原始扩展名：openpyxl 等解析器按扩展名识别格式
        rel_path = f"files/{sha[:2]}/{sha}.{src_type}"
        abs_path = files_dir() / sha[:2] / f"{sha}.{src_type}"
        with get_db() as conn:
            existing = conn.execute("SELECT * FROM source_file WHERE sha256=?",
                                    (sha,)).fetchone()
            if existing is None:
                abs_path.parent.mkdir(parents=True, exist_ok=True)
                abs_path.write_bytes(data)
                cur = conn.execute(
                    "INSERT INTO source_file(original_name, storage_path, sha256,"
                    " size_bytes, src_type, uploaded_by, created_at)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (f.filename, rel_path, sha, len(data), src_type,
                     user["username"], datetime.now(UTC).isoformat(timespec="seconds")))
                row = conn.execute("SELECT * FROM source_file WHERE id=?",
                                   (cur.lastrowid,)).fetchone()
                out.append({**dict(row), "deduped": False})
            else:
                out.append({**dict(existing), "deduped": True})
    return out


@router.get("")
def list_files(user: dict = Depends(require_role("viewer"))):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, original_name, sha256, size_bytes, src_type, uploaded_by,"
            " created_at FROM source_file ORDER BY id").fetchall()
    return [dict(r) for r in rows]


@router.get("/{file_id}/download")
def download(file_id: int, user: dict = Depends(require_role("viewer"))):
    """受控下载：存储路径不对外暴露（业务规则#8）。"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM source_file WHERE id=?", (file_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"源文件 {file_id} 不存在")
    abs_path = resolve_storage(row["storage_path"])
    return FileResponse(abs_path, filename=row["original_name"])
