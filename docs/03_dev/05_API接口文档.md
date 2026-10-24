# LineageLite 前后端交互 API 文档

> 本文档是 LineageLite（轻量级 AI 血缘工具）前后端交互的**唯一权威 API 契约**：全部端点、参数、请求/响应结构与错误语义逐条依据 `prototype/backend/src/lineagelite/` 路由代码核对编写（M1–M4 已实现范围），未实现的设想端点单独标注。系统架构见 ./01_架构设计.md，前端视角的调用方式见 ./02_前端开发文档.md，后端模块划分见 ./03_后端开发文档.md，前后端数据契约的责任边界见 ./04_前后端职责边界.md。

## 依据与来源

| 简称 | 位置 | 本文使用范围 |
|---|---|---|
| 路由代码 | `prototype/backend/src/lineagelite/routes/`（`auth.py`、`files.py`、`imports.py`、`datasets.py`、`lineage.py`、`preview.py`、`fields.py`、`edges.py`、`annotations.py`、`changes.py`、`version_tags.py`、`ai.py`） | 全部端点的方法、路径、角色依赖、错误抛出 |
| 入口/安全 | `prototype/backend/src/lineagelite/main.py`、`security.py` | 路由挂载、CORS、Bearer 认证、角色守卫 |
| 模型 | `prototype/backend/src/lineagelite/models.py` | 请求/响应 pydantic 模型的字段、类型、约束（逐字核对） |
| 支撑模块 | `prototype/backend/src/lineagelite/`（`db.py`、`lineage.py`、`preview.py`、`versioning.py`、`changes.py`、`import_service.py`、`manifest.py`、`locator.py`、`config.py`、`ai/chat.py`、`ai/llm.py`、`ai/suggest.py`、`ai/tools.py`） | 响应结构、错误原因、清单格式、定位器物化规则 |
| 设计方案 | `docs/01_design/轻量级AI血缘工具-设计方案.md` | §3.5 导入校验、§3.6 源文件托管上传、§6.2 AI 工具集 |
| 数据模型 | `docs/01_design/轻量级AI血缘工具-数据模型.md` | §四 JSON 结构（定位器信封 / before/after 快照 / 导入报告）、§5.2 entity_key 命名、§九 API 契约增量（M2/M3/M4） |
| README | 仓库根 `README.md` | API 一览交叉核对（差异见 §十七，以代码为准） |

约定：文档与代码不一致时**以代码为准**；`[ASSUMPTION]` 表示无法从代码确定且必须写出的推断；`[TBD-BE]` 表示设计文档有、后端未实现的端点。示例数据为自拟，仅保证类型与业务含义正确。

---

## 一、通用约定

### 1.1 Base URL 与代理

- 开发环境后端：`http://127.0.0.1:8000`（`uv run uvicorn lineagelite.main:app --reload`，见根 `README.md`）。
- 开发环境前端（Vite，`http://localhost:5173`）经 `prototype/frontend/vite.config.ts` 的 proxy 将 `/auth`、`/users`、`/files`、`/import`、`/datasets`、`/lineage`、`/fields`、`/edges`、`/annotations`、`/changes`、`/version-tags`、`/ai` 前缀转发到后端，即**同源访问**，浏览器侧无跨域问题。
- 若前端绕过 proxy 直连后端（如独立部署），跨域来源由仓库根 `.env` 的 `CORS_ORIGINS` 配置（默认 `http://localhost:5173,http://127.0.0.1:5173`），`allow_credentials=False`（认证走 Bearer 头而非 Cookie，`main.py`）。

### 1.2 认证与角色

- 除 `POST /auth/login` 外，**全部端点需要认证**：请求头 `Authorization: Bearer <JWT>`（`security.py`）。
- JWT 由 `POST /auth/login` 签发：HS256，payload 为 `{sub: username, role, iat, exp}`，有效期 `JWT_EXPIRE_HOURS`（默认 24 小时，`.env`）。
- 角色三级：`viewer < editor < admin`（`ROLE_ORDER`）。路由用 `require_role("viewer"|"editor"|"admin")` 声明**最低角色**；角色以数据库当前值为准（JWT 里的 role 仅登录时快照，管理员改库后旧 token 立即按新角色生效）。
- 缺失/非法 Bearer 凭据 → 401「缺少 Bearer 凭据」/「凭据无效或已过期」；token 对应用户已被删除 → 401「用户不存在或已删除」；数据库角色低于要求 → 403「需要 {minimum} 及以上角色」。
- `GET /auth/me` 特殊：仅解码 JWT（`current_user`），不查库、不校验角色。
- 前端约定（./02_前端开发文档.md）：token 存 `localStorage`，任意请求收到 401 即回登录页。

### 1.3 Content-Type

| 场景 | Content-Type |
|---|---|
| 普通 JSON 请求体（POST/PATCH） | `application/json` |
| `POST /files`、`POST /import` | `multipart/form-data` |
| 其余 GET / DELETE / 204 响应 | 无请求体 |

### 1.4 错误响应结构

- 业务错误（代码中 `HTTPException`）统一为：

```json
{ "detail": "中文错误说明" }
```

- 请求体/查询参数未通过 pydantic 校验时，FastAPI 自动返回 **422**，`detail` 为校验明细数组（`[{loc, msg, type}, ...]`），非字符串。前端对 422 应按数组处理。
- 成功响应均为 JSON（文件下载与 204 除外）。

### 1.5 状态码语义表

