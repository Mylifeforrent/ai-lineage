"""字段回源预览 API：定位卡点击后高亮源文件对应区域（设计方案 §3.6）。"""

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db
from ..preview import PreviewError, field_preview
from ..security import require_role

router = APIRouter(tags=["preview"])


@router.get("/fields/{dataset_id}/{field_name}/preview")
def preview_field(dataset_id: str, field_name: str,
                  user: dict = Depends(require_role("viewer"))):
    """按字段定位器返回 csv/xlsx/json 结构化预览；定位失效返回 409。"""
    with get_db() as conn:
        try:
            return field_preview(conn, dataset_id, field_name)
        except LookupError as e:
            raise HTTPException(404, str(e)) from None
        except PreviewError as e:
            raise HTTPException(409, str(e)) from None
