"""字段编辑 API（M3）：描述、类型与源定位器的人工修正（editor+）。

``src_locator`` 是**唯一**要求实文件核查的字段：
- 接受定位器 input（如 ``{"column": 3}``）或完整信封 ``{"type","input","resolved"}``；
- 结构校验（pydantic）→ 打开托管源文件实文件核查 → 重新物化 ``resolved``；
- 任一环节失败返回 409 + 中文原因，字段保持原值（事务回滚）；
- 成功编辑写 change_log（batch_id=NULL，actor=当前用户），可被标签回滚反做。
"""

import json

from fastapi import APIRouter, Depends, HTTPException

from ..changes import field_snapshot, log_change, now
from ..config import resolve_storage
from ..db import get_db
from ..locator import CHECKERS, LOCATOR_MODELS
from ..models import FieldPatch
from ..security import require_role

router = APIRouter(tags=["fields"])


def _field_out(row) -> dict:
    out = dict(row)
    out["src_locator"] = json.loads(out["src_locator"])
    return out


def _locator_input(payload: dict, src_type: str) -> dict:
    """兼容两种请求形态：定位器 input，或完整 locator 信封。"""
    envelope_keys = {"type", "input", "resolved"}
    if envelope_keys & payload.keys():
        declared = payload.get("type") or src_type
        if declared != src_type:
            raise ValueError(
                f"定位器类型「{declared}」与源文件类型「{src_type}」不一致")
        user_input = payload.get("input")
        if not isinstance(user_input, dict):
            raise ValueError("src_locator.input 必须是 JSON 对象")
        return user_input
    return payload


@router.patch("/fields/{dataset_id}/{field_name}")
def patch_field(dataset_id: str, field_name: str, body: FieldPatch,
                user: dict = Depends(require_role("editor"))):
    """人工修正字段描述/类型/源定位器；src_locator 重新走实文件核查并物化。"""
    provided = body.model_fields_set
    if not provided:
        raise HTTPException(
            400, "至少提供一个可编辑字段（description / field_type / src_locator）")
    if "src_locator" in provided and body.src_locator is None:
        raise HTTPException(400, "src_locator 不能为空（字段必须始终可回源）")

    with get_db() as conn:
        row = conn.execute(
            "SELECT f.dataset_id, f.name, f.field_type, f.source_file_id,"
            " f.src_locator, f.description, f.updated_at, s.storage_path,"
            " s.original_name, s.src_type"
            " FROM field f JOIN source_file s ON s.id = f.source_file_id"
            " WHERE f.dataset_id=? AND f.name=?",
            (dataset_id, field_name)).fetchone()
        if row is None:
            raise HTTPException(404, f"字段「{dataset_id}.{field_name}」不存在")

        new_description = (body.description if "description" in provided
                           else row["description"])
        new_field_type = (body.field_type if "field_type" in provided
                          else row["field_type"])
        new_locator = row["src_locator"]

        if "src_locator" in provided:
            src_type = row["src_type"]
            try:
                locator_input = _locator_input(body.src_locator or {}, src_type)
                model_cls = LOCATOR_MODELS.get(src_type)
                if model_cls is None:
                    raise ValueError(f"不支持的源文件类型「{src_type}」")
                try:
                    locator_model = model_cls(**locator_input)
                except Exception as e:  # pydantic ValidationError
                    raise ValueError(f"定位器结构校验失败：{e}") from None
                path = resolve_storage(row["storage_path"])
                if not path.is_file():
                    raise ValueError(
                        f"源文件「{row['original_name']}」不在托管存储中，无法实文件核查")
                try:
                    resolved = CHECKERS[src_type](str(path), locator_model)
                except ValueError as e:
                    raise ValueError(f"实文件核查失败：{e}") from None
            except ValueError as e:
                # 结构性错误/核查失败统一 409；get_db 尚未写入，字段保持原值
                raise HTTPException(409, str(e)) from None
            new_locator = json.dumps(
                {"type": src_type,
                 "input": locator_model.model_dump(exclude_none=True),
                 "resolved": resolved},
                ensure_ascii=False)

        before = field_snapshot(row)
        after = {"dataset_id": row["dataset_id"], "name": row["name"],
                 "field_type": new_field_type,
                 "source_file_id": row["source_file_id"],
                 "src_locator": new_locator,
                 "description": new_description}
        if before == after:
            return _field_out(row)

        updated_at = now()
        conn.execute(
            "UPDATE field SET field_type=?, src_locator=?, description=?,"
            " updated_at=? WHERE dataset_id=? AND name=?",
            (new_field_type, new_locator, new_description, updated_at,
             dataset_id, field_name))
        log_change(
            conn, entity_kind="field", entity_key=f"{dataset_id}.{field_name}",
            op="updated", before=before, after=after, actor=user["username"])
        saved = conn.execute(
            "SELECT dataset_id, name, field_type, source_file_id, src_locator,"
            " description, updated_at FROM field WHERE dataset_id=? AND name=?",
            (dataset_id, field_name)).fetchone()
    return _field_out(saved)
