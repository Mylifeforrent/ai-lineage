"""导入编排：校验 → 入库 → change_log → 导入报告（设计方案 §3.5 / §4.2）。

写路径顺序：先 datasets/fields（满足边表复合外键），再 lineage。
每条变更写 change_log（op + before/after 快照），批次回滚据此反做。
"""

import json
from datetime import UTC, datetime

from .config import resolve_storage
from .db import get_db
from .locator import LocatorError, check_csv, check_json, check_xlsx
from .models import (CsvLocatorIn, DatasetFieldRecord, ImportReport,
                     ImportReportItem, JsonLocatorIn, LineageEdgeRecord,
                     XlsxLocatorIn)

CHECKERS = {"csv": check_csv, "xlsx": check_xlsx, "json": check_json}
LOCATOR_MODELS = {"csv": CsvLocatorIn, "xlsx": XlsxLocatorIn, "json": JsonLocatorIn}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _snap(row: dict) -> str:
    return json.dumps(row, ensure_ascii=False, sort_keys=True)


def _log(conn, batch_id: int, kind: str, key: str, op: str,
         before: dict | None, after: dict | None, actor: str) -> None:
    conn.execute(
        "INSERT INTO change_log(batch_id, entity_kind, entity_key, op, before, after, actor, created_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (batch_id, kind, key, op,
         _snap(before) if before else None, _snap(after) if after else None,
         actor, _now()))


def _resolve_source_file(conn, ref: str, bound: list) -> tuple[int, str] | None:
    """src_file 引用解析：源文件库 ID 或本批绑定文件集内的原始文件名。"""
    if ref.isdigit():
        for f in bound:
            if f["id"] == int(ref):
                return f["id"], f["src_type"]
        return None
    matches = [f for f in bound if f["original_name"] == ref]
    if len(matches) == 1:
        return matches[0]["id"], matches[0]["src_type"]
    if len(matches) > 1:
        raise ValueError(f"src_file「{ref}」在本批文件集中不唯一")
    return None


def _upsert_field(conn, rec: DatasetFieldRecord, sf_id: int,
                  locator_envelope: str, actor: str, batch_id: int,
                  items: list[ImportReportItem]) -> None:
    ref = f"{rec.dataset_id}.{rec.field_name}"
    payload = {"dataset_id": rec.dataset_id, "name": rec.field_name,
               "field_type": rec.field_type, "source_file_id": sf_id,
               "src_locator": locator_envelope, "description": rec.description}
    existing = conn.execute("SELECT * FROM field WHERE dataset_id=? AND name=?",
                            (rec.dataset_id, rec.field_name)).fetchone()
    if existing is None:
        conn.execute(
            "INSERT INTO field(dataset_id, name, field_type, source_file_id,"
            " src_locator, description, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (payload["dataset_id"], payload["name"], payload["field_type"],
             payload["source_file_id"], payload["src_locator"],
             payload["description"], _now(), _now()))
        _log(conn, batch_id, "field", ref, "added", None, payload, actor)
        items.append(ImportReportItem(status="ok", kind="field", ref=ref,
                                      source_row=rec.row))
        return
    before = {"dataset_id": existing["dataset_id"], "name": existing["name"],
              "field_type": existing["field_type"],
              "source_file_id": existing["source_file_id"],
              "src_locator": existing["src_locator"],
              "description": existing["description"]}
    if all(before[k] == payload[k] for k in payload):
        items.append(ImportReportItem(status="ok", kind="field", ref=ref,
                                      reason="unchanged", source_row=rec.row))
        return
    conn.execute(
        "UPDATE field SET field_type=?, source_file_id=?, src_locator=?,"
        " description=?, updated_at=? WHERE dataset_id=? AND name=?",
        (payload["field_type"], payload["source_file_id"], payload["src_locator"],
         payload["description"], _now(), rec.dataset_id, rec.field_name))
    _log(conn, batch_id, "field", ref, "updated", before, payload, actor)
    items.append(ImportReportItem(status="ok", kind="field", ref=ref,
                                  source_row=rec.row))


