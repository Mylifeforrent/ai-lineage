"""血缘图查询：递归 CTE 一次取出 N 跳子图（设计方案 §4.3）。

两种种子语义：

- **数据集种子**（``field_name is None``）：沿全部相连边（字段级 + 表级）
  双向/单向扩展 N 跳，得到数据集闭包；
- **字段种子**：沿字段级边精确扩展；表级边（``from_field`` / ``to_field``
  均为 NULL）视为两侧数据集的字段全连通，即从一侧任一字段可抵达另一侧
  全部字段。

返回契约中的 ``GraphPayload``：闭包内数据集的**全部字段**（带定位器信封与
来源文件）以及闭包内数据集之间的**全部边**。递归 CTE 写法保持 SQLite /
PostgreSQL 兼容（仅用两种数据库都支持的标准 CTE 语法）。
"""

import json
import sqlite3

DIRECTIONS = ("both", "up", "down")
MAX_HOPS = 5


class LineageNotFound(LookupError):
    """种子数据集或字段不存在。"""


def _direction_arms(table_alias: str, direction: str) -> list[str]:
    """返回递归项里「本跳允许走哪个方向」的谓词片段。"""
    arms: list[str] = []
    if direction in ("both", "down"):
        arms.append(f"e.from_dataset = {table_alias}.dataset_id")
    if direction in ("both", "up"):
        arms.append(f"e.to_dataset = {table_alias}.dataset_id")
    return arms


def _dataset_closure(conn: sqlite3.Connection, dataset_id: str, hops: int,
                     direction: str) -> list[str]:
    """数据集种子的 N 跳闭包（深度 0 为起点）。"""
    arms = _direction_arms("reach", direction)
    sql = f"""
WITH RECURSIVE reach(dataset_id, hop) AS (
  SELECT ?, 0
  UNION
  SELECT CASE WHEN e.from_dataset = reach.dataset_id
              THEN e.to_dataset ELSE e.from_dataset END,
         reach.hop + 1
  FROM reach
  JOIN edge e ON {' OR '.join(arms)}
  WHERE reach.hop < ?
)
SELECT DISTINCT dataset_id FROM reach ORDER BY dataset_id
"""
    rows = conn.execute(sql, (dataset_id, hops)).fetchall()
    return [r["dataset_id"] for r in rows]


def _field_closure(conn: sqlite3.Connection, dataset_id: str, field_name: str,
                   hops: int, direction: str) -> list[str]:
    """字段种子的 N 跳闭包，返回命中的数据集 ID 列表。

    表级边在递归项中通过 ``COALESCE(e.xxx_field, nf.name)`` 展开成**去向一侧**
    数据集的全部字段；字段级边仍只连接 ``from_field`` / ``to_field``。
    只 JOIN 一个 ``field`` 别名，避免同时对 from/to 侧 LEFT JOIN 产生行乘积。
    """
    down = direction in ("both", "down")
    up = direction in ("both", "up")
    arms: list[str] = []
    if down:
        arms.append(
            "((reach.field_name = e.from_field OR e.from_field IS NULL)"
            " AND e.from_dataset = reach.dataset_id)")
    if up:
        arms.append(
            "((reach.field_name = e.to_field OR e.to_field IS NULL)"
            " AND e.to_dataset = reach.dataset_id)")
    sql = f"""
WITH RECURSIVE reach(dataset_id, field_name, hop) AS (
  SELECT ?, ?, 0
  UNION
  SELECT CASE WHEN e.from_dataset = reach.dataset_id
              THEN e.to_dataset ELSE e.from_dataset END,
         CASE WHEN e.from_dataset = reach.dataset_id
              THEN COALESCE(e.to_field, nf.name)
              ELSE COALESCE(e.from_field, nf.name) END,
         reach.hop + 1
  FROM reach
  JOIN edge e ON {' OR '.join(arms)}
  -- 仅当本次走的边是表级边时，才 JOIN 去向一侧的字段（单侧 JOIN，无行乘积）
  LEFT JOIN field nf
         ON nf.dataset_id = CASE WHEN e.from_dataset = reach.dataset_id
                                 THEN e.to_dataset ELSE e.from_dataset END
        AND (CASE WHEN e.from_dataset = reach.dataset_id
                  THEN e.to_field ELSE e.from_field END) IS NULL
  WHERE reach.hop < ?
)
SELECT DISTINCT dataset_id FROM reach ORDER BY dataset_id
"""
    rows = conn.execute(sql, (dataset_id, field_name, hops)).fetchall()
    return [r["dataset_id"] for r in rows]


