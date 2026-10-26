"""M4/M5 AI API：状态、对话（function calling，含 SSE 流式）、血缘建议与描述草稿。

权限：``/ai/status``、``/ai/chat*``、``GET /ai/description-drafts`` 为 viewer+；
``/ai/suggest``、``confirm``、``reject``、草稿 accept/reject 为 editor+
（AI 建议不可直接生效，描述草稿必须人工采纳）。写类工具在工具层二次校验调用方
角色（08 号 R8）。对话请求挂内存滑动窗口限流（08 号 R11）：超限 429。
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse

from ..ai import descriptions, llm, suggest
from ..ai.chat import ChatInterrupted, run_chat, stream_run_chat
from ..ai.ratelimit import (SUGGEST_MAX_REQUESTS, SUGGEST_WINDOW_SECONDS,
                            CHAT_MAX_REQUESTS, CHAT_WINDOW_SECONDS, ai_limiter)
from ..config import get_settings
from ..db import get_db
from ..models import AiChatIn, AiEdgeKeyIn, AiSuggestIn
from ..security import require_role

router = APIRouter(tags=["ai"])

# 对话与建议路由的限流依赖（模块级实例，测试可用 reset() 清空计数）
ai_chat_limiter = ai_limiter(CHAT_WINDOW_SECONDS, CHAT_MAX_REQUESTS,
                             role="viewer")
ai_suggest_limiter = ai_limiter(SUGGEST_WINDOW_SECONDS, SUGGEST_MAX_REQUESTS,
                                role="editor")

# SSE 事件空档心跳间隔（08 号 R9：防反向代理掐断静默连接；测试可 monkeypatch）
PING_INTERVAL_SECONDS = 15.0


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
def ai_chat(body: AiChatIn, user: dict = Depends(ai_chat_limiter)):
    """自然语言对话：模型通过 function calling 调用工具，可联动出图/高亮/建议。

    写类工具（suggest_lineage / draft_descriptions）按调用方角色校验（R8）。
    """
    focus = body.focus.model_dump() if body.focus is not None else None
    try:
        return run_chat([message.model_dump() for message in body.messages],
                        focus, actor=user["username"], role=user["role"])
    except llm.LLMNotConfigured as exc:
        raise HTTPException(503, str(exc)) from None
    except llm.LLMError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post("/ai/chat/stream")
def ai_chat_stream(body: AiChatIn, user: dict = Depends(ai_chat_limiter)):
    """SSE 流式对话（演进规划 07 §4.3，断开即停与心跳见 08 号 R9）。

    事件：``token``（增量文本）/ ``tool``（工具打点）/ ``suggest``（候选落库）/
    ``drafts``（描述草稿）/ ``done``（完整 payload）/ ``error``。
    编排在后台线程执行（工具为同步调用），事件经队列交由生成器实时产出；
    事件空档超过 ``PING_INTERVAL_SECONDS`` 输出注释帧 `: ping` 心跳；
    客户端断开（生成器被关闭）时置位取消标志，尚未开始的工具轮次
    （含写类工具落库）不再执行。
    """
    focus = body.focus.model_dump() if body.focus is not None else None
    messages = [message.model_dump() for message in body.messages]
    username = user["username"]
    role = user["role"]

    def event_stream():
        import threading
        import time

        pending: list[dict] = []
        cancelled = threading.Event()
        finished: dict = {"payload": None, "error": None}

        def on_event(event: dict) -> None:
            pending.append(event)

        def worker() -> None:
            try:
                finished["payload"] = stream_run_chat(
                    messages, focus, username, role, on_event,
                    should_interrupt=cancelled.is_set)
            except ChatInterrupted:
                pass  # 客户端已断开：静默收敛，不再补发任何事件
            except llm.LLMNotConfigured as exc:
                finished["error"] = ("503", str(exc))
            except llm.LLMError as exc:
                finished["error"] = ("502", str(exc))
            except Exception as exc:  # 编排兜底：不静默断流
                finished["error"] = ("500", str(exc))

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()
        last_output = time.monotonic()
        try:
            while thread.is_alive():
                if pending:
                    while pending:
                        yield _sse(pending.pop(0))
                        last_output = time.monotonic()
                    continue
                if time.monotonic() - last_output >= PING_INTERVAL_SECONDS:
                    yield ": ping\n\n"
                    last_output = time.monotonic()
                time.sleep(0.02)
            while pending:
                yield _sse(pending.pop(0))
        finally:
            # 客户端断开（GeneratorExit）或流正常结束：置位取消标志（R9）
            cancelled.set()

        if finished["error"] is not None:
            status, detail = finished["error"]
            yield _sse({"type": "error", "status": status, "detail": detail})
            return
        payload = finished["payload"]
        if payload is None:
            return  # 被取消或静默收敛：无可交付 payload
        yield _sse({"type": "done",
                    "answer": payload["answer"],
                    "graph": payload.get("graph"),
                    "highlights": payload.get("highlights"),
                    "suggestions": payload.get("suggestions"),
                    "drafts": payload.get("drafts"),
                    "tool_trace": payload["tool_trace"]})

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


def _sse(event: dict) -> str:
    event_type = event.get("type", "message")
    return f"event: {event_type}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.get("/ai/description-drafts")
def ai_drafts_list(dataset: str | None = None, status: str | None = None,
                   user: dict = Depends(require_role("viewer"))):
    """列出描述草稿（可按 dataset / status 过滤）。"""
    if status is not None and status not in ("pending", "accepted", "rejected"):
        raise HTTPException(400, "status 仅允许 pending/accepted/rejected")
    with get_db() as conn:
        items = descriptions.list_drafts(conn, dataset, status)
    return {"items": items}


@router.post("/ai/description-drafts/{draft_id}/accept")
def ai_draft_accept(draft_id: int, user: dict = Depends(require_role("editor"))):
    """采纳描述草稿：写 annotation（追加式）+ 置 accepted。"""
    with get_db() as conn:
        try:
            item = descriptions.accept_draft(conn, draft_id, user["username"])
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
        except descriptions.DescriptionError as exc:
            raise HTTPException(409, str(exc)) from None
    return {"draft": item}


@router.post("/ai/description-drafts/{draft_id}/reject")
def ai_draft_reject(draft_id: int, user: dict = Depends(require_role("editor"))):
    """拒绝描述草稿：置 rejected，该字段不再重复生成。"""
    with get_db() as conn:
        try:
            descriptions.reject_draft(conn, draft_id, user["username"])
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
        except descriptions.DescriptionError as exc:
            raise HTTPException(409, str(exc)) from None
    return Response(status_code=204)


@router.post("/ai/suggest")
def ai_suggest(body: AiSuggestIn,
               user: dict = Depends(ai_suggest_limiter)):
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
