"""版本业务标签 API（M3）：创建、列表、标签间 diff、回滚到标签。

- 创建（editor+）：锚定当前 change_log 末尾，重名 409；
- diff（viewer+）：两个标签 change_seq 区间内的净变更；
- 回滚（admin）：反做标签之后全部 change_log（含人工编辑），审计写 rollback_record。
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import versioning
from ..models import VersionTagCreate
from ..security import require_role

router = APIRouter(tags=["version-tags"])


@router.post("/version-tags", status_code=201)
def create_tag(body: VersionTagCreate,
               user: dict = Depends(require_role("editor"))):
    """创建业务标签；change_seq = 当前 change_log 最大 id。"""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "标签名不能为空")
    note = body.note.strip() if body.note is not None else None
    try:
        row = versioning.create_tag(name, note, user["username"])
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    return {key: row[key] for key in
            ("name", "note", "change_seq", "created_by", "created_at")}


@router.get("/version-tags")
def list_tags(user: dict = Depends(require_role("viewer"))):
    return versioning.list_tags()


@router.get("/version-tags/diff")
def diff_tags(
    from_name: str = Query(..., alias="from", description="起始标签名"),
    to_name: str = Query(..., alias="to", description="结束标签名"),
    user: dict = Depends(require_role("viewer")),
):
    """两个标签之间的净变更（added/updated/deleted）。"""
    try:
        return versioning.tag_diff(from_name, to_name)
    except LookupError as e:
        raise HTTPException(404, str(e)) from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@router.post("/version-tags/{name}/rollback")
def rollback_to_tag(name: str,
                    admin: dict = Depends(require_role("admin"))):
    """回滚到标签：反做 change_seq 之后的全部变更（幂等，重复回滚安全）。"""
    try:
        reverted = versioning.rollback_to_tag(name, admin["username"])
    except LookupError as e:
        raise HTTPException(404, str(e)) from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    return {"reverted": reverted}
