"""血缘图查询 API（设计方案 §4.3 / §5.1）。"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import get_db
from ..lineage import LineageNotFound, lineage_subgraph
from ..security import require_role

router = APIRouter(tags=["lineage"])


@router.get("/lineage/subgraph")
def subgraph(
    dataset: str = Query(..., description="种子数据集 ID"),
    field: str | None = Query(None, description="种子字段名（可选）"),
    hops: int = Query(3, ge=1, le=5, description="最大跳数 1~5"),
    direction: Literal["both", "up", "down"] = Query("both"),
    user: dict = Depends(require_role("viewer")),
):
    """取数据集/字段的 N 跳血缘子图（GraphPayload）。"""
    with get_db() as conn:
        try:
            return lineage_subgraph(conn, dataset, field, hops, direction)
        except LineageNotFound as e:
            raise HTTPException(404, str(e)) from None
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
