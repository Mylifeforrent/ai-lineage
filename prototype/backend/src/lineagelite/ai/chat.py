"""AI 对话编排：OpenAI 兼容 function calling 循环（最多 5 轮工具调用）。

流程：
1. 固定 system 提示（含可选的 focus 上下文）+ 前端传来的对话历史；
2. 调 ``llm.complete(messages, tools)``；模型返回 tool_calls 时逐个执行工具，
   把结果以 role=tool 的消息追加回去，继续下一轮；
3. 模型不再请求工具时，取该条消息的 content 作为最终 answer；
4. 若连续 5 轮都在调用工具，再发一次不带 tools 的请求强制收口（保证循环有界）。

``tool_trace`` 记录每次工具调用的 ``{tool, args, ok}``；``graph`` 取最后一次
图查询工具（trace_lineage）返回的 GraphPayload，供前端画布联动渲染；
``highlights`` 汇总 mark_highlight 声明的字段（画布红色追踪链联动信号）；
``suggestions``/``drafts`` 为 M5 新增（suggest_lineage 候选、描述草稿）。

流式：``stream_run_chat`` 复用同一编排，仅把模型调用换成 ``llm.stream_complete``
（逐 token 回调）并把工具轮事件经 ``on_event`` 实时抛给 SSE 路由。
"""

from __future__ import annotations

import json
from typing import Callable

from ..config import get_settings
from ..db import get_db
from . import llm
from .tools import MAX_HIGHLIGHT_FIELDS, TOOL_SCHEMAS, run_tool

MAX_TOOL_ROUNDS = 5

SYSTEM_PROMPT = """你是 LineageLite（轻量级 AI 数据血缘工具）的助手。

你可以调用工具查询数据集字段、源文件定位、上下游血缘与变更历史：
- search_fields：按关键词定位字段；
- get_field_details：字段详情、源文件定位器与回源预览；
- trace_lineage：按数据集/字段追溯上下游 N 跳子图；
- get_field_history：字段的变更历史；
- mark_highlight：声明要在画布上红色追踪高亮的字段（画布联动信号，不返回数据）；
- suggest_lineage：对数据集/字段运行血缘建议，候选边落库并出现在画布上（用户人工确认后生效）；
- analyze_impact：分析字段下游影响面（下游字段、源文件、最近变更）；
- draft_descriptions：为缺描述的字段生成描述草稿（用户确认后才成为标注）。

回答规则：
1. 必须基于工具返回的数据作答，不得编造数据集、字段、边或文件位置；
   查不到时明确说明「未找到」，并给出下一步建议。
2. 用户用中文提问时用中文回答；涉及血缘时说明方向、跳数与置信度，
   涉及回源时给出文件名与定位器（sheet/列/JSONPath）。
3. 你没有直接修改业务数据的权限：血缘候选必须经用户确认、描述草稿必须经
   用户采纳，不要声称已修改任何正式数据。
4. 当用户要求「高亮/标记/标出」结果，或回答围绕某些字段的上下游时，
   在给出最终回答前调用 mark_highlight，fields 传本次回答聚焦的字段
   （最多 8 个）；这些字段会在画布上以红色追踪链高亮。
5. 回答中的字段尽量写成 `数据集.字段` 形式（如 d0.amount），前端会渲染为
   可点击的证据锚点。"""


def _system_prompt(focus: dict | None) -> str:
    lines = [SYSTEM_PROMPT]
    if focus:
        dataset = str(focus.get("dataset") or "").strip()
        field = str(focus.get("field") or "").strip()
        if dataset:
            scope = f"数据集「{dataset}」"
            if field:
                scope += f"的字段「{field}」"
            lines.append(f"当前用户聚焦于{scope}，请优先围绕该范围回答。")
    return "\n\n".join(lines)


def _response_message(response: dict) -> dict:
    if not isinstance(response, dict):
        raise llm.LLMError("LLM 响应不是 JSON 对象")
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices:
        raise llm.LLMError("LLM 响应缺少 choices")
    first = choices[0]
    message = first.get("message") if isinstance(first, dict) else None
    if not isinstance(message, dict):
        raise llm.LLMError("LLM 响应缺少 message")
    return message


def _tool_calls(message: dict) -> list:
    calls = message.get("tool_calls")
    return calls if isinstance(calls, list) else []