def _parse_locator(raw: str | None) -> dict:
    """定位器信封解析；损坏数据降级为空中性信封，避免整张图 500。"""
    if not raw:
        return {"type": None, "input": None, "resolved": None}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {"type": None, "input": None, "resolved": None}
    if not isinstance(value, dict):
        return {"type": None, "input": None, "resolved": None}
    return value


def _payload(conn: sqlite3.Connection, dataset_ids: list[str]) -> dict:
    """按闭包数据集装载全部字段与闭包内部全部边。"""
    if not dataset_ids:
        return {"datasets": [], "edges": []}
    marks = ",".join("?" for _ in dataset_ids)

    dataset_rows = conn.execute(
        f"SELECT id, name FROM dataset WHERE id IN ({marks}) ORDER BY id",
        dataset_ids).fetchall()
    field_rows = conn.execute(
        f"SELECT f.dataset_id, f.name, f.field_type, f.description,"
        f" f.src_locator, s.id AS source_file_id, s.original_name"
        f" FROM field f JOIN source_file s ON s.id = f.source_file_id"
        f" WHERE f.dataset_id IN ({marks}) ORDER BY f.dataset_id, f.name",
        dataset_ids).fetchall()

    fields_by_dataset: dict[str, list[dict]] = {ds_id: [] for ds_id in dataset_ids}
    for row in field_rows:
        fields_by_dataset[row["dataset_id"]].append({
            "name": row["name"],
            "field_type": row["field_type"],
            "description": row["description"],
            "src_locator": _parse_locator(row["src_locator"]),
            "source_file": {"id": row["source_file_id"],
                            "original_name": row["original_name"]},
        })

    datasets = [{"id": row["id"], "name": row["name"],
                 "fields": fields_by_dataset.get(row["id"], [])}
                for row in dataset_rows]

    edge_rows = conn.execute(
        f"SELECT id, from_dataset, from_field, to_dataset, to_field, transform,"
        f" confidence, source, note FROM edge"
        f" WHERE from_dataset IN ({marks}) AND to_dataset IN ({marks})"
        f" ORDER BY from_dataset, COALESCE(from_field, ''),"
        f" to_dataset, COALESCE(to_field, '')",
        [*dataset_ids, *dataset_ids]).fetchall()
    edges = [{
        "id": row["id"],
        "from_dataset": row["from_dataset"],
        "from_field": row["from_field"],
        "to_dataset": row["to_dataset"],
        "to_field": row["to_field"],
        "transform": row["transform"],
        "confidence": row["confidence"],
        "source": row["source"],
        "note": row["note"],
    } for row in edge_rows]
    return {"datasets": datasets, "edges": edges}


def lineage_subgraph(conn: sqlite3.Connection, dataset_id: str,
                     field_name: str | None = None, hops: int = 3,
                     direction: str = "both") -> dict:
    """返回以数据集或字段为种子的 N 跳血缘子图（GraphPayload）。"""
    if direction not in DIRECTIONS:
        raise ValueError(f"direction 必须是 {'/'.join(DIRECTIONS)}，收到「{direction}」")
    if not isinstance(hops, int) or isinstance(hops, bool) or not 1 <= hops <= MAX_HOPS:
        raise ValueError(f"hops 必须是 1~{MAX_HOPS} 的整数，收到「{hops}」")

    dataset = conn.execute("SELECT id, name FROM dataset WHERE id=?",
                           (dataset_id,)).fetchone()
    if dataset is None:
        raise LineageNotFound(f"数据集「{dataset_id}」不存在")

    if field_name is None:
        closure = _dataset_closure(conn, dataset_id, hops, direction)
    else:
        field = conn.execute(
            "SELECT 1 FROM field WHERE dataset_id=? AND name=?",
            (dataset_id, field_name)).fetchone()
        if field is None:
            raise LineageNotFound(f"字段「{dataset_id}.{field_name}」不存在")
        closure = _field_closure(conn, dataset_id, field_name, hops, direction)

    return _payload(conn, closure)
