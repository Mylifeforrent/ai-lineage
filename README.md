# ai-lineage

轻量级 AI 数据血缘工具（工作名 LineageLite）的调研与设计文档仓库。

基于对两个开源血缘方案（OpenMetadata、DataHub）的源码调研，设计一个面向小团队的轻量级方案：**字段级血缘 + 源文件精确定位回源核查 + 版本化 + AI 辅助**。

## 文档导航

所有设计文档与原型统一组织在 [`docs/`](./docs/README.md) 下（阅读顺序与文档-代码对应关系见 [docs/README.md](./docs/README.md)）：

| 文档 | 内容 |
|---|---|
| [设计方案](./docs/01_design/轻量级AI血缘工具-设计方案.md) | 总体技术方案：两大开源方案调研结论、导入格式规范、存储与版本管理、可视化、AI 对话、里程碑、已确认决策记录 |
| [业务模型](./docs/01_design/轻量级AI血缘工具-业务模型.md) | 业务层模型：定位与价值主张、干系人与角色、核心领域概念、业务流程、业务规则与不变量 |
| [数据模型](./docs/01_design/轻量级AI血缘工具-数据模型.md) | 数据层模型：ER 图、10 张表定义（含 M3 rollback_record）、派生视图、JSON 结构、标识命名规则、索引与版本重建规则 |
| [低保真原型](./docs/02_prototype/lineagelite-lofi-prototype.html) | 6 个界面的线框原型（浏览器直接打开，已确认的 UI 基线） |

## 目录结构

```
ai-lineage/
├── backend/       # 正式后端项目（自 prototype/backend 移植）：M1 数据底座 + M2 图查询/回源预览 + M3 编辑/标注/版本标签 + M4 AI（FastAPI + SQLite + uv）
│   ├── src/lineagelite/
│   ├── tests/
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/      # 正式前端项目（自 prototype/frontend 移植）：hi-fi 视觉 + 导入向导（React + TS + Vite + Tailwind + @xyflow/react）
│   ├── src/
│   │   ├── components/
│   │   └── lib/
│   ├── package.json
│   └── vite.config.ts
├── docs/          # 设计文档（01_design）、低保真原型（02_prototype）、开发文档（03_dev）、高保真规范（04_hifi），索引见 docs/README.md
├── prototype/     # 原型工作区（backend/frontend 的历史基线），仅作参照保留，后续功能在 backend/ 与 frontend/ 演进
├── .env.example   # 环境配置模板（复制为仓库根 .env 使用，.env 不入库）
└── README.md
```

正式前端 `frontend/` 的开发服务器通过 Vite proxy 将 `/auth`、`/datasets`、`/lineage`、`/fields`、`/edges`、`/annotations`、`/changes`、`/version-tags`、`/users`、`/files`、`/import`、`/ai` 转发到 `http://127.0.0.1:8000`。

## 后端（M1-M4 已实现）

数据底座：JWT 认证 + RBAC（admin/editor/viewer）、源文件托管（sha256 去重）、CSV/XLSX/JSON 三格式导入（含 XLSX 合并单元格/多级表头定位解析与实文件核查）、版本批次 + change_log + 按批次回滚。

M3 编辑与版本：标注（追加式）、字段描述/类型/定位器编辑（定位器重新实文件核查）、血缘边增删改（人工边 source='manual'）、变更历史、业务标签创建/列表/diff/回滚（回滚幂等，审计写 rollback_record）。

M4 AI：只读工具集（`search_fields` / `get_field_details` / `trace_lineage` / `get_field_history`）+ OpenAI 兼容 function calling 对话；未配置 LLM 时 `/ai/status` 返回 `configured=false`，`/ai/chat` 返回 503。启发式血缘建议按同名字段（0.7）/包含关系（0.6）生成候选边，以 `source='ai'` 落库，必须人工确认后才转为 `manual`；拒绝即删除候选边。

```bash
cp .env.example .env           # 仓库根配置（SECRET_KEY / ADMIN_PASSWORD 等）
cd backend
uv sync                        # 安装依赖
uv run uvicorn lineagelite.main:app --reload   # 启动，首次自动建库并创建初始管理员
uv run pytest                  # 运行验收测试
```

