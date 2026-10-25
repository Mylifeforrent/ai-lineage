"""LLM 接入层（M5：LangChain 化，演进规划 07 §4.2）。

M4 期为手写 urllib 客户端；M5 起统一走 LangChain：

- ``get_chat_model()``：``ChatOpenAI``（OpenAI / 阿里云 DashScope 兼容模式 /
  DeepSeek 等 OpenAI 兼容供应商，`base_url` 即可切换）；
- ``complete()``：**保留 M4 的 OpenAI dict 签名与返回形态**（``chat.py`` 编排
  与测试 monkeypatch 均依赖它），内部经 LangChain ``invoke`` 完成转换；
- ``stream_complete()``：流式聚合（SSE 用），逐 token 回调 + 返回聚合后的
  OpenAI dict 形态；
- ``get_embeddings()``：``OpenAIEmbeddings``（EMBEDDING_* 配置齐全才返回，
  否则 None——语义建议降级为纯启发式）。

供应商矩阵见 docs/03_dev/07_AI模块演进规划.md §4.1：
DeepSeek（chat 专用）/ 阿里云 DashScope / OpenAI。

测试约定：``chat.py`` 通过模块属性 ``llm.complete`` 调用，测试用
``monkeypatch.setattr("clew.ai.llm.complete", fake)`` 完全避免真实联网；
流式测试同理 monkeypatch ``llm.stream_complete``。
"""

from __future__ import annotations

import json
from typing import Callable, Iterator

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from ..config import Settings, get_settings

REQUEST_TIMEOUT_SECONDS = 60

NOT_CONFIGURED_MESSAGE = (
    "未配置 LLM：请在仓库根 .env 中设置 LLM_BASE_URL / LLM_MODEL"
    "（LLM_API_KEY 视供应商要求填写）"
)

_EMBEDDING_NOT_CONFIGURED_MESSAGE = (
    "未配置 embedding：请在 .env 设置 EMBEDDING_BASE_URL / EMBEDDING_MODEL"
    "（EMBEDDING_API_KEY 视供应商要求填写）"
)


class LLMNotConfigured(RuntimeError):
    """缺少必要的 LLM 配置（路由层转 503）。"""


class LLMError(RuntimeError):
    """LLM 服务不可达、返回非 200 或响应结构不合法（路由层转 502）。"""


def is_configured(settings: Settings | None = None) -> bool:
    """base_url 与 model 均非空即视为已配置；API Key 对本地服务可省略。"""
    s = settings or get_settings()
    return bool(s.llm_base_url.strip() and s.llm_model.strip())


def endpoint_url(base_url: str) -> str:
    """兼容保留：把 base_url 归一化为 chat/completions 端点（LangChain 不需要，
    供日志与外部脚本定位端点使用）。"""
    base = base_url.strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _require_configured(settings: Settings) -> None:
    if not is_configured(settings):
        raise LLMNotConfigured(NOT_CONFIGURED_MESSAGE)


def get_chat_model(settings: Settings | None = None) -> ChatOpenAI:
    """按配置构造 ChatOpenAI（每次调用新建，模型实例非线程安全不缓存）。"""
    s = settings or get_settings()
    _require_configured(s)
    return ChatOpenAI(
        model=s.llm_model.strip(),
        api_key=s.llm_api_key.strip() or None,
        base_url=s.llm_base_url.strip(),
        temperature=0,
        timeout=REQUEST_TIMEOUT_SECONDS,
        max_retries=1,
    )


