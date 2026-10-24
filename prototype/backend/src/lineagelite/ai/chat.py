"""AI 对话编排：OpenAI 兼容 function calling 循环（最多 5 轮工具调用）。

流程：
1. 固定 system 提示（含可选的 focus 上下文）+ 前端传来的对话历史；
2. 调 ``llm.complete(messages, tools)``；模型返回 tool_calls 时逐个执行只读工具，
   把结果以 role=tool 的消息追加回去，继续下一轮；
3. 模型不再请求工具时，取该条消息的 content 作为最终 answer；
4. 若连续 5 轮都在调用工具，再发一次不带 tools 的请求强制收口（保证循环有界）。

``tool_trace`` 记录每次工具调用的 ``{tool, args, ok}``；``graph`` 取最后一次
图查询工具（trace_lineage）返回的 GraphPayload，供前端画布联动渲染。
"""

from __future__ import annotations

import json

from ..config import get_settings
from ..db import get_db
from . import llm
from .tools import TOOL_SCHEMAS, run_tool

MAX_TOOL_ROUNDS = 5

SYSTEM_PROMPT = """你是 LineageLite（轻量级 AI 数据血缘工具）的助手。

你可以调用只读工具查询数据集字段、源文件定位、上下游血缘与变更历史：
- search_fields：按关键词定位字段；
- get_field_details：字段详情、源文件定位器与回源预览；
- trace_lineage：按数据集/字段追溯上下游 N 跳子图；
- get_field_history：字段的变更历史。

回答规则：
1. 必须基于工具返回的数据作答，不得编造数据集、字段、边或文件位置；
   查不到时明确说明「未找到」，并给出下一步建议。
2. 用户用中文提问时用中文回答；涉及血缘时说明方向、跳数与置信度，
   涉及回源时给出文件名与定位器（sheet/列/JSONPath）。
3. 你没有写权限，不要声称已修改任何数据。"""


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


def run_chat(messages: list[dict], focus: dict | None = None) -> dict:
    """执行一轮 AI 对话，返回 ``{answer, tool_trace, graph?}``。

    ``messages`` 已由路由层校验为 ``[{role, content}]``（role 仅 user/assistant）。
    未配置 LLM 抛 :class:`llm.LLMNotConfigured`；上游 HTTP/结构错误抛
    :class:`llm.LLMError`。
    """
    if not llm.is_configured(get_settings()):
        raise llm.LLMNotConfigured(llm.NOT_CONFIGURED_MESSAGE)

    conversation: list[dict] = [
        {"role": "system", "content": _system_prompt(focus)},
    ]
    for message in messages:
        conversation.append(
            {"role": message["role"], "content": message["content"]})

    tool_trace: list[dict] = []
    graph: dict | None = None
    rounds = 0

    while True:
        # 第 6 次请求（rounds == 5）不再提供工具，强制模型给出最终回答
        tools = TOOL_SCHEMAS if rounds < MAX_TOOL_ROUNDS else None
        response = llm.complete(conversation, tools)
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
                        result = run_tool(conn, name, args)
                    ok = True
                except Exception as exc:  # 工具错误回传给模型，不中断整轮对话
                    result = {"error": str(exc) or exc.__class__.__name__}
                    ok = False
            else:
                result = {"error": parse_error}
                ok = False

            tool_trace.append({"tool": name, "args": args, "ok": ok})
            if ok and isinstance(result, dict):
                candidate = result.get("graph")
                if _is_graph_payload(candidate):
                    graph = candidate
            conversation.append({
                "role": "tool",
                "tool_call_id": call_id or "",
                "content": json.dumps(result, ensure_ascii=False, default=str),
            })

    payload = {"answer": answer, "tool_trace": tool_trace}
    if graph is not None:
        payload["graph"] = graph
    return payload
