# Clew 后端（正式目录）

Clew 的正式后端项目：字段级数据血缘核查与协作工具的 FastAPI + SQLite 单进程服务。接口契约以 `docs/03_dev/05_API接口文档.md` 为唯一权威；实现说明见 `docs/03_dev/03_后端开发文档.md`；架构总览见 `docs/03_dev/01_架构设计.md`。

## 与 prototype 的关系

- `prototype/backend/` 是 M1–M4 的原型工作区；本目录以它为基线**整体移植**（`src/`、`tests/`、`pyproject.toml`、`uv.lock` 同源复制），移植后唯一代码差异是 `.env` 定位层级：包位于 `backend/src/clew/`，向上 3 层即仓库根（prototype 中为 4 层），见 `src/clew/config.py`。
- 两目录当前并存；prototype 仅作为参照保留，后续功能在 `backend/` 演进。

## 开发命令

```bash
cp .env.example .env             # 仓库根配置（SECRET_KEY / ADMIN_PASSWORD / LLM_* 等，不入库）
cd backend
uv sync                          # 安装依赖（npm 之于前端，此处 uv；禁止 pip 手写 requirements.txt）
uv run uvicorn clew.main:app --reload   # 启动，默认 127.0.0.1:8000；首次自动建库并创建初始管理员
uv run pytest                    # 验收测试（54 个用例，隔离临时数据目录，不联网）
uv run python -m clew.seed_demo          # 演示数据（幂等）：5 数据集、4 跳血缘链、三格式回源样例
```

配置项（`SECRET_KEY` / `JWT_EXPIRE_HOURS` / `DATA_DIR` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `MAX_UPLOAD_MB` / `CORS_ORIGINS` / `LLM_*`）全部经仓库根 `.env` 注入，环境变量优先。

## 能力概览（M1–M4）

- **M1 数据底座**：JWT 认证 + RBAC（viewer/editor/admin，角色回查数据库实时生效）、源文件托管（sha256 内容寻址去重、受控下载）、CSV/XLSX/JSON 三格式清单导入（XLSX 合并单元格/多级表头定位解析 + 实文件核查）、版本批次 + change_log + 按批次回滚。
- **M2 图查询**：递归 CTE 一次取 N 跳子图（数据集/字段种子、双向/上游/下游），统一 `GraphPayload` 渲染契约；字段级回源预览（定位高亮 + 核查留痕）。
- **M3 编辑与版本**：追加式标注、字段描述/类型/定位器编辑（定位器重新实文件核查，失败 409 保留原值）、血缘边增删改（`source='manual'`）、变更历史、版本标签创建/diff/回滚（幂等，审计写 `rollback_record`）。
- **M4 AI**：只读工具集（`search_fields` / `get_field_details` / `trace_lineage` / `get_field_history`）+ OpenAI 兼容 function calling 对话（标准库 urllib，未配置 LLM 时 503）；启发式血缘建议以 `source='ai'` 落库，必须人工确认转 `manual`，拒绝即删除。

## 目录结构

```
backend/
├── pyproject.toml / uv.lock      # 依赖声明与锁定（Python >=3.11，hatchling 构建）
├── src/clew/
│   ├── main.py / config.py / db.py / security.py / models.py
│   ├── manifest.py / locator.py / import_service.py    # 导入流水线
│   ├── lineage.py / preview.py / changes.py / versioning.py
│   ├── seed_demo.py              # 演示数据（走正式上传+导入路径）
│   ├── ai/                       # llm / tools / suggest / chat
│   └── routes/                   # 12 个路由模块（auth/files/imports/datasets/lineage/preview/
│                                 #   annotations/fields/edges/changes/version_tags/ai）
└── tests/                        # 9 个测试文件（pytest，隔离 DATA_DIR）
```

运行时数据（`data/lineage.db` 与 `data/files/`）在 `DATA_DIR`（默认 `./data`）下生成，已 gitignore；备份 = 备份整个 `DATA_DIR`。

## 已知差距（均需产品决策，未实现）

- 用户角色变更接口（`PATCH /users/{username}`）缺失，用户管理仅列表 + 新增——涉及「管理员能否改自己角色」「至少保留一名 admin」等规则 `[TBD-BIZ]`。
- admin「删除数据集 / 重置导入」（设计方案 §4.4）无对应端点 `[TBD-BIZ]`——级联删除语义、留痕方式与回滚的相互作用无设计定论。
- 重导入对已存在边会把 `source` 覆写回 `imported`，归并规则待定 `[TBD-BIZ]`（`docs/03_dev/03_后端开发文档.md` §十二-7）。
