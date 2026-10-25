"""Seed an English demo workspace for README recordings.

Uses the real upload + import pipeline (sha256 dedup, locator verification)
so the recorded UI shows exactly what a user would get from a manifest
import. Run against a throwaway DATA_DIR:

    cd backend
    DATA_DIR=/tmp/clew-demo/data uv run python ../../scripts/demo/seed_demo_en.py
"""

from __future__ import annotations

import csv as csvmod
import io
import json
import sys
from datetime import UTC, datetime

from openpyxl import Workbook

from clew.db import get_db, init_db
from clew.import_service import run_import
from clew.manifest import read_json_manifest
from clew.routes.files import store_upload
from clew.security import hash_password

DATASET_IDS = ("d0", "d1", "d2", "d3", "d4")

# dataset_id, dataset_name, [(field, type, file, file_type, locator, description)]
DATASETS = [
    ("d0", "Orders Raw", [
        ("order_id", "STRING", "orders_raw.csv", "csv", {"header": "order_id"},
         "Storefront order identifier"),
        ("amount", "DECIMAL", "orders_raw.csv", "csv", {"header": "amount"},
         "Gross order amount in USD"),
        ("region", "STRING", "orders_raw.csv", "csv", {"header": "region"},
         "Sales region captured at checkout"),
        ("customer_id", "STRING", "orders_raw.csv", "csv", {"header": "customer_id"},
         "Customer identifier from the storefront"),
    ]),
    ("d1", "Orders Clean", [
        ("order_id", "STRING", "orders_clean.xlsx", "xlsx",
         {"sheet": "Orders", "header_path": ["Order Info", "Order ID"],
          "header_rows": 2, "row_start": 3}, "Trimmed and normalized order id"),
        ("amount", "DECIMAL", "orders_clean.xlsx", "xlsx",
         {"sheet": "Orders", "header_path": ["Order Info", "Amount"],
          "header_rows": 2, "row_start": 3}, "Amount after discount adjustment"),
        ("region", "STRING", "orders_clean.xlsx", "xlsx",
         {"sheet": "Orders", "header_path": ["Order Info", "Region"],
          "header_rows": 2, "row_start": 3}, "Standardized sales region"),
        ("customer_id", "STRING", "orders_clean.xlsx", "xlsx",
         {"sheet": "Orders", "header_path": ["Order Info", "Customer"],
          "header_rows": 2, "row_start": 3}, "Deduplicated customer id"),
    ]),
    ("d2", "Order Items", [
        ("order_id", "STRING", "order_items.json", "json",
         {"json_path": "$.data.items[*].order_id"}, "Order id per line item"),
        ("amount", "DECIMAL", "order_items.json", "json",
         {"json_path": "$.data.items[*].amount"}, "Line item amount"),
        ("region", "STRING", "order_items.json", "json",
         {"json_path": "$.data.items[*].region"}, "Line item region"),
    ]),
    ("d3", "Daily Summary", [
        ("order_id", "STRING", "daily_summary.csv", "csv", {"header": "order_id"},
         "Order id in the daily rollup"),
        ("amount", "DECIMAL", "daily_summary.csv", "csv", {"header": "amount"},
         "Amount aggregated per day"),
        ("region", "STRING", "daily_summary.csv", "csv", {"header": "region"},
         "Region in the daily rollup"),
    ]),
    ("d4", "Revenue Report", [
        ("order_id", "STRING", "revenue_report.json", "json",
         {"json_path": "$.report.rows[*].order_id"}, "Report line order id"),
        ("amount", "DECIMAL", "revenue_report.json", "json",
         {"json_path": "$.report.rows[*].amount"}, "Reported revenue amount"),
        ("region", "STRING", "revenue_report.json", "json",
         {"json_path": "$.report.rows[*].region"}, "Reporting region"),
    ]),
]

ROWS = [
    ("SO-1001", 19.8, "East", "C-1041"),
    ("SO-1002", 59.0, "North", "C-1042"),
    ("SO-1003", 12.5, "South", "C-1043"),
    ("SO-1004", 88.4, "West", "C-1044"),
    ("SO-1005", 34.2, "East", "C-1045"),
]

USERS = [
    ("admin", "admin123", "Ada Admin", "admin"),
    ("editor", "editor123", "Evan Editor", "editor"),
    ("viewer", "viewer123", "Vera Viewer", "viewer"),
]


def _csv(rows: list[list]) -> bytes:
    buf = io.StringIO()
    csvmod.writer(buf).writerows(rows)
    return buf.getvalue().encode("utf-8")


