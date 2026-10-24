"""M4 AI API：状态、对话（function calling）与血缘建议确认/拒绝。

权限：``/ai/status`` 与 ``/ai/chat`` 为 viewer+；
``/ai/suggest``、``confirm``、``reject`` 为 editor+（AI 建议不可直接生效）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from ..ai import llm, suggest
from ..ai.chat import run_chat
from ..config import get_settings
from ..db import get_db
from ..models import AiChatIn, AiEdgeKeyIn, AiSuggestIn
from ..security import require_role

router = APIRouter(tags=["ai"])


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _edge_key(body: AiEdgeKeyIn) -> tuple[str, str | None, str, str | None]:
    from_dataset = body.from_dataset.strip()
    to_dataset = body.to_dataset.strip()
    if not from_dataset or not to_dataset:
        raise HTTPException(400, "from_dataset / to_dataset 必填")
    from_field = _clean_optional(body.from_field)
    to_field = _clean_optional(body.to_field)
    if bool(from_field) != bool(to_field):
        raise HTTPException(
            400, "血缘边必须同时提供上下游字段（字段级）或都不提供（表级）")
    return from_dataset, from_field, to_dataset, to_field


@router.get("/ai/status")
def ai_status(user: dict = Depends(require_role("viewer"))):
    """返回 LLM 是否已配置及当前模型名（绝不返回密钥）。"""
    settings = get_settings()
    configured = llm.is_configured(settings)
    return {
        "configured": configured,
        "model": settings.llm_model.strip() if configured else None,
    }


@router.post("/ai/chat")
def ai_chat(body: AiChatIn, user: dict = Depends(require_role("viewer"))):
    """自然语言对话：模型通过 function calling 调用只读工具，可联动出图。"""
    focus = body.focus.model_dump() if body.focus is not None else None
    try:
        return run_chat([message.model_dump() for message in body.messages], focus)
    except llm.LLMNotConfigured as exc:
        raise HTTPException(503, str(exc)) from None
    except llm.LLMError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post("/ai/suggest")
def ai_suggest(body: AiSuggestIn,
               user: dict = Depends(require_role("editor"))):
    """按同名字段/包含关系启发式生成候选边（source='ai'）并落库。"""
    dataset = body.dataset.strip()
    if not dataset:
        raise HTTPException(400, "dataset 不能为空")
    field = _clean_optional(body.field)
    with get_db() as conn:
        try:
            candidates = suggest.suggest_edges(
                conn, dataset, field, user["username"])
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
    return {"candidates": candidates}


@router.post("/ai/suggest/confirm")
def ai_suggest_confirm(body: AiEdgeKeyIn,
                       user: dict = Depends(require_role("editor"))):
    """人工确认 AI 建议：source 改为 manual，写 change_log(updated)。"""
    key = _edge_key(body)
    with get_db() as conn:
        try:
            edge = suggest.confirm_suggestion(conn, *key, user["username"])
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
    return {"edge": edge}


@router.post("/ai/suggest/reject", status_code=204)
def ai_suggest_reject(body: AiEdgeKeyIn,
                      user: dict = Depends(require_role("editor"))):
    """拒绝 AI 建议：删除该 ai 边，写 change_log(deleted)。"""
    key = _edge_key(body)
    with get_db() as conn:
        try:
            suggest.reject_suggestion(conn, *key, user["username"])
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
    return Response(status_code=204)
