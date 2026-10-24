"""OpenAI 兼容 Chat Completions 客户端（M4）。

只使用 Python 标准库 ``urllib``（不引入新依赖）调用
``{LLM_BASE_URL}/chat/completions``；供应商、密钥与模型来自仓库根 ``.env``
（Settings 的 ``LLM_BASE_URL`` / ``LLM_API_KEY`` / ``LLM_MODEL``）。

测试约定：``chat.py`` 通过模块属性 ``llm.complete`` 调用本函数，
测试用 ``monkeypatch.setattr("lineagelite.ai.llm.complete", fake)``
即可完全避免真实联网。
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from ..config import Settings, get_settings

REQUEST_TIMEOUT_SECONDS = 60

NOT_CONFIGURED_MESSAGE = (
    "未配置 LLM：请在仓库根 .env 中设置 LLM_BASE_URL / LLM_MODEL"
    "（LLM_API_KEY 视供应商要求填写）"
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
    """把 base_url 归一化为 chat/completions 端点。

    兼容两种写法：``https://host/v1`` 与已写全的
    ``https://host/v1/chat/completions``。
    """
    base = base_url.strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def complete(messages: list[dict], tools: list[dict] | None = None) -> dict:
    """调用 OpenAI 兼容 /chat/completions，返回解析后的 JSON 响应。

    ``tools`` 为空（None 或空列表）时不发送 tools/tool_choice，用于收口回答。
    网络/HTTP/JSON 错误统一抛 :class:`LLMError`，配置缺失抛
    :class:`LLMNotConfigured`。
    """
    settings = get_settings()
    if not is_configured(settings):
        raise LLMNotConfigured(NOT_CONFIGURED_MESSAGE)

    payload: dict = {"model": settings.llm_model.strip(), "messages": messages}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    api_key = settings.llm_api_key.strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    request = urllib.request.Request(
        endpoint_url(settings.llm_base_url),
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(
                request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        # 读取响应体便于前端/日志定位（截断，避免回显超长内容）
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise LLMError(f"LLM 服务返回 HTTP {exc.code}：{body}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise LLMError(f"LLM 服务不可达：{exc}") from None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise LLMError("LLM 服务返回非 JSON 响应") from None
    if not isinstance(data, dict):
        raise LLMError("LLM 服务返回的响应不是 JSON 对象")
    return data
