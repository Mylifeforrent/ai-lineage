# ai-lineage

轻量级 AI 数据血缘工具（工作名 LineageLite）的调研与设计文档仓库。

基于对两个开源血缘方案（OpenMetadata、DataHub）的源码调研，设计一个面向小团队的轻量级方案：**字段级血缘 + 源文件精确定位回源核查 + 版本化 + AI 辅助**。

## 文档导航

所有设计文档与原型统一组织在 [`docs/`](./docs/README.md) 下（阅读顺序与文档-代码对应关系见 [docs/README.md](./docs/README.md)）：

| 文档 | 内容 |
|---|---|
| [设计方案](./docs/01_design/轻量级AI血缘工具-设计方案.md) | 总体技术方案：两大开源方案调研结论、导入格式规范、存储与版本管理、可视化、AI 对话、里程碑、已确认决策记录 |
| [业务模型](./docs/01_design/轻量级AI血缘工具-业务模型.md) | 业务层模型：定位与价值主张、干系人与角色、核心领域概念、业务流程、业务规则与不变量 |
| [数据模型](./docs/01_design/轻量级AI血缘工具-数据模型.md) | 数据层模型：ER 图、9 张表定义、派生视图、JSON 结构、标识命名规则、索引与版本重建规则 |
| [低保真原型](./docs/02_prototype/lineagelite-lofi-prototype.html) | 6 个界面的线框原型（浏览器直接打开，已确认的 UI 基线） |

## 目录结构

```
ai-lineage/
├── docs/          # 设计文档（01_design）与低保真原型（02_prototype），索引见 docs/README.md
├── backend/       # 后端项目：M1 数据底座（FastAPI + SQLite + uv）
│   ├── src/lineagelite/
│   ├── tests/
│   ├── pyproject.toml
│   └── uv.lock
├── .env.example   # 环境配置模板（复制为仓库根 .env 使用，.env 不入库）
└── README.md
```

M2 的前端（React + Vite + reactflow）将放入 `frontend/`，与 `backend/` 平级。

## 后端（M1 已实现）

数据底座：JWT 认证 + RBAC（admin/editor/viewer）、源文件托管（sha256 去重）、CSV/XLSX/JSON 三格式导入（含 XLSX 合并单元格/多级表头定位解析与实文件核查）、版本批次 + change_log + 按批次回滚。

```bash
cp .env.example .env           # 仓库根配置（SECRET_KEY / ADMIN_PASSWORD 等）
cd backend
uv sync                        # 安装依赖
uv run uvicorn lineagelite.main:app --reload   # 启动，首次自动建库并创建初始管理员
uv run pytest                  # 运行验收测试
```

API 一览（需 Bearer Token）：`POST /auth/login`、`POST/GET /users`（admin）、`POST/GET /files`、`GET /files/{id}/download`、`POST /import`（editor+，multipart：format + source_file_ids + 清单文件）、`GET /import/batches`、`POST /import/batches/{id}/rollback`（admin）、`GET /datasets`、`GET /lineage/snapshot`。

## 引用仓库说明

`OpenMetadata/` 与 `datahub/` 为调研所用的两个开源项目源码副本，仅本地参考，**不纳入本仓库版本管理**（见 `.gitignore`）。

## 技术栈

- 后端：Python + FastAPI + uv，SQLite 起步（预留 Postgres 升级路径）
- 前端：React + TypeScript + Vite + Tailwind + shadcn/ui + @xyflow/react
- AI：OpenAI 兼容 Chat API + function calling（密钥经 `.env` 配置，不入库）
