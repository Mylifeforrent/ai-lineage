"""AI 自动补描述：草稿 → 人工确认 → annotation（M5，演进规划 07 §4.5）。

草稿落在 ``description_draft`` 工作区表，**不触碰** ``field.description``
（原始导入值，业务不变量：原始导入与人工见解分离）；采纳时写 annotation
（追加式业务说明），拒绝则标记 rejected 且不再为该字段重复生成。

生成输入：字段名/类型/现状描述 + 上下游边 + 其他数据集的同名字段——全部来自
既有只读查询，不联网拿任何额外数据；生成调用走统一 LLM 接入层（llm.complete）。
"""

from __future__ import annotations

import sqlite3

from ..changes import now
from . import llm
from .llm import LLMError, LLMNotConfigured

MAX_DRAFT_FIELDS = 10
DRAFT_MAX_CHARS = 200

_DRAFT_PROMPT = """你是数据目录的文档助手。为下面的数据字段写一句中文描述（不超过 60 字），\
说明它是什么、怎么来的（如果给了上游信息）。只输出描述本身，不要任何前缀、引号或解释。

字段：{dataset}.{name}（类型 {field_type}）
现状描述：{description}
上下游血缘：{lineage}
其他数据集的同名字段：{siblings}
"""


class DescriptionError(RuntimeError):
    """草稿生成/流转的业务错误（路由层转 400/404）。"""


# ---------- 生成 ----------


def _field_context(conn: sqlite3.Connection, dataset: str, name: str) -> dict:
    row = conn.execute(
        "SELECT name, field_type, COALESCE(description, '') AS description"
        " FROM field WHERE dataset_id=? AND name=?", (dataset, name)).fetchone()
    if row is None:
        raise LookupError(f"字段「{dataset}.{name}」不存在")
    edges = conn.execute(
        "SELECT from_dataset, from_field, to_dataset, to_field, transform,"
        " confidence FROM edge"
        " WHERE (from_dataset=? AND from_field=?) OR (to_dataset=? AND to_field=?)"
        " ORDER BY id LIMIT 8", (dataset, name, dataset, name)).fetchall()
    lineage = "；".join(
        f"{e['from_dataset']}.{e['from_field']} → {e['to_dataset']}.{e['to_field']}"
        f"（{e['transform'] or '未填写'}，置信度 {e['confidence']}）" for e in edges
    ) or "无"
    siblings = conn.execute(
        "SELECT dataset_id || '.' || name AS ref FROM field"
        " WHERE name=? AND dataset_id<>? ORDER BY dataset_id LIMIT 5",
        (name, dataset)).fetchall()
    return {
        "dataset": dataset,
        "name": name,
        "field_type": row["field_type"] or "未知",
        "description": row["description"] or "（空）",
        "lineage": lineage,
        "siblings": "、".join(s["ref"] for s in siblings) or "无",
    }