def _content_text(content) -> str:
    """兼容 content 为字符串或 [{type:text,text:...}] 的供应商差异。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "".join(parts)
    return ""


def _parse_arguments(raw) -> dict:
    if raw is None or raw == "":
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            raise ValueError("工具参数不是合法 JSON") from None
        if not isinstance(parsed, dict):
            raise ValueError("工具参数必须是 JSON 对象")
        return parsed
    raise ValueError("工具参数必须是 JSON 对象")


def _is_graph_payload(value) -> bool:
    return (isinstance(value, dict)
            and isinstance(value.get("datasets"), list)
            and isinstance(value.get("edges"), list))


def _drive(messages: list[dict], focus: dict | None, actor: str,
           complete_fn: Callable, on_event: Callable[[dict], None] | None) -> dict:
    """function calling 主循环；``complete_fn`` 可替换为流式实现。"""
    conversation: list[dict] = [
        {"role": "system", "content": _system_prompt(focus)},
    ]
    for message in messages:
        conversation.append(
            {"role": message["role"], "content": message["content"]})

    tool_trace: list[dict] = []
    graph: dict | None = None
    highlights: list[dict] = []
    seen_highlights: set[tuple[str, str]] = set()
    suggestions: list[dict] = []
    drafts: list[dict] = []
    rounds = 0

    def emit(event: dict) -> None:
        if on_event is not None:
            on_event(event)

    while True:
        # 第 6 次请求（rounds == 5）不再提供工具，强制模型给出最终回答
        tools = TOOL_SCHEMAS if rounds < MAX_TOOL_ROUNDS else None
        response = complete_fn(conversation, tools)
        message = _response_message(response)
        calls = _tool_calls(message)

        if not calls or rounds >= MAX_TOOL_ROUNDS:
            answer = _content_text(message.get("content"))
            break

        conversation.append({
            "role": "assistant",
            "content": message.get("content"),
            "tool_calls": calls,
        })
        rounds += 1

        for call in calls:
            function = call.get("function") if isinstance(call, dict) else None
            if not isinstance(function, dict):
                function = {}
            name = function.get("name")
            name = name if isinstance(name, str) else ""
            call_id = call.get("id") if isinstance(call, dict) else None

            try:
                args = _parse_arguments(function.get("arguments"))
                parse_error = None
            except ValueError as exc:
                args = {}
                parse_error = str(exc)

            if parse_error is None:
                try:
                    with get_db() as conn:
                        result = run_tool(conn, name, args, actor=actor)
                    ok = True
                except Exception as exc:  # 工具错误回传给模型，不中断整轮对话
                    result = {"error": str(exc) or exc.__class__.__name__}
                    ok = False
            else:
                result = {"error": parse_error}
                ok = False

            tool_trace.append({"tool": name, "args": args, "ok": ok})
            emit({"type": "tool", "tool": name, "args": args, "ok": ok})
            if ok and isinstance(result, dict):
                candidate = result.get("graph")
                if _is_graph_payload(candidate):
                    graph = candidate
                if name == "mark_highlight":
                    fields = result.get("fields")
                    if isinstance(fields, list):
                        for item in fields:
                            if not isinstance(item, dict):
                                continue
                            key = (str(item.get("dataset") or ""),
                                   str(item.get("field") or ""))
                            if key in seen_highlights or not all(key):
                                continue
                            seen_highlights.add(key)
                            highlights.append(
                                {"dataset": key[0], "field": key[1]})
                if name == "suggest_lineage":
                    candidates = result.get("candidates")
                    if isinstance(candidates, list) and candidates:
                        suggestions.extend(candidates)
                        emit({"type": "suggest", "count": len(candidates),
                              "candidates": candidates})
                if name == "draft_descriptions":
                    items = result.get("items")
                    if isinstance(items, list) and items:
                        drafts.extend(items)
                        emit({"type": "drafts", "items": items})
            conversation.append({
                "role": "tool",
                "tool_call_id": call_id or "",
                "content": json.dumps(result, ensure_ascii=False, default=str),
            })

    payload: dict = {"answer": answer, "tool_trace": tool_trace}
    if graph is not None:
        payload["graph"] = graph
    if highlights:
        payload["highlights"] = highlights[:MAX_HIGHLIGHT_FIELDS]
    if suggestions:
        payload["suggestions"] = suggestions
    if drafts:
        payload["drafts"] = drafts
    return payload


def run_chat(messages: list[dict], focus: dict | None = None,
             actor: str = "system") -> dict:
    """执行一轮 AI 对话（非流式），返回编排 payload。

    ``messages`` 已由路由层校验为 ``[{role, content}]``（role 仅 user/assistant）。
    未配置 LLM 抛 :class:`llm.LLMNotConfigured`；上游 HTTP/结构错误抛
    :class:`llm.LLMError`。
    """
    if not llm.is_configured(get_settings()):
        raise llm.LLMNotConfigured(llm.NOT_CONFIGURED_MESSAGE)
    return _drive(messages, focus, actor, llm.complete, None)


def stream_run_chat(messages: list[dict], focus: dict | None, actor: str,
                    on_event: Callable[[dict], None]) -> dict:
    """流式编排：最终回答经 ``llm.stream_complete`` 逐 token 回调，其余同构。

    返回完整 payload（含 answer/graph/highlights/suggestions/drafts）。
    """
    if not llm.is_configured(get_settings()):
        raise llm.LLMNotConfigured(llm.NOT_CONFIGURED_MESSAGE)

    def complete_fn(conversation: list[dict], tools) -> dict:
        return llm.stream_complete(
            conversation, tools,
            on_delta=lambda delta: on_event({"type": "token", "delta": delta}))

    return _drive(messages, focus, actor, complete_fn, on_event)