| 状态码 | 语义 | 代码中的典型触发场景 |
|---|---|---|
| 200 | 成功（默认） | 所有 GET、PATCH、POST /ai/* 等 |
| 201 | 创建成功 | `POST /users`、`POST /files`、`POST /import`、`POST /edges`、`POST /annotations`、`POST /version-tags` |
| 204 | 成功无响应体 | `DELETE /edges/{edge_id}`、`POST /ai/suggest/reject` |
| 400 | 请求语义错误 | 空请求体、字段级/表级二选一违例、`target_id`/`source_file_ids` 格式非法、清单缺文件或不可解析、标签 diff 方向颠倒等 |
| 401 | 未认证 | 缺少/无效/过期 Bearer；用户已删除；登录用户名或密码错误 |
| 403 | 已认证但角色不足 | `require_role` 守卫判定数据库角色低于最低角色 |
| 404 | 目标不存在 | 数据集/字段/边/源文件/批次/标签/AI 候选边不存在，登录用户名错误 |
| 409 | 状态冲突（业务不变量被违反） | 见下方 409 场景归纳 |
| 413 | 文件过大 | 上传单文件超过 `MAX_UPLOAD_MB`（默认 50MB，`routes/files.py`） |
| 422 | 参数校验失败 | pydantic/FastAPI 自动校验（如 `hops` 超出 1~5、`confidence` 超出 0~1、`role` 枚举非法）；`GET /lineage/subgraph` 内部校验也映射 422 |
| 502 | LLM 上游错误 | `POST /ai/chat`：LLM 服务不可达、返回非 200 或响应结构不合法（`ai/llm.py`） |
| 503 | 服务未配置 | `POST /ai/chat`：`.env` 未配置 `LLM_BASE_URL` / `LLM_MODEL` |

**409 场景归纳**（全部来自代码中的 `HTTPException(409, ...)` 或其映射）：

| 端点 | 触发条件 |
|---|---|
| `POST /users` | 用户名已存在（唯一约束） |
| `GET /fields/{ds}/{f}/preview` | 定位器对当前源文件已失效：文件不在托管存储、信封类型与源文件类型不一致、CSV 表头/列号越界、XLSX sheet 不存在或行列越界、JSONPath 无命中、源文件损坏（`preview.PreviewError`） |
| `PATCH /fields/{ds}/{f}` | `src_locator` 定位器类型与源文件 `src_type` 不一致、结构校验失败、实文件核查失败、源文件不在托管存储（`routes/fields.py` 统一转 409） |
| `POST /edges` | 同一上下游自然键的边已存在（边唯一，不变量#3；含并发下唯一索引兜底） |
| `POST /import/batches/{id}/rollback` | 批次已回滚过；或反做时存在后续批次引用本批字段的边（引用完整性冲突） |
| `POST /version-tags` | 标签名已存在（重名） |
| `POST /version-tags/{name}/rollback` | 反做时遇引用完整性冲突（晚于标签的边引用将被删除的字段） |

### 1.6 时间格式

所有 `created_at` / `updated_at` / `checked_at` 等时间字段为 ISO8601 UTC 文本、秒精度，形如 `2026-10-24T08:00:00+00:00`（`changes.now()` / `datetime.now(UTC).isoformat(timespec="seconds")`）。

---

## 二、认证与用户（`routes/auth.py`）

### 2.1 POST /auth/login

登录换取 JWT。**唯一匿名端点**。

- 所需角色：匿名
- 请求体（`LoginIn`，`models.py`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| username | string | 是 | 无长度约束 | `"admin"` |
| password | string | 是 | 无长度约束 | `"admin123"` |

- 成功响应：`200`

| 字段 | 类型 | 说明 |
|---|---|---|
| access_token | string | JWT（HS256，默认 24h 有效） |
| token_type | string | 固定 `"bearer"` |
| username | string | 登录用户名 |
| role | string | `admin` / `editor` / `viewer` |

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "username": "admin",
  "role": "admin"
}
```

- 错误场景：`401` 用户名不存在或密码错误（统一「用户名或密码错误」，不区分两种情况）。

### 2.2 GET /auth/me

当前用户信息。仅解码 JWT（`current_user` 依赖），不查库、不校验角色——token 未过期即返回。

- 所需角色：登录用户（任意角色；角色以 JWT 内快照为准）
- 请求参数：无
- 成功响应：`200` → `{"username": "admin", "role": "admin"}`
- 错误场景：`401` 缺少/无效/过期 Bearer 凭据。
- 注：根 `README.md` 的 API 一览未列此端点，代码已注册（`routes/auth.py`），以代码为准。

### 2.3 POST /users

新建用户（admin 管理员管理，M3）。

- 所需角色：admin
- 请求体（`UserCreate`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| username | string | 是 | 2~64 字符 | `"editor1"` |
| password | string | 是 | ≥6 字符（明文传输，服务端 pbkdf2 哈希存储） | `"secret123"` |
| display_name | string\|null | 否 | 无 | `"张三"` |
| role | string | 是 | 正则 `^(admin\|editor\|viewer)$` | `"editor"` |

- 成功响应：`201`（`UserOut`）：

| 字段 | 类型 |
|---|---|
| username | string |
| display_name | string\|null |
| role | string |

- 错误场景：`409` 用户名已存在（`用户「{username}」已存在`）；`422` 字段约束不满足；`401`/`403` 认证或角色不足。
- 注：只有创建接口，无更新/删除用户端点（角色变更接口为已知差距，根 `README.md`「已知差距」）。

### 2.4 GET /users

用户列表，按 `id` 升序。

- 所需角色：admin
- 成功响应：`200` → `UserOut` 数组（字段同上）。
- 错误场景：`401` / `403`。

---

## 三、源文件（`routes/files.py`，前缀 `/files`）

上传支持的扩展名（大小写不敏感，按文件名后缀判断）：`csv`、`xlsx`、`json`（`ALLOWED_TYPES`）。同 sha256 内容自动去重复用已有记录（设计方案 §3.6）。

### 3.1 POST /files

批量上传第一手源文件（三步导入的第①步）。

- 所需角色：editor
- 请求：`multipart/form-data`，表单字段名 `files`，重复出现，每项一个文件：

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| files | file[] | 是（至少 1 个） | 源文件；文件名后缀必须是 csv/xlsx/json |

- 成功响应：`201` → 数组，每个元素为该文件的登记记录（`source_file` 全列 + 去重标记）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | integer | 源文件 ID（导入清单 `src_file` 可引用它） |
| original_name | string | 原始文件名 |
| storage_path | string | 相对 `DATA_DIR` 的存储路径（`files/<sha前2位>/<sha256>.<ext>`；服务端内部字段，随行返回） |
| sha256 | string | 内容哈希（64 位十六进制），去重键 |
| size_bytes | integer | 字节数 |
| src_type | string | `csv` / `xlsx` / `json` |
| uploaded_by | string | 上传者用户名 |
| created_at | string | ISO8601 UTC |
| deduped | boolean | `true`＝内容已存在、复用旧记录；`false`＝新登记 |

```json
[
  {
    "id": 3,
    "original_name": "订单明细.xlsx",
    "storage_path": "files/9f/9f86d071….xlsx",
    "sha256": "9f86d071…",
    "size_bytes": 20480,
    "src_type": "xlsx",
    "uploaded_by": "editor1",
    "created_at": "2026-10-24T08:00:00+00:00",
    "deduped": false
  }
]
```

- 错误场景：`400` 未传任何文件（`至少上传一个文件`）；某文件后缀不在支持列表；某文件内容为空（`文件「{name}」为空`）；`413` 单文件超过 `MAX_UPLOAD_MB`（默认 50MB）；`401`/`403`。任一文件出错则整批失败，先处理的文件可能已登记（无批级回滚，重复上传靠 sha256 去重兜底）。

### 3.2 GET /files

源文件列表，按 `id` 升序。**不含 `storage_path`**（存储路径不对外暴露，业务规则#8）。

- 所需角色：viewer
- 成功响应：`200` → 数组，元素字段：`id`、`original_name`、`sha256`、`size_bytes`、`src_type`、`uploaded_by`、`created_at`。
- 错误场景：`401`/`403`。

### 3.3 GET /files/{file_id}/download

受控下载源文件（返回文件本体，`Content-Disposition` 附带原始文件名）。

- 所需角色：viewer
- 路径参数：

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| file_id | integer | 是 | 源文件 ID |

- 成功响应：`200`，文件二进制流（非 JSON）。
- 错误场景：`404` 源文件不存在（`源文件 {file_id} 不存在`）。

---

## 四、导入（`routes/imports.py`）

三步导入的第②③步：上传清单 → 校验 + 入库（绑定同一 `import_batch`）。导入规则（行级拒绝进报告、重复合并、实文件核查）见设计方案 §3.5 与数据模型 §四。

### 4.1 POST /import

上传清单并执行导入。

- 所需角色：editor
- 请求：`multipart/form-data`：

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| format | string（form） | 是 | `csv` / `xlsx` / `json`（大小写不敏感） |
| source_file_ids | string（form） | 是 | 逗号分隔的源文件 ID，如 `"3,4"`；须为 `POST /files` 返回的 id |
| manifest | file | xlsx/json 必填 | xlsx：含 `datasets`、`lineage` 双 sheet 的工作簿；json：`{"datasets": [], "lineage": []}` |
| manifest_datasets | file | csv 必填 | `datasets.csv`（数据集与字段清单） |
| manifest_lineage | file | csv 必填 | `lineage.csv`（血缘清单） |

清单列（`manifest.py` 的 `DATASET_COLUMNS` / `EDGE_COLUMNS`，CSV/XLSX 表头、JSON 对象键同名）：

- datasets：`dataset_id`、`dataset_name`、`field_name`、`field_type`、`src_file`、`src_type`、`src_locator`、`description`
- lineage：`from_dataset`、`from_field`、`to_dataset`、`to_field`、`transform`、`confidence`、`note`

其中 `src_file` 可填源文件库 ID（数字）或本批绑定文件集内的原始文件名（须唯一）；`src_locator` 为定位器 input（CSV/XLSX 中是 JSON 字符串单元格，JSON 清单中是对象，结构见附录 A1）；行级错误（如 `src_locator` 非 JSON、`confidence` 非数字）不整批失败，该行进报告标记 `rejected`。

- 成功响应：`201`

| 字段 | 类型 | 说明 |
|---|---|---|
| batch_id | integer | 导入批次 ID |
| version_no | integer | 版本号（递增） |
| report | object | 导入报告（结构见附录 A5） |

```json
{
  "batch_id": 7,
  "version_no": 3,
  "report": {
    "summary": { "total": 3, "ok": 2, "merged": 0, "rejected": 1 },
    "items": [
      { "status": "ok", "kind": "field", "ref": "ods_raw.order_id",
        "reason": null, "source_row": 2 },
      { "status": "rejected", "kind": "field", "ref": "ods_raw.bad_field",
        "reason": "实文件核查失败：csv 表头「no_such_header」未在源文件首行找到（共 5 列）",
        "source_row": 3 }
    ]
  }
}
```

- 错误场景：`400` `source_file_ids` 不是逗号分隔数字 / 为空；对应格式缺少必传清单文件；`format` 非法；清单文件级解析失败（XLSX 缺 `datasets`/`lineage` sheet、JSON 根解析失败、CSV/XLSX 行结构文件级错误）；清单完全为空；`404` `source_file_ids` 中某源文件不存在；`422` 缺 `format` / `source_file_ids` form 字段。
- 注：**行级校验失败不产生 HTTP 错误**，进报告的 `rejected` 项（不变量「无定位不入库」由行级实文件核查保证）。

### 4.2 GET /import/batches

导入批次列表，按 `version_no` 倒序（版本抽屉用）。

- 所需角色：viewer
- 成功响应：`200` → 数组：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | integer | 批次 ID |
| version_no | integer | 版本号 |
| file_names | string[] | 本批绑定的源文件名（已从 JSON 解析为数组） |
| format | string | `csv` / `xlsx` / `json` |
| created_by | string | 导入者 |
| created_at | string | ISO8601 UTC |
| rolled_back_at | string\|null | 已回滚时间；未回滚为 `null` |

- 错误场景：`401`/`403`。
- 注：`rolled_back_by` 不在本列表响应中（`SELECT` 未取该列）；根 `README.md` API 一览未列此端点，代码已注册，以代码为准。

### 4.3 GET /import/batches/{batch_id}

批次详情（含完整导入报告）。

- 所需角色：viewer
- 路径参数：`batch_id`（integer，必填）
- 成功响应：`200` → 4.2 的全部字段，另加：

| 字段 | 类型 | 说明 |
|---|---|---|
| rolled_back_by | string\|null | 回滚执行者 |
| report | object\|null | 导入报告（附录 A5；无报告为 `null`） |

- 错误场景：`404` `导入批次 {batch_id} 不存在`。
- 注：根 `README.md` API 一览未列此端点，代码已注册，以代码为准。

### 4.4 POST /import/batches/{batch_id}/rollback

按批次回滚：反做该批次全部 change_log（added→删除、updated→恢复 before、deleted→重插 before），批次写 `rolled_back_at/by`。

- 所需角色：admin
- 路径参数：`batch_id`（integer，必填）
- 成功响应：`200` → `{"batch_id": 7, "reverted": 25}`（`reverted` 为反做的日志条数）
- 错误场景：`404` 批次不存在；`409` 批次已回滚过；`409` 存在后续批次引用本批字段的边，需先回滚更晚批次。

---

## 五、数据集与字段浏览（`routes/datasets.py`）

### 5.1 GET /datasets

数据集列表（侧栏「数据集 / 字段」两类搜索目标，设计方案 §5.1）。

- 所需角色：viewer
- 成功响应：`200` → 数组，按 `id` 升序：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 数据集 ID（用户自定义字符串主键） |
| name | string\|null | 数据集名称 |
| field_count | integer | 字段数（LEFT JOIN 计数） |
| field_names | string[] | 字段名列表（M2 契约增量，数据模型 §9.1） |

```json
[
  { "id": "ods_raw", "name": "订单原始层", "field_count": 3,
    "field_names": ["order_id", "amount", "buyer_name"] }
]
```

- 错误场景：`401`/`403`。

### 5.2 GET /datasets/{dataset_id}

数据集详情与字段清单（含定位器信封与来源文件名）。

- 所需角色：viewer
- 路径参数：`dataset_id`（string，必填）
- 成功响应：`200`

```json
{
  "id": "ods_raw",
  "name": "订单原始层",
  "description": null,
  "fields": [
    {
      "name": "order_id",
      "field_type": "string",
      "description": "订单号",
      "src_locator": { "type": "csv", "input": { "header": "order_no" },
                       "resolved": { "column_index": 3, "header": "order_no" } },
      "source_file_id": 3,
      "source_file_name": "订单明细.csv"
    }
  ]
}
```

- `fields[].src_locator` 已从 TEXT 解析为定位器信封对象（附录 A1），按字段名升序。
- 错误场景：`404` `数据集「{dataset_id}」不存在`。
- 注：根 `README.md` API 一览未列此端点，代码已注册，以代码为准。

---

## 六、血缘子图（`routes/lineage.py`；另含 `routes/imports.py` 中的遗留端点）

### 6.1 GET /lineage/subgraph

取数据集/字段的 N 跳血缘子图（`GraphPayload`，递归 CTE 实现，设计方案 §4.3）。

- 所需角色：viewer
- 查询参数：

| 参数 | 类型 | 必填 | 约束 | 含义 |
|---|---|---|---|---|
| dataset | string | 是 | — | 种子数据集 ID |
| field | string | 否 | — | 种子字段名；提供时按字段级追溯 |
| hops | integer | 否 | 1~5，默认 3 | 最大跳数 |
| direction | string | 否 | `both` / `up` / `down`，默认 `both` | 追溯方向 |

- 种子语义（`lineage.py`）：数据集种子沿全部相连边（字段级 + 表级）扩展；字段种子沿字段级边精确扩展，**表级边视为两侧数据集字段全连通**。
- 成功响应：`200` → `GraphPayload`（附录 A6；`edges[]` 每项含 `id`——M3 编辑/删除按它定位，数据模型 §9.1）。
- 错误场景：`404` 种子数据集/字段不存在；`422` `hops` 超界或 `direction` 非法。

### 6.2 GET /lineage/snapshot

当前全量血缘状态快照。**M1 验证遗留端点**（代码注释明示「M1 验证用；M2 将替换为递归 CTE 子图查询」），定义在 `routes/imports.py`，前端新功能不应依赖。

- 所需角色：viewer
- 成功响应：`200`

```json
{
  "datasets": [{ "id": "ods_raw", "name": "订单原始层" }],
  "fields": [{ "dataset_id": "ods_raw", "name": "order_id",
               "field_type": "string", "source_file_id": 3,
               "description": "订单号" }],
  "edges": [{ "from_dataset": "ods_raw", "from_field": "order_id",
              "to_dataset": "dwd_order", "to_field": "order_no",
              "transform": "cast/trim", "confidence": 1.0,
              "source": "imported", "note": null }]
}
```

- 错误场景：`401`/`403`。
- 注：根 `README.md` API 一览未列此端点，代码已注册，以代码为准。

---

## 七、回源预览（`routes/preview.py`）

### 7.1 GET /fields/{dataset_id}/{field_name}/preview

按字段定位器信封打开托管源文件，返回定位卡高亮所需的结构化预览（设计方案 §3.6 回源核查闭环）。

- 所需角色：viewer
- 路径参数：

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| dataset_id | string | 是 | 数据集 ID |
| field_name | string | 是 | 字段名 |

- 成功响应：`200`

| 字段 | 类型 | 说明 |
|---|---|---|
| file | object | `{id, original_name, sha256, size_bytes, src_type, uploaded_by}`（M2 契约增量，数据模型 §9.1；sha256 供前端展示去重依据） |
| verification | object\|null | `{status: "passed", version_no, checked_by, checked_at}`——最近一次通过实文件核查的导入批次信息；无核查记录（如字段未经导入路径入库）为 `null` |
| locator | object | 定位器信封（附录 A1） |
| preview | object | 按 `src_type` 三选一，见下 |

`preview` 三种形态（`preview.py`）：

| src_type | 字段 |
|---|---|
| csv | `header: string[]`（首行表头）、`column_index: integer`（1 起）、`rows: string[][]`（最多 50 行，短行右侧补空串） |
| xlsx | `sheet: string`、`header_rows: string[][]`（表头行，0~n 行）、`merged_ranges: string[]`（与可见区域相交的合并区域如 `"B1:F1"`）、`column_index: integer`、`row_start: integer`、`row_end: integer`、`rows: [][]`（前 50 数据行，单元格值已转 JSON 可序列化） |
| json | `json_path: string`、`hits: integer`（命中总数）、`samples: any[]`（前 10 个命中值） |

```json
{
  "file": { "id": 3, "original_name": "订单明细.csv", "sha256": "9f86d071…",
            "size_bytes": 2048, "src_type": "csv", "uploaded_by": "editor1" },
  "verification": { "status": "passed", "version_no": 3,
                    "checked_by": "editor1", "checked_at": "2026-10-24T08:00:00+00:00" },
  "locator": { "type": "csv", "input": { "header": "order_no" },
               "resolved": { "column_index": 3, "header": "order_no" } },
  "preview": { "header": ["dt", "buyer", "order_no"],
               "column_index": 3,
               "rows": [["2026-01-01", "alice", "A001"], ["2026-01-02", "bob", "A002"]] }
}
```

- 错误场景：`404` 数据集或字段不存在；`409` 定位失效（详见 §1.5 的 409 归纳：文件缺失、类型不一致、sheet/列/行越界、JSONPath 无命中、源文件损坏等，`detail` 均为「…定位已失效」文案，前端直接回显）。

---

## 八、字段编辑（`routes/fields.py`，M3）

### 8.1 PATCH /fields/{dataset_id}/{field_name}

人工修正字段描述 / 类型 / 源定位器。`src_locator` 是唯一要求实文件核查的字段：接受定位器 input 或完整信封，`resolved` 一律丢弃重算；任一环节失败 409 且字段保持原值（事务回滚）。成功编辑写 change_log（`batch_id=NULL`，`actor=当前用户`），可被标签回滚反做。

- 所需角色：editor
- 路径参数：`dataset_id`（string）、`field_name`（string），均必填
- 请求体（`FieldPatch`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| description | string\|null | 否 | 至少提供一个可编辑字段 | `"订单号"` |
| field_type | string\|null | 否 | 同上 | `"string"` |
| src_locator | object\|null | 否 | 提供时不能为 `null`（字段必须始终可回源）；值为定位器 input（如 `{"column": 3}`）或完整信封 `{"type","input","resolved"}`（`resolved` 被忽略重算） | `{"header": "order_no"}` |

- 成功响应：`200` → 更新后的字段对象：

```json
{
  "dataset_id": "ods_raw",
  "name": "order_id",
  "field_type": "string",
  "source_file_id": 3,
  "src_locator": { "type": "csv", "input": { "header": "order_no" },
                   "resolved": { "column_index": 3, "header": "order_no" } },
  "description": "订单号",
  "updated_at": "2026-10-24T09:00:00+00:00"
}
```

- 行为细节：提交值与现值完全相同时不写 change_log、直接返回当前值（该无变化分支会额外带 `storage_path` / `original_name` / `src_type` 三个源文件列，属实现分支差异，前端应忽略多余字段）。
- 错误场景：`400` 请求体未提供任何可编辑字段；显式传 `src_locator: null`；`404` 字段不存在；`409` 定位器类型与源文件类型不一致、结构校验失败、实文件核查失败、源文件不在托管存储（`detail` 为中文原因，前端回显）；`422` 字段类型不符。

---

## 九、血缘边（`routes/edges.py`，M3）

三类写操作均写 change_log（`batch_id=NULL`，op=`added`/`updated`/`deleted`），供历史查看与标签回滚。边的自然键为 `(from_dataset, from_field, to_dataset, to_field)`，`from_field`/`to_field` 为 `null` 表示表级边；**字段级/表级必须二选一**（一空一非空 → 400）。`source` 不可通过本组接口修改。

边对象（Edge，附录 A2）字段：`id, from_dataset, from_field, to_dataset, to_field, transform, confidence, source, note, created_by, updated_by, created_at, updated_at`。

### 9.1 POST /edges

人工建边，`source` 固定为 `manual`。

- 所需角色：editor
- 请求体（`EdgeCreate`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| from_dataset | string | 是 | ≥1 字符，trim 后不能为空 | `"ods_raw"` |
| from_field | string\|null | 否 | 与 `to_field` 同空或同非空 | `"order_id"` |
| to_dataset | string | 是 | ≥1 字符，trim 后不能为空 | `"dwd_order"` |
| to_field | string\|null | 否 | 同上 | `"order_no"` |
| transform | string\|null | 否 | trim 后空串存 `null` | `"cast/trim"` |
| confidence | number | 否 | 0~1，默认 `1.0` | `0.9` |
| note | string\|null | 否 | 同 transform | `"人工补充"` |

- 成功响应：`201` → Edge 对象（`source: "manual"`）：

```json
{
  "id": 12,
  "from_dataset": "ods_raw", "from_field": "order_id",
  "to_dataset": "dwd_order", "to_field": "order_no",
  "transform": "cast/trim", "confidence": 0.9,
  "source": "manual", "note": "人工补充",
  "created_by": "editor1", "updated_by": "editor1",
  "created_at": "2026-10-24T09:00:00+00:00",
  "updated_at": "2026-10-24T09:00:00+00:00"
}
```

- 错误场景：`400` `from_dataset`/`to_dataset` trim 后为空；`from_field`/`to_field` 一空一非空；`404` 引用的数据集或字段不存在（先查数据集再查字段）；`409` 同自然键边已存在（`同一上下游自然键的血缘边已存在（边唯一，不变量#3）`，含并发下部分唯一索引兜底）；`422` `confidence` 超界等。

### 9.2 PATCH /edges/{edge_id}

修改边的 `transform` / `note` / `confidence`（endpoints 与 `source` 不可改）。

- 所需角色：editor
- 路径参数：`edge_id`（integer，必填）
- 请求体（`EdgePatch`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| transform | string\|null | 否 | 至少提供一个；trim 后空串存 `null` | `"cast"` |
| note | string\|null | 否 | 同上 | `"2026-10 核对"` |
| confidence | number\|null | 否 | 0~1；提供时不能为 `null` | `0.8` |

- 成功响应：`200` → Edge 对象（无实际变化时不写 change_log，直接返回当前值）。
- 错误场景：`400` 未提供任何可编辑字段；显式传 `confidence: null`；`404` `血缘边 {edge_id} 不存在`；`422` `confidence` 超界。

### 9.3 DELETE /edges/{edge_id}

删除一条错边；before 快照写 change_log（`deleted`），支持标签回滚恢复。

- 所需角色：editor
- 路径参数：`edge_id`（integer，必填）
- 成功响应：`204` 无响应体
- 错误场景：`404` `血缘边 {edge_id} 不存在`。

---

## 十、标注（`routes/annotations.py`，M3）

标注是**追加式**业务说明：只增不改、不写 change_log、不随版本回滚删除（业务规则 / 数据模型 §9.4）。`target_kind` + `target_id` 为多态关联（数据模型 §5.2）：

| target_kind | target_id 格式 | 示例 |
|---|---|---|
| dataset | `<dataset_id>` | `ods_raw` |
| field | `<dataset_id>.<field_name>`（数据集 ID / 字段名可含点，后端尝试每个点位置取唯一命中；多义 400） | `ods_raw.order_id` |
| edge | `<from>--><to>`；字段级 `ds.f-->ds.f`，表级 `ds.*-->ds.*`（也接受省略 `.*` 的 `ds-->ds` 简写；每侧按最右一个点切分） | `ods_raw.order_id-->dwd_order.order_no`、`ods_raw.*-->dwd_order.*` |

### 10.1 POST /annotations

追加一条标注。

- 所需角色：editor
- 请求体（`AnnotationCreate`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| target_kind | string | 是 | `dataset` / `field` / `edge` | `"field"` |
| target_id | string | 是 | 1~512 字符，格式见上表 | `"ods_raw.order_id"` |
| body | string | 是 | 1~4000 字符，trim 后不能为空 | `"口径 2026-10 起含退款单"` |

- 成功响应：`201` → 标注对象（附录 A3）：

```json
{
  "id": 5,
  "target_kind": "field",
  "target_id": "ods_raw.order_id",
  "body": "口径 2026-10 起含退款单",
  "author": "editor1",
  "created_at": "2026-10-24T09:30:00+00:00"
}
```

- 错误场景：`400` `body` trim 后为空；`target_id` 格式非法（各格式的中文报错）；field 目标存在歧义；`404` 目标不存在（数据集 / 字段 / 血缘边）；`422` 约束不满足。

### 10.2 GET /annotations

按目标筛选标注，按追加顺序（`id` 升序）返回；不带参数返回全部。

- 所需角色：viewer
- 查询参数：

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| target_kind | string | 否 | `dataset` / `field` / `edge` |
| target_id | string | 否 | 与 `target_kind` 组合精确定位 |

- 成功响应：`200` → 标注对象数组（字段同 10.1 响应）。
- 错误场景：`422` `target_kind` 非法枚举（由 `Literal` 校验）。

---

## 十一、变更历史（`routes/changes.py`，M3）

### 11.1 GET /changes

最近变更日志，`id` 倒序；`before`/`after` 已解析为 JSON 对象（快照结构见附录 A4）。

- 所需角色：viewer
- 查询参数：

| 参数 | 类型 | 必填 | 约束 | 含义 |
|---|---|---|---|---|
| entity_kind | string | 否 | `dataset` / `field` / `edge` | 按实体类型过滤 |
| entity_key | string | 否 | — | 按实体键过滤（格式：数据集 `<id>`、字段 `<ds>.<f>`、边 `<from>--><to>` 字段为空用 `*`） |
| limit | integer | 否 | 1~500，默认 50 | 返回条数上限 |

- 成功响应：`200` → 数组：

```json
[
  {
    "id": 88,
    "op": "updated",
    "before": { "dataset_id": "ods_raw", "name": "order_id", "field_type": "integer",
                "source_file_id": 3, "src_locator": "{…}", "description": null },
    "after": { "dataset_id": "ods_raw", "name": "order_id", "field_type": "string",
               "source_file_id": 3, "src_locator": "{…}", "description": "订单号" },
    "actor": "editor1",
    "created_at": "2026-10-24T09:00:00+00:00"
  }
]
```

> 说明：导入路径写入的快照中 `src_locator` 是**字符串化 JSON**（见示例占位 `{…}`）；M3 人工编辑路径写入的也是字符串（`log_change` 对 dict 做 `json.dumps`）。本接口返回时仅解析 `before`/`after` 外层，内层 `src_locator` 保持字符串，前端需要时自行 `JSON.parse`。响应不含 `entity_kind` / `entity_key` / `batch_id` 列。

- 错误场景：`422` `limit` 超界、`entity_kind` 非法枚举。

---

## 十二、版本与标签（`routes/version_tags.py`，M3）

### 12.1 POST /version-tags

创建业务标签：`change_seq` 锚定当前 change_log 最大 id（标签永久保留，不写 change_log）。

- 所需角色：editor
- 请求体（`VersionTagCreate`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| name | string | 是 | 1~64 字符，trim 后不能为空 | `"v1.0-上线基线"` |
| note | string\|null | 否 | trim 后空串存 `null` | `"首次全量导入后"` |

- 成功响应：`201`

```json
{ "name": "v1.0-上线基线", "note": "首次全量导入后", "change_seq": 120,
  "created_by": "editor1", "created_at": "2026-10-24T10:00:00+00:00" }
```

- 错误场景：`400` 标签名 trim 后为空；`409` `版本标签「{name}」已存在`；`422` 长度超限。

### 12.2 GET /version-tags

标签列表，按 `id` 升序。

- 所需角色：viewer
- 成功响应：`200` → 数组：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | integer | |
| name | string | 标签名（唯一） |
| note | string\|null | |
| batch_id | integer\|null | 信息性记录：创建时最近的导入批次 |
| change_seq | integer | 锚定的 change_log 最大 id |
| created_by | string | |
| created_at | string | |

- 错误场景：`401`/`403`。

### 12.3 GET /version-tags/diff

两个标签之间的净变更（change_log 区间按 `(entity_kind, entity_key)` 归并：区间首条 before 为起点、末条 after 为终点；区间内先增后删不计入）。

- 所需角色：viewer
- 查询参数：

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| from | string | 是 | 起始标签名（查询参数名 `from`，代码内别名） |
| to | string | 是 | 结束标签名 |

- 成功响应：`200`

```json
{
  "summary": { "added": 2, "updated": 1, "deleted": 0 },
  "items": [
    { "entity_kind": "field", "entity_key": "ods_raw.amount",
      "op": "added", "before": null,
      "after": { "dataset_id": "ods_raw", "name": "amount", "…": "…" } }
  ]
}
```

- `items[]` 字段：`entity_kind`（dataset/field/edge）、`entity_key`、`op`（`added`/`updated`/`deleted`）、`before`、`after`（快照结构见附录 A4，可能为 `null`）；按 `(entity_kind, entity_key)` 排序。
- 错误场景：`404` 起始或结束标签不存在；`400` `from` 标签晚于 `to` 标签（`起始标签「{from}」晚于结束标签「{to}」，无法计算 diff`）。

### 12.4 POST /version-tags/{name}/rollback

回滚到标签：反做 `change_seq` 之后的**全部** change_log（含人工编辑）。已被先前回滚反做过的日志跳过（所属批次已回滚，或落在 `rollback_record` 反做区间内），因此重复回滚无副作用且返回 0；每次调用追加一条 `rollback_record` 审计；被反做日志所属导入批次同步标记 `rolled_back_at/by`。

- 所需角色：admin
- 路径参数：`name`（string，必填，标签名）
- 成功响应：`200` → `{"reverted": 25}`（本次实际反做的日志条数；重复回滚跳过已反做日志，返回 `0`）
- 错误场景：`404` `版本标签「{name}」不存在`；`409` 引用完整性冲突（`回滚遇引用完整性冲突：请先删除晚于该标签、引用将被删除字段的血缘边`）。

---

## 十三、AI（`routes/ai.py`，M4）

权限分两档：`/ai/status`、`/ai/chat` 为 viewer+；`/ai/suggest`（含 confirm/reject）为 editor+——AI 建议不可直接生效（不变量#4）。

### 13.1 GET /ai/status

LLM 配置状态。`configured` 语义：仓库根 `.env` 中 `LLM_BASE_URL` 与 `LLM_MODEL` **均非空**即视为已配置（`LLM_API_KEY` 允许为空，适配无鉴权的本地 OpenAI 兼容服务；`ai/llm.py::is_configured`）。**绝不返回密钥**。

- 所需角色：viewer
- 成功响应：`200`

```json
{ "configured": true, "model": "gpt-4o-mini" }
```

未配置时：`{ "configured": false, "model": null }`。

- 错误场景：`401`/`403`。

### 13.2 POST /ai/chat

自然语言对话：模型经 OpenAI 兼容 function calling 调用**只读**工具（`search_fields` / `get_field_details` / `trace_lineage` / `get_field_history` / `mark_highlight`，`ai/tools.py`），最多 5 轮工具调用后强制收口作答。system 提示由后端固定（含 focus 上下文），前端不可传 `system` 角色。`mark_highlight` 是画布联动信号：模型声明要在前端高亮的字段（最多 8 个，校验存在性、去重），后端汇总进响应 `highlights`；详见 [06_AI画布联动高亮修复](./06_AI画布联动高亮修复.md)。

- 所需角色：viewer
- 请求体（`AiChatIn`）：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| messages | object[] | 是 | 1~50 条 | 对话历史，数组元素见下 |
| focus | object\|null | 否 | — | 当前聚焦范围，注入 system 提示 |

`messages[]` 元素（`AiChatMessage`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| role | string | 是 | 仅 `user` / `assistant` | `"user"` |
| content | string | 是 | 1~8000 字符 | `"订单表里的 order_no 是从哪来的？"` |

`focus`（`AiFocus`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| dataset | string | 是 | 1~256 字符 | `"dwd_order"` |
| field | string\|null | 否 | ≤256 字符 | `"order_no"` |

- 成功响应：`200`

```json
{
  "answer": "order_no 由 ods_raw.order_id 经 cast/trim 得到（1 跳，置信度 1.0），源头字段位于「订单明细.csv」第 3 列（表头 order_no）。",
  "tool_trace": [
    { "tool": "search_fields", "args": { "q": "order_no" }, "ok": true },
    { "tool": "trace_lineage",
      "args": { "dataset": "dwd_order", "field": "order_no", "direction": "up", "hops": 3 },
      "ok": true },
    { "tool": "mark_highlight",
      "args": { "fields": [ { "dataset": "ods_order", "field": "order_no" } ] },
      "ok": true }
  ],
  "graph": { "datasets": [ /* GraphPayload，同 GET /lineage/subgraph */ ],
             "edges": [ /* … */ ] },
  "highlights": [ { "dataset": "ods_order", "field": "order_no" } ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| answer | string | 模型最终回答（工具收口后的 content 文本） |
| tool_trace | object[] | 工具调用轨迹，每项 `{tool: string, args: object, ok: boolean}`；`ok=false` 表示工具执行出错（错误信息只回传模型，不出现在轨迹中） |
| graph | object | 可选。**最后一次**成功 `trace_lineage` 返回的 `GraphPayload`（附录 A6），供画布联动渲染；本次对话未查图时省略该字段 |
| highlights | object[] | 可选。`mark_highlight` 汇总的高亮字段（最多 8 个，去重），每项 `{dataset: string, field: string}`；前端据此在画布上应用红色追踪链。模型未调用该工具时省略该字段（向后兼容） |

- 错误场景：`503` 未配置 LLM（`未配置 LLM：请在仓库根 .env 中设置 LLM_BASE_URL / LLM_MODEL（LLM_API_KEY 视供应商要求填写）`）；`502` LLM 上游不可达 / 返回非 200 / 响应结构不合法；`422` messages 为空、role 非法、content 超长等。

### 13.3 POST /ai/suggest

启发式生成候选边（**不调用 LLM**，可离线运行）：同名归一化（小写 + 去下划线）后完全相等 → `confidence 0.7`；包含关系（较短者 ≥3 字符）→ `0.6`。以请求数据集/字段为上游（from），其他数据集的相似字段为下游（to）；排除已存在边（含反向）；候选以 `source='ai'` **落库**并写 change_log(`added`)，按置信度降序最多 20 条；同一自然键已有边时跳过，重复调用不会重复落库。

- 所需角色：editor
- 请求体（`AiSuggestIn`）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| dataset | string | 是 | 1~256 字符，trim 后不能为空 | `"ods_raw"` |
| field | string\|null | 否 | ≤256 字符；省略时对数据集全部字段生成候选 | `"order_id"` |

- 成功响应：`200`

```json
{
  "candidates": [
    { "from_dataset": "ods_raw", "from_field": "order_id",
      "to_dataset": "dwd_order", "to_field": "order_id",
      "confidence": 0.7,
      "reason": "同名字段（忽略大小写与下划线）：order_id 与 order_id" },
    { "from_dataset": "ods_raw", "from_field": "user_id",
      "to_dataset": "dim_user", "to_field": "user_id_flag",
      "confidence": 0.6,
      "reason": "字段名高度相似（忽略大小写与下划线后为包含关系）：user_id 与 user_id_flag" }
  ]
}
```

> 注：`reason` 文案固定两类——同名匹配（0.7）为「同名字段（忽略大小写与下划线）：X 与 Y」，包含关系（0.6）为「字段名高度相似（忽略大小写与下划线后为包含关系）：X 与 Y」；归一化规则为小写 + 去下划线（`ai/suggest.py::normalize_field_name`）。

- 错误场景：`400` `dataset` trim 后为空；`404` 数据集不存在（`数据集「{dataset}」不存在`）或指定字段不存在；`422` 约束不满足。

### 13.4 POST /ai/suggest/confirm

人工确认 AI 候选边（不变量#4）：把 `source='ai'` 的边改为 `manual`，写 change_log(`updated`)。

- 所需角色：editor
- 请求体（`AiEdgeKeyIn`，候选边自然键，confirm / reject 共用）：

| 字段 | 类型 | 必填 | 约束 | 示例 |
|---|---|---|---|---|
| from_dataset | string | 是 | 1~256 字符，trim 后非空 | `"ods_raw"` |
| from_field | string\|null | 否 | ≤256；与 `to_field` 同空或同非空 | `"order_id"` |
| to_dataset | string | 是 | 1~256 字符 | `"dwd_order"` |
| to_field | string\|null | 否 | ≤256 | `"order_id"` |

- 成功响应：`200` → `{"edge": <Edge 对象>}`（`source` 已为 `"manual"`，字段同附录 A2）
- 错误场景：`400` `from_dataset`/`to_dataset` trim 后为空；字段一空一非空；`404` `AI 建议边不存在或已处理（仅 source='ai' 的候选可确认/拒绝）`——已确认过、已拒绝过或本就是人工/导入边均返回 404。

### 13.5 POST /ai/suggest/reject

拒绝 AI 候选边：删除该 `source='ai'` 的边，写 change_log(`deleted`)。

- 所需角色：editor
- 请求体：同 13.4（`AiEdgeKeyIn`）
- 成功响应：`204` 无响应体
- 错误场景：同 13.4（`400` / `404`）。

---

## 十四、数据结构附录

以下复合结构以 `models.py`、`db.py`、`locator.py`、`changes.py`、`import_service.py`、`ai/chat.py` 与数据模型 §四为准。

### A1 src_locator 定位器信封

统一信封：`{ "type": <src_type>, "input": <用户填写>, "resolved": <实文件解析物化> }`。`type` 必须与字段所属 source_file 的 `src_type` 一致（应用层校验，不一致 409/预览 409）；`resolved` 只物化解析结果，核查留痕由 `change_log`/`import_batch` 承担（预览响应的 `verification` 字段返回最近一次核查信息）。

| type | input 字段（`models.py` 定位器模型） | resolved 字段（`locator.py` 物化） |
|---|---|---|
| csv | `column: integer|null`（≥1）、`header: string|null`（二选一） | `column_index: integer`、`header: string|null` |
| xlsx | `sheet: string`（必填）、`column: string|null`（如 `"D"`）、`row_start: integer|null`（≥1）、`row_end: integer|null`（≥1）、`header_path: string[]|null`（多级表头）、`header_rows: integer|null`（≥1）；`column` 与 `header_path` 二选一 | `column_index: integer`、`column: string`、`row_start: integer|null`、`row_end: integer|null`、`merged_anchors: [{value, anchor, range}]`（合并区域归一为左上角锚点） |
| json | `json_path: string`（必填） | `hits: integer`（JSONPath 命中数） |

```json
{ "type": "xlsx",
  "input": { "sheet": "订单", "header_path": ["商品信息", "订单号"], "header_rows": 2, "row_start": 3 },
  "resolved": { "column_index": 4, "column": "D", "row_start": 3, "row_end": null,
                "merged_anchors": [{ "value": "商品信息", "anchor": "B1", "range": "B1:F1" }] } }
```

### A2 edge（血缘边对象）

`GET/POST/PATCH /edges*`、`GET /lineage/subgraph`（后者仅前 9 个业务字段）、`/ai/suggest/confirm` 返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | integer | 主键（子图/编辑/删除定位用，M2 契约增量） |
| from_dataset / to_dataset | string | 上/下游数据集 ID |
| from_field / to_field | string\|null | 上/下游字段名；均为 `null` 表示表级边 |
| transform | string\|null | 转换说明 |
| confidence | number | 0~1 |
| source | string | `imported` / `manual` / `ai` |
| note | string\|null | 备注 |
| created_by / updated_by | string\|null | 审计列（子图响应不含） |
| created_at / updated_at | string | 审计列（子图响应不含） |

### A3 annotation（标注对象）

`{id: integer, target_kind: "dataset"|"field"|"edge", target_id: string, body: string, author: string, created_at: string}`。追加式：无更新/删除接口，不随回滚删除。

### A4 change_log.before / after（行快照）

固定**业务列**集合（`changes.py` 的 `FIELD_SNAPSHOT_KEYS` / `EDGE_SNAPSHOT_KEYS`），不含 id、时间戳与审计列；同一实体 added/updated/deleted 键集合一致，可直接比较与整行重插：

- field：`dataset_id, name, field_type, source_file_id, src_locator, description`
- edge：`from_dataset, from_field, to_dataset, to_field, transform, confidence, source, note`
- `before`/`after` 为 `null` 表示该侧无状态（added 的 before、deleted 的 after）。

### A5 import_batch.report（导入报告）

```json
{ "summary": { "total": 120, "ok": 100, "merged": 8, "rejected": 12 },
  "items": [ { "status": "ok|merged|rejected",
               "kind": "field|edge",
               "ref": "ods_raw.order_id",
               "reason": "…",        // rejected 必填；ok 可为 "unchanged"；merged 为覆盖说明
               "source_row": 15 } ] }
```

`status` 取值：`ok`（新增/更新/未变化）、`merged`（同批同自然键重复，后到覆盖 transform/note/confidence）、`rejected`（行级拒绝，含实文件核查失败）。`ref`：字段为 `dataset_id.field_name`；边为 `ds.field-->ds.field`（字段为空用 `*`）。

### A6 GraphPayload（血缘子图）

`GET /lineage/subgraph` 与 `POST /ai/chat` 的 `graph` 字段共用（设计方案 §5.2「AI 出图与画布同一渲染协议」）：

```json
{
  "datasets": [
    { "id": "ods_raw", "name": "订单原始层",
      "fields": [
        { "name": "order_id", "field_type": "string", "description": "订单号",
          "src_locator": { /* A1 信封 */ },
          "source_file": { "id": 3, "original_name": "订单明细.csv" } }
      ] }
  ],
  "edges": [ /* A2 前 9 个业务字段 */ ]
}
```

- `datasets[].fields[]`：闭包内数据集的**全部**字段；定位器信封损坏时降级为 `{"type": null, "input": null, "resolved": null}`（不整图 500）。
- `edges[]`：闭包内数据集之间的全部边（含表级与字段级）。

### A7 回源预览 payload 三形态

见 §7.1 的 `preview` 字段表（csv / xlsx / json）。

### A8 AI 对话消息与工具调用轨迹

- 请求消息：`{role: "user"|"assistant", content: string}`（`system` 由后端固定，禁止前端传入）。
- 工具调用轨迹：`{tool: string, args: object, ok: boolean}`；工具名限定 `search_fields` / `get_field_details` / `trace_lineage` / `get_field_history`（全部只读）。
- 对话编排细节（最多 5 轮工具、第 6 次请求不带工具强制收口、`graph` 取最后一次成功图查询）见 `prototype/backend/src/lineagelite/ai/chat.py`。

---

## 十五、设计有、未实现

设计方案 §6.2 曾把 AI 工具集映射为 REST 端点；M4 实现改为「工具内聚于后端 + function calling」（./04_前后端职责边界.md §七），以下 REST 端点**未实现**，能力由等价途径承担，`[TBD-BE]` 是否补 REST 化由后端在后续里程碑决定：

| 设计端点（设计方案 §6.2） | 状态 | 现行等价能力 |
|---|---|---|
| `GET /search?q=`（search_fields 映射） | 未实现 `[TBD-BE]` | AI 工具 `search_fields`（`ai/tools.py`）；前端侧栏搜索用 `GET /datasets` 的 `field_names` 前端过滤 |
| `GET /fields/{ds}.{f}`（get_field_details 映射，字段详情 + 定位器 + 标注） | 未实现 `[TBD-BE]` | `GET /datasets/{dataset_id}`（字段清单）+ `GET /fields/{ds}/{f}/preview`（定位与核查）+ `GET /annotations?target_kind=field`（标注）组合；AI 工具 `get_field_details` 一次取全 |
| `GET /lineage/trace`（trace_upstream / trace_downstream 映射） | 未实现 `[TBD-BE]` | `GET /lineage/subgraph?direction=up|down`；AI 工具 `trace_lineage` |

另：设计方案 §3.6 提及源文件「经 `GET /files/{id}/download` / `/preview` 权限受控访问」——文件级 `/preview` 未实现，回源预览落地为**字段级** `GET /fields/{dataset_id}/{field_name}/preview`（按定位器预览高亮区域，而非按文件 ID）。

---

## 十六、README 与代码不一致记录

根 `README.md` 的 API 一览遗漏以下 4 个已注册端点（本文档已按代码收录，各端点小节亦有标注）；其余端点、角色、路径与代码一致：

| 端点 | 状态 |
|---|---|
| `GET /auth/me` | 代码已实现（`routes/auth.py`），README 未列 |
| `GET /import/batches/{batch_id}` | 代码已实现（`routes/imports.py`），README 未列 |
| `GET /datasets/{dataset_id}` | 代码已实现（`routes/datasets.py`），README 未列 |
| `GET /lineage/snapshot` | 代码已实现（`routes/imports.py`，M1 验证遗留），README 未列 |

---

## 十七、端点总表

共 **32** 个端点（不含 FastAPI 自带的 `/docs`、`/openapi.json`）。角色为代码依赖声明的最低角色；「登录」指任意有效 JWT（不校验角色档位）。

| # | 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|---|
| 1 | POST | /auth/login | 匿名 | 登录，签发 JWT |
| 2 | GET | /auth/me | 登录 | 当前用户（仅解码 JWT）※README 未列 |
| 3 | POST | /users | admin | 新建用户 |
| 4 | GET | /users | admin | 用户列表 |
| 5 | POST | /files | editor | 批量上传源文件（sha256 去重） |
| 6 | GET | /files | viewer | 源文件列表 |
| 7 | GET | /files/{file_id}/download | viewer | 受控下载源文件 |
| 8 | POST | /import | editor | 上传清单并导入（multipart） |
| 9 | GET | /import/batches | viewer | 导入批次列表 |
| 10 | GET | /import/batches/{batch_id} | viewer | 批次详情（含报告）※README 未列 |
| 11 | POST | /import/batches/{batch_id}/rollback | admin | 按批次回滚 |
| 12 | GET | /datasets | viewer | 数据集列表（含 field_names） |
| 13 | GET | /datasets/{dataset_id} | viewer | 数据集详情与字段 ※README 未列 |
| 14 | GET | /lineage/subgraph | viewer | N 跳血缘子图（GraphPayload） |
| 15 | GET | /lineage/snapshot | viewer | 全量快照（M1 验证遗留）※README 未列 |
| 16 | GET | /fields/{dataset_id}/{field_name}/preview | viewer | 字段回源预览（csv/xlsx/json） |
| 17 | PATCH | /fields/{dataset_id}/{field_name} | editor | 字段编辑（定位器重核查，失败 409） |
| 18 | POST | /edges | editor | 人工建边（source=manual） |
| 19 | PATCH | /edges/{edge_id} | editor | 改 transform/note/confidence |
| 20 | DELETE | /edges/{edge_id} | editor | 删除边（204） |
| 21 | POST | /annotations | editor | 追加标注（多态目标） |
| 22 | GET | /annotations | viewer | 标注查询（可按目标过滤） |
| 23 | GET | /changes | viewer | 变更历史（id 倒序） |
| 24 | POST | /version-tags | editor | 创建业务标签 |
| 25 | GET | /version-tags | viewer | 标签列表 |
| 26 | GET | /version-tags/diff?from=&to= | viewer | 标签间净变更 |
| 27 | POST | /version-tags/{name}/rollback | admin | 回滚到标签（幂等） |
| 28 | GET | /ai/status | viewer | LLM 配置状态 |
| 29 | POST | /ai/chat | viewer | AI 对话（function calling + 出图） |
| 30 | POST | /ai/suggest | editor | 生成并落库 AI 候选边（source=ai） |
| 31 | POST | /ai/suggest/confirm | editor | 确认候选边转 manual |
| 32 | POST | /ai/suggest/reject | editor | 拒绝并删除候选边（204） |