def _ensure_dataset(conn, rec: DatasetFieldRecord, actor: str, batch_id: int) -> None:
    if conn.execute("SELECT 1 FROM dataset WHERE id=?",
                    (rec.dataset_id,)).fetchone():
        return
    conn.execute(
        "INSERT INTO dataset(id, name, description, created_at, updated_at)"
        " VALUES (?,?,?,?,?)",
        (rec.dataset_id, rec.dataset_name, None, _now(), _now()))
    _log(conn, batch_id, "dataset", rec.dataset_id, "added", None,
         {"id": rec.dataset_id, "name": rec.dataset_name}, actor)


def run_import(actor: str, fmt: str, bound_files: list[dict],
               ds_recs: list[DatasetFieldRecord],
               edge_recs: list[LineageEdgeRecord]) -> tuple[int, int, ImportReport]:
    """执行一次导入，返回 (batch_id, version_no, report)。"""
    items: list[ImportReportItem] = []

    with get_db() as conn:
        version_no = (conn.execute(
            "SELECT COALESCE(MAX(version_no),0)+1 AS n FROM import_batch"
        ).fetchone()["n"])
        cur = conn.execute(
            "INSERT INTO import_batch(version_no, file_names, format, created_by, created_at)"
            " VALUES (?,?,?,?,?)",
            (version_no,
             json.dumps([f["original_name"] for f in bound_files], ensure_ascii=False),
             fmt, actor, _now()))
        batch_id = cur.lastrowid

        # ---------- 阶段一：datasets / fields ----------
        for rec in ds_recs:
            ref = f"{rec.dataset_id}.{rec.field_name}"
            try:
                # 清单行级解析错误：整行拒绝（reason 即行内错误说明）
                if rec.parse_error:
                    raise ValueError(rec.parse_error)
                if not rec.dataset_id or not rec.field_name:
                    raise ValueError("dataset_id / field_name 必填")
                if rec.src_type not in CHECKERS:
                    raise ValueError(f"src_type 必须是 csv/xlsx/json，收到「{rec.src_type}」")
                sf = _resolve_source_file(conn, rec.src_file, bound_files)
                if sf is None:
                    raise ValueError(f"src_file「{rec.src_file}」无法在本批文件集中唯一定位")
                sf_id, sf_type = sf
                if sf_type != rec.src_type:
                    raise ValueError(
                        f"src_type「{rec.src_type}」与源文件实际类型「{sf_type}」不符")
            except ValueError as e:
                items.append(ImportReportItem(status="rejected", kind="field", ref=ref,
                                              reason=str(e), source_row=rec.row))
                continue

            src_path = str(resolve_storage(conn.execute(
                "SELECT storage_path FROM source_file WHERE id=?",
                (sf_id,)).fetchone()["storage_path"]))
            try:
                loc_in = LOCATOR_MODELS[rec.src_type](**rec.src_locator)
            except Exception as e:
                items.append(ImportReportItem(
                    status="rejected", kind="field", ref=ref,
                    reason=f"定位器结构校验失败：{e}", source_row=rec.row))
                continue
            try:
                resolved = CHECKERS[rec.src_type](src_path, loc_in)
            except LocatorError as e:
                items.append(ImportReportItem(
                    status="rejected", kind="field", ref=ref,
                    reason=f"实文件核查失败：{e}", source_row=rec.row))
                continue

            locator_envelope = json.dumps(
                {"type": rec.src_type,
                 "input": loc_in.model_dump(exclude_none=True),
                 "resolved": resolved},
                ensure_ascii=False)
            _ensure_dataset(conn, rec, actor, batch_id)
            _upsert_field(conn, rec, sf_id, locator_envelope, actor, batch_id, items)

        # ---------- 阶段二：lineage ----------
        seen_edges: dict[tuple, int] = {}  # 自然键 -> items 下标
        for rec in edge_recs:
            ref = (f"{rec.from_dataset}.{rec.from_field or '*'}-->"
                   f"{rec.to_dataset}.{rec.to_field or '*'}")
            try:
                # 清单行级解析错误：整行拒绝（reason 即行内错误说明）
                if rec.parse_error:
                    raise ValueError(rec.parse_error)
                if not rec.from_dataset or not rec.to_dataset:
                    raise ValueError("from_dataset / to_dataset 必填")
                # 混合字段边（一空一非空）语义无效：表级或字段级必须二选一
                if bool(rec.from_field) != bool(rec.to_field):
                    raise ValueError(
                        "血缘边必须同时提供上下游字段（字段级）或都不提供（表级）")
                if rec.from_field and not conn.execute(
                        "SELECT 1 FROM field WHERE dataset_id=? AND name=?",
                        (rec.from_dataset, rec.from_field)).fetchone():
                    raise ValueError(f"上游字段 {rec.from_dataset}.{rec.from_field} 不存在")
                if rec.to_field and not conn.execute(
                        "SELECT 1 FROM field WHERE dataset_id=? AND name=?",
                        (rec.to_dataset, rec.to_field)).fetchone():
                    raise ValueError(f"下游字段 {rec.to_dataset}.{rec.to_field} 不存在")
                if not conn.execute("SELECT 1 FROM dataset WHERE id=?",
                                    (rec.from_dataset,)).fetchone() or \
                   not conn.execute("SELECT 1 FROM dataset WHERE id=?",
                                    (rec.to_dataset,)).fetchone():
                    raise ValueError("血缘引用的数据集不存在")
                confidence = rec.confidence if rec.confidence is not None else 1.0
                if not 0 <= confidence <= 1:
                    raise ValueError("confidence 需在 0~1 之间")
            except ValueError as e:
                items.append(ImportReportItem(status="rejected", kind="edge", ref=ref,
                                              reason=str(e), source_row=rec.row))
                continue

            payload = {"from_dataset": rec.from_dataset, "from_field": rec.from_field,
                       "to_dataset": rec.to_dataset, "to_field": rec.to_field,
                       "transform": rec.transform, "confidence": confidence,
                       "source": "imported", "note": rec.note}
            key = (rec.from_dataset, rec.from_field, rec.to_dataset, rec.to_field)

            if key in seen_edges:  # 同批重复：后到覆盖 transform/note（设计方案 §3.5-4）
                idx = seen_edges[key]
                first = items[idx]
                conn.execute(
                    "UPDATE edge SET transform=?, confidence=?, note=?, updated_by=?,"
                    " updated_at=? WHERE from_dataset=? AND from_field IS ? AND"
                    " to_dataset=? AND to_field IS ?",
                    (payload["transform"], payload["confidence"], payload["note"],
                     actor, _now(), *key))
                first.status = "merged"
                first.reason = f"同上下游重复，被清单第 {rec.row} 行覆盖"
                continue

            existing = conn.execute(
                "SELECT * FROM edge WHERE from_dataset=? AND from_field IS ? AND"
                " to_dataset=? AND to_field IS ?", key).fetchone()
            if existing is None:
                conn.execute(
                    "INSERT INTO edge(from_dataset, from_field, to_dataset, to_field,"
                    " transform, confidence, source, note, created_by, updated_by,"
                    " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (*key, payload["transform"], payload["confidence"],
                     payload["source"], payload["note"], actor, actor, _now(), _now()))
                _log(conn, batch_id, "edge", ref, "added", None, payload, actor)
            else:
                before = dict(existing)
                before.pop("id")
                before.pop("created_at")
                before.pop("updated_at")
                if all(before[k] == payload[k] for k in payload):
                    items.append(ImportReportItem(status="ok", kind="edge", ref=ref,
                                                  reason="unchanged", source_row=rec.row))
                    seen_edges[key] = len(items) - 1
                    continue
                conn.execute(
                    "UPDATE edge SET transform=?, confidence=?, source=?, note=?,"
                    " updated_by=?, updated_at=? WHERE from_dataset=? AND from_field IS ?"
                    " AND to_dataset=? AND to_field IS ?",
                    (payload["transform"], payload["confidence"], payload["source"],
                     payload["note"], actor, _now(), *key))
                _log(conn, batch_id, "edge", ref, "updated", before, payload, actor)
            items.append(ImportReportItem(status="ok", kind="edge", ref=ref,
                                          source_row=rec.row))
            seen_edges[key] = len(items) - 1

        summary = {"total": len(items),
                   "ok": sum(1 for i in items if i.status == "ok"),
                   "merged": sum(1 for i in items if i.status == "merged"),
                   "rejected": sum(1 for i in items if i.status == "rejected")}
        report = ImportReport(summary=summary, items=items)
        conn.execute("UPDATE import_batch SET report=? WHERE id=?",
                     (report.model_dump_json(), batch_id))

    return batch_id, version_no, report