def draft_descriptions(conn: sqlite3.Connection, dataset: str,
                       fields: list[str], actor: str) -> list[dict]:
    """为一组字段生成描述草稿并落 pending；返回可确认的草稿清单。

    - ``fields`` 为空时自动选取该数据集描述为空的字段（上限 MAX_DRAFT_FIELDS）；
    - 已有 pending 草稿的字段跳过；rejected 的字段也跳过（不再重复生成）；
    - 单字段生成失败不阻断其余字段。
    """
    if conn.execute("SELECT 1 FROM dataset WHERE id=?", (dataset,)).fetchone() is None:
        raise LookupError(f"数据集「{dataset}」不存在")

    if fields:
        placeholders = ",".join("?" for _ in fields[:MAX_DRAFT_FIELDS])
        rows = conn.execute(
            f"SELECT name FROM field WHERE dataset_id=? AND name IN ({placeholders})"
            " ORDER BY name", (dataset, *fields[:MAX_DRAFT_FIELDS])).fetchall()
    else:
        rows = conn.execute(
            "SELECT name FROM field WHERE dataset_id=?"
            " AND (description IS NULL OR description='')"
            " ORDER BY name LIMIT ?", (dataset, MAX_DRAFT_FIELDS)).fetchall()
    if not rows:
        raise LookupError("没有可起草的字段（字段不存在，或描述均已填写且未指定字段）")

    blocked = {
        r["field_name"] for r in conn.execute(
            "SELECT field_name FROM description_draft WHERE dataset_id=?"
            " AND status IN ('pending','accepted','rejected')", (dataset,)).fetchall()
    }
    targets = [r["name"] for r in rows if r["name"] not in blocked][:MAX_DRAFT_FIELDS]
    if not targets:
        raise LookupError(
            "所选字段都已有草稿（待确认/已采纳/已拒绝），请先在草稿区处理")

    timestamp = now()
    settings_model = "unknown"
    try:
        settings_model = llm.get_chat_model().model_name or "unknown"
    except Exception:  # 模型名仅用于审计，失败不阻断
        pass

    drafts: list[dict] = []
    for name in targets:
        context = _field_context(conn, dataset, name)
        try:
            response = llm.complete(
                [{"role": "user",
                  "content": _DRAFT_PROMPT.format(**context)}])
            content = response["choices"][0]["message"]["content"]
            draft = (content or "").strip().splitlines()[0][:DRAFT_MAX_CHARS]
        except (LLMError, LLMNotConfigured, KeyError, IndexError):
            continue  # 单字段失败不阻断
        if not draft:
            continue
        cur = conn.execute(
            "INSERT INTO description_draft(dataset_id, field_name, draft,"
            " model, status, created_at) VALUES (?,?,?,?,'pending',?)",
            (dataset, name, draft, settings_model, timestamp))
        row = conn.execute(
            "SELECT id, dataset_id, field_name, draft, model, status, created_at"
            " FROM description_draft WHERE id=?", (cur.lastrowid,)).fetchone()
        drafts.append(dict(row))
    if not drafts:
        raise DescriptionError("描述草稿生成失败：LLM 未返回有效内容，请稍后重试")
    return drafts


# ---------- 确认流 ----------


def list_drafts(conn: sqlite3.Connection, dataset: str | None,
                status: str | None) -> list[dict]:
    sql = ("SELECT id, dataset_id, field_name, draft, model, status, created_at,"
           " decided_at FROM description_draft WHERE 1=1")
    params: list[str] = []
    if dataset:
        sql += " AND dataset_id=?"
        params.append(dataset)
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY id DESC LIMIT 100"
    return [dict(row) for row in conn.execute(sql, params).fetchall()]


def _pending_draft(conn: sqlite3.Connection, draft_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT id, dataset_id, field_name, draft, status FROM description_draft"
        " WHERE id=?", (draft_id,)).fetchone()
    if row is None:
        raise LookupError(f"描述草稿 #{draft_id} 不存在")
    if row["status"] != "pending":
        raise DescriptionError(f"草稿 #{draft_id} 已处理（{row['status']}）")
    return row


def accept_draft(conn: sqlite3.Connection, draft_id: int, actor: str) -> dict:
    """采纳草稿：写 annotation（追加式业务说明）+ 置 accepted。"""
    row = _pending_draft(conn, draft_id)
    conn.execute(
        "INSERT INTO annotation(target_kind, target_id, body, author, created_at)"
        " VALUES ('field', ?, ?, ?, ?)",
        (f"{row['dataset_id']}.{row['field_name']}",
         f"【AI 描述采纳｜model={conn.execute('SELECT model FROM description_draft WHERE id=?', (draft_id,)).fetchone()['model']}】{row['draft']}",
         actor, now()))
    conn.execute(
        "UPDATE description_draft SET status='accepted', decided_at=? WHERE id=?",
        (now(), draft_id))
    return dict(conn.execute(
        "SELECT id, dataset_id, field_name, draft, model, status, created_at,"
        " decided_at FROM description_draft WHERE id=?", (draft_id,)).fetchone())


def reject_draft(conn: sqlite3.Connection, draft_id: int, actor: str) -> None:
    """拒绝草稿：置 rejected（该字段不再重复生成）。"""
    row = _pending_draft(conn, draft_id)
    conn.execute(
        "UPDATE description_draft SET status='rejected', decided_at=? WHERE id=?",
        (now(), draft_id))