API 一览（需 Bearer Token）：`POST /auth/login`、`POST/GET /users`（admin）、`POST/GET /files`、`GET /files/{id}/download`、`POST /import`（editor+，multipart：format + source_file_ids + 清单文件）、`GET /import/batches`、`POST /import/batches/{id}/rollback`（admin）、`GET /datasets`、`GET /lineage/subgraph?dataset=&field=&hops=&direction=`、`GET /fields/{dataset_id}/{field_name}/preview`；M3：`POST/GET /annotations`、`PATCH /fields/{dataset_id}/{field_name}`、`POST /edges`、`PATCH/DELETE /edges/{id}`、`GET /changes`、`POST/GET /version-tags`、`GET /version-tags/diff?from=&to=`、`POST /version-tags/{name}/rollback`（admin）；M4：`GET /ai/status`、`POST /ai/chat`（viewer+）、`POST /ai/suggest`、`POST /ai/suggest/confirm`、`POST /ai/suggest/reject`（editor+）。

需要演示数据时，可在后端目录执行 `uv run python -m lineagelite.seed_demo`，生成 5 个数据集、4 跳血缘链及 csv/xlsx/json 三类回源样例。

## 前端（M4）

字段级血缘画布：数据集筛选、dagre 左右分层布局、字段级/表级连线、节点字段折叠与「框选折叠为组」、跳数切换、字段详情与 CSV/XLSX/JSON 回源预览。

M3 编辑与版本：按登录角色隐藏写入口（viewer 只读）；悬停/选中边可编辑转换与备注、删除；拖拽字段/表级 handle 新增血缘；字段描述/类型/定位器编辑（409 原因回显）；字段与边的追加式标注；字段/边变更历史抽屉；版本抽屉（导入批次、标签创建、标签间差异、admin 回滚）；admin 用户管理。登录使用 JWT，Bearer Token 存于 `localStorage`，任意已认证请求返回 401 时会回到登录页。

M4 AI 助手：顶部栏「AI 助手」抽屉（对话、工具调用轨迹、`trace_lineage` 结果联动出图）；字段详情内一键生成启发式候选边；画布上任意 `source='ai'` 的边在边详情中都可「确认转为人工边」，不依赖候选卡片是否仍在内存中。

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173，API 由 Vite proxy 转至 :8000
npm run build      # tsc -b && vite build
```

前端只使用 `fetch` 访问 API；画布依赖 `@xyflow/react`，分层布局依赖 `@dagrejs/dagre`。

前后端接口联调：启动后端后执行 `node scripts/api-e2e.mjs`（或 `E2E_BASE_URL=http://127.0.0.1:8001 node scripts/api-e2e.mjs`），镜像 `src/lib/api.ts` 全部请求做端到端校验（含 RBAC/错误语义），会写入 `e2e_` 前缀数据并自动回滚可回滚部分。

## 已知差距

- **用户管理原型保真**：当前 `UserManagementModal` 只支持用户列表 + 新增用户（含创建时角色选择）；原型「版本与用户」屏中的逐行角色下拉与 RBAC 权限矩阵尚未实现。角色变更需要新增管理员接口，且涉及「是否允许管理员修改自己的角色/如何保证至少保留一名 admin」等业务规则（`[TBD-BIZ]`，需产品确认后再实现）；UI 已明确标注该限制。
- **标注管理**：标注为追加式，当前无编辑/删除入口（与业务模型一致）。

## 引用仓库说明

`OpenMetadata/` 与 `datahub/` 为调研所用的两个开源项目源码副本，仅本地参考，**不纳入本仓库版本管理**（见 `.gitignore`）。

## 技术栈

- 后端：Python + FastAPI + uv，SQLite 起步（预留 Postgres 升级路径）
- 前端：React + TypeScript + Vite + Tailwind + @xyflow/react + @dagrejs/dagre（组件源码内置，无额外 UI 组件库）
- AI：OpenAI 兼容 Chat API + function calling（密钥经 `.env` 配置，不入库）
