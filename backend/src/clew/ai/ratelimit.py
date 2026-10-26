"""AI 路由内存滑动窗口限流（08 号 R11）：无第三方依赖，按用户名限速。

单进程单机部署足够；窗口按进程内存计，多进程部署需外置存储（08 文档 §五
明确不做）。角色校验复用 ``security.require_role``，限流依赖工厂返回的
依赖同时完成「认证 + 角色门槛 + 限速」，超限抛 429 并带 ``Retry-After``。
"""

from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException

from ..security import require_role

# 默认限速：对话类 10 次/60s，血缘建议类 6 次/60s（08 文档 §三 R11；
# 【TBD-OPS】阈值按使用情况调整）
CHAT_WINDOW_SECONDS = 60
CHAT_MAX_REQUESTS = 10
SUGGEST_WINDOW_SECONDS = 60
SUGGEST_MAX_REQUESTS = 6


class _SlidingWindow:
    """每键滑动窗口计数器：溢出抛 429，附 Retry-After 头。"""

    def __init__(self, window_seconds: float, max_requests: int):
        self._window = float(window_seconds)
        self._max = max_requests
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            cutoff = now - self._window
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= self._max:
                retry_after = max(1, math.ceil(self._window - (now - hits[0])))
                raise HTTPException(
                    429,
                    "AI 请求过于频繁，请稍后重试",
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(now)

    def reset(self) -> None:
        """清空全部计数（测试隔离用）。"""
        with self._lock:
            self._hits.clear()


def ai_limiter(window_seconds: float, max_requests: int,
               role: str = "viewer"):
    """构造 AI 路由限流依赖：认证 + 角色门槛 + 滑动窗口限速，返回 user dict。

    返回的依赖函数附带 ``reset()``（清空本桶全部计数，供测试隔离）。
    """

    bucket = _SlidingWindow(window_seconds, max_requests)
    guard = require_role(role)

    def dependency(user: dict = Depends(guard)) -> dict:
        bucket.check(user["username"])
        return user

    dependency.reset = bucket.reset  # 函数对象附件：让实例暴露计数清空
    return dependency