def _file_bytes() -> dict[str, bytes]:
    d0 = _csv([["order_id", "amount", "region", "customer_id"],
               *[list(r) for r in ROWS]])

    # Daily rollup: same schema, different values (avoids sha256 dedup).
    d3 = _csv([["order_id", "amount", "region"],
               *[[oid, round(amount * 2, 2), region]
                 for oid, amount, region, _ in ROWS]])

    wb = Workbook()
    wb.properties.created = datetime(2026, 1, 1)
    wb.properties.modified = datetime(2026, 1, 1)
    ws = wb.active
    ws.title = "Orders"
    ws["B1"] = "Order Info"
    ws.merge_cells("B1:F1")
    for col, name in zip("BCDEF", ["Order ID", "Amount", "Region", "Customer", "Source"],
                         strict=True):
        ws[f"{col}2"] = name
    for row_idx, (oid, amount, region, customer) in enumerate(ROWS, start=3):
        ws.cell(row_idx, 2, oid)
        ws.cell(row_idx, 3, amount)
        ws.cell(row_idx, 4, region)
        ws.cell(row_idx, 5, customer)
        ws.cell(row_idx, 6, "seed_demo")
    xlsx_buf = io.BytesIO()
    wb.save(xlsx_buf)

    d2 = json.dumps({"data": {"items": [
        {"order_id": oid, "amount": amount, "region": region}
        for oid, amount, region, _ in ROWS]}}, ensure_ascii=False).encode("utf-8")

    d4 = json.dumps({"report": {"rows": [
        {"order_id": oid, "amount": round(amount * 1.1, 2), "region": region}
        for oid, amount, region, _ in ROWS]}}, ensure_ascii=False).encode("utf-8")

    return {
        "orders_raw.csv": d0,
        "orders_clean.xlsx": xlsx_buf.getvalue(),
        "order_items.json": d2,
        "daily_summary.csv": d3,
        "revenue_report.json": d4,
    }


def _manifest(file_ids: dict[str, int]) -> dict:
    datasets = []
    for dataset_id, dataset_name, fields in DATASETS:
        for name, field_type, filename, file_type, locator, description in fields:
            datasets.append({
                "dataset_id": dataset_id,
                "dataset_name": dataset_name,
                "field_name": name,
                "field_type": field_type,
                "src_file": str(file_ids[filename]),
                "src_type": file_type,
                "src_locator": locator,
                "description": description,
            })
    lineage = []
    for src, dst in zip(DATASET_IDS, DATASET_IDS[1:]):
        lineage.append({
            "from_dataset": src, "from_field": "order_id",
            "to_dataset": dst, "to_field": "order_id",
            "transform": "trim + cast + normalize",
            "confidence": 1.0, "note": "Field-level lineage from the import manifest",
        })
        lineage.append({
            "from_dataset": src, "from_field": None,
            "to_dataset": dst, "to_field": None,
            "transform": "table projection",
            "confidence": 1.0, "note": "Table-level lineage from the import manifest",
        })
    lineage.append({
        "from_dataset": "d0", "from_field": "customer_id",
        "to_dataset": "d1", "to_field": "customer_id",
        "transform": "dedupe",
        "confidence": 1.0, "note": "Customer id deduplication",
    })
    return {"datasets": datasets, "lineage": lineage}


def _ensure_users() -> None:
    created = datetime.now(UTC).isoformat(timespec="seconds")
    with get_db() as conn:
        for username, password, display, role in USERS:
            if conn.execute("SELECT 1 FROM user WHERE username=?", (username,)).fetchone():
                continue
            conn.execute(
                "INSERT INTO user(username, password_hash, display_name, role, created_at)"
                " VALUES (?,?,?,?,?)",
                (username, hash_password(password), display, role, created),
            )


def main() -> None:
    init_db()
    _ensure_users()

    with get_db() as conn:
        done = conn.execute("SELECT 1 FROM dataset WHERE id='d4'").fetchone()
    if done:
        print("English demo data already present; skipping import.", file=sys.stderr)
        return

    bound, file_ids = [], {}
    for name, data in _file_bytes().items():
        rec = store_upload(name, data, "admin")
        bound.append(rec)
        file_ids[name] = rec["id"]

    manifest = json.dumps(_manifest(file_ids)).encode()
    ds_recs, edge_recs = read_json_manifest(manifest)
    batch_id, version_no, report = run_import(
        "admin", "json", bound, ds_recs, edge_recs)
    print(
        f"Seeded: batch={batch_id} version=v{version_no} "
        f"datasets={len(DATASETS)} summary={report.summary}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