def get_embeddings(settings: Settings | None = None) -> OpenAIEmbeddings | None:
    """embedding 未配置时返回 None（语义建议降级为纯启发式）。"""
    s = settings or get_settings()
    if not (s.embedding_base_url.strip() and s.embedding_model.strip()):
        return None
    return OpenAIEmbeddings(
        model=s.embedding_model.strip(),
        api_key=s.embedding_api_key.strip() or None,
        base_url=s.embedding_base_url.strip(),
        # 非 OpenAI 供应商（如 DashScope）不支持其本地分词器的
        # 上下文长度预检，关闭后按整段直发
        check_embedding_ctx_length=False,
        chunk_size=16,
        max_retries=1,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


# ---------- 消息与工具格式转换（OpenAI dict ↔ LangChain） ----------


def _to_lc_messages(messages: list[dict]) -> list:
    lc: list = []
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if role == "system":
            lc.append(SystemMessage(content=str(content or "")))
        elif role == "user":
            lc.append(HumanMessage(content=str(content or "")))
        elif role == "assistant":
            tool_calls = []
            for call in message.get("tool_calls") or []:
                function = call.get("function") or {}
                try:
                    args = json.loads(function.get("arguments") or "{}")
                except (TypeError, json.JSONDecodeError):
                    args = {}
                tool_calls.append({
                    "name": function.get("name") or "",
                    "args": args if isinstance(args, dict) else {},
                    "id": call.get("id") or "",
                })
            lc.append(AIMessage(content=str(content or ""), tool_calls=tool_calls))
        elif role == "tool":
            lc.append(ToolMessage(
                content=str(content or ""),
                tool_call_id=str(message.get("tool_call_id") or ""),
            ))
    return lc


def _to_openai_message(message: AIMessage) -> dict:
    """把 LangChain AIMessage 转回 chat.py 期望的 OpenAI message dict。"""
    content = message.content
    if not isinstance(content, str):
        # 兼容分段数组形态，拼接为纯文本
        content = "".join(
            part if isinstance(part, str)
            else (part.get("text") or "") if isinstance(part, dict) else str(part)
            for part in (content or [])
        )
    result: dict = {"role": "assistant", "content": content}
    if message.tool_calls:
        result["tool_calls"] = [{
            "id": call.get("id") or "",
            "type": "function",
            "function": {
                "name": call.get("name") or "",
                "arguments": json.dumps(
                    call.get("args") or {}, ensure_ascii=False),
            },
        } for call in message.tool_calls]
    return result


def _openai_response(message: AIMessage) -> dict:
    return {"choices": [{"message": _to_openai_message(message)}]}


def _bind_tools(model: ChatOpenAI, tools: list[dict] | None):
    if not tools:
        return model
    # bind_tools 直接接受 OpenAI function calling JSON Schema
    return model.bind_tools(tools)


def complete(messages: list[dict], tools: list[dict] | None = None) -> dict:
    """非流式调用：保留 M4 的 OpenAI dict 签名（chat.py 编排与测试依赖）。

    ``tools`` 为空（None 或空列表）时不发送 tools/tool_choice，用于收口回答。
    配置缺失抛 :class:`LLMNotConfigured`；供应商错误抛 :class:`LLMError`。
    """
    settings = get_settings()
    _require_configured(settings)
    model = _bind_tools(get_chat_model(settings), tools)
    try:
        result = model.invoke(_to_lc_messages(messages))
    except LLMNotConfigured:
        raise
    except Exception as exc:  # LangChain 统一抛 Exception 子类，收敛为 LLMError
        raise LLMError(f"LLM 调用失败：{exc}") from None
    if not isinstance(result, AIMessage):
        raise LLMError("LLM 返回的消息类型异常")
    return _openai_response(result)


def stream_complete(
    messages: list[dict],
    tools: list[dict] | None,
    on_delta: Callable[[str], None] | None = None,
) -> dict:
    """流式调用：逐 token 回调内容增量，返回与 :func:`complete` 同形态的 dict。

    含 ``tool_call_chunks`` 的 chunk 属于工具调用轮，不外发文本；
    仅最终回答轮的 content 会触发 ``on_delta``。
    """
    settings = get_settings()
    _require_configured(settings)
    model = _bind_tools(get_chat_model(settings), tools)
    aggregated: AIMessageChunk | None = None
    try:
        for chunk in model.stream(_to_lc_messages(messages)):
            aggregated = chunk if aggregated is None else aggregated + chunk
            has_tool = bool(getattr(chunk, "tool_call_chunks", None))
            if not has_tool and on_delta is not None:
                text = chunk.content if isinstance(chunk.content, str) else ""
                if text:
                    on_delta(text)
    except LLMNotConfigured:
        raise
    except Exception as exc:
        raise LLMError(f"LLM 流式调用失败：{exc}") from None
    if aggregated is None or not isinstance(aggregated, AIMessage):
        raise LLMError("LLM 流式响应为空")
    return _openai_response(aggregated)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """批量向量化；embedding 未配置抛 :class:`LLMNotConfigured`。"""
    model = get_embeddings()
    if model is None:
        raise LLMNotConfigured(_EMBEDDING_NOT_CONFIGURED_MESSAGE)
    try:
        return model.embed_documents(texts)
    except Exception as exc:
        raise LLMError(f"embedding 调用失败：{exc}") from None
