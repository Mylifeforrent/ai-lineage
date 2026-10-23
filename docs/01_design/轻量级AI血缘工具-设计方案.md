# 轻量级 AI 血缘工具设计方案（工作名：LineageLite）

> 基于 OpenMetadata 与 DataHub 两个开源方案的调研结论，面向「文件导入 + 字段级源文件定位 + AI 辅助」的轻量级数据血缘工具。
> 文中未确认的业务事实以 `[ASSUMPTION]` / `[TBD-*]` 标注。

---

## 一、两大开源方案调研结论

### 1.1 OpenMetadata 核心设计

| 维度 | 设计 | 关键证据 |
|---|---|---|
| 数据模型 | 实体无关的「实体 + 边」图：一切资产是 Entity，血缘边挂 `LineageDetails` JSON（含列级映射 `fromColumns[] -> toColumn + function`、SQL 原文、来源枚举） | `openmetadata-spec/src/main/resources/json/schema/type/entityLineage.json` |
| 边存储 | `entity_relationship` 表（fromId/toId/fromEntity/toEntity/relation），`LineageDetails` 整体存 JSON 列；ES 里另存「反向血缘」文档做搜索 | `bootstrap/sql/migrations/.../v001__create_db_connection_info.sql` |
| 采集 | push 为主：Python ingestion（SQL 解析器、dbt、Airflow 等 18+ 连接器）+ REST API + OpenLineage。**血缘只能 CSV 导出、不能 CSV 导入** | `ingestion/src/metadata/ingestion/lineage/`、`LineageResource.java:632` |
| 查询 | DB 递归展开（depth≤3）+ ES BFS（大图按 Small/Medium/Large/Streaming 四策略）双路径 | `LineageRepository.java`、`AbstractLineageGraphBuilder.java` |
| 版本 | 实体 `Major.Minor` 版本 + change_event 表；**血缘边独立发 `ENTITY_LINEAGE_ADDED/UPDATED/DELETED` change event**，边 ID 由 fromId+toId 确定性哈希生成 | `type/changeEventType.json:45`、`LineageRepository.java:2082` |
| 前端 | **reactflow**；列级连线用 sourceHandle/targetHandle，`tracedColumns` 高亮；新 scene/hydrate 架构按 LAYER/ASSET/FIELD 分层、批量取实体消灭 N+1 | `openmetadata-ui/.../Lineage/Lineage.tsx`、`EntityLineageCanvas.tsx` |
| AI | 官方 MCP server（21 个读写工具，含 `get_entity_lineage`、`root_cause_analysis`、`create_lineage`），输出刻意 verbose（全 SQL + 列级映射）给 AI 消费 | `openmetadata-mcp/src/main/java/org/openmetadata/mcp/tools/` |
| 部署 | MySQL + Elasticsearch + Java 后端 + ingestion 容器四件套起，定位企业级平台 | `docker/docker-compose-quickstart/` |

### 1.2 DataHub 核心设计

| 维度 | 设计 | 关键证据 |
|---|---|---|
| 数据模型 | 血缘是实体上的一个 Aspect（`UpstreamLineage`），PDL 注解 `@Relationship(isLineage=true)` 声明边，系统自动物化到 ES 图索引 `graph_service_v1`；字段级用 `FineGrainedLineage`：**多对多 + transformOperation + confidenceScore(0~1)**；schemaField 是一等实体 | `metadata-models/.../dataset/UpstreamLineage.pdl`、`FineGrainedLineage.pdl` |
| 存储链路 | MCP 事件 → Kafka/REST → GMS → MySQL `metadata_aspect_v2`（urn+aspect+version+JSON）→ MCL → MAE 消费者写 ES 图/搜索索引 | `metadata-io/.../EbeanAspectDao.java:81` |
| 版本 | 三层：MCP 写前提案（含 CAS version）→ MCL 写后日志（previous/next 值）→ aspect 行级历史（latest 恒为 version=0，历史递增）；支持**按 ingestion run 回滚**；边带 createdOn 支持 PIT 时间回看 | `metadata-models/.../mxe/`、`EbeanAspectDao.java:643`、`TimelineServiceImpl.java` |
| 采集 | YAML recipe（source→transformer→sink）框架；SQL 血缘基于 sqlglot；**JSON 文件可导（file source/sink 往返），CSV 只能补描述/tag，不能导血缘** | `metadata-ingestion/src/datahub/ingestion/source/file.py`、`csv_enricher.py` |
| 查询 | GraphQL → GraphService → ES 图索引逐 hop BFS（分片、预算、超时截断）+ `searchAcrossLineage` 把过滤翻译成 ES 查询 | `ESGraphQueryDAO.java:56`、`GraphQueryPITDAO.java` |
| 前端 | 同样 **reactflow**（lineageV3）：`ColumnLineageControl` 列级连线、`LineageExplorer` 折叠展开、`manualLineage/` 手工编辑 | `datahub-web-react/src/app/lineageV3/` |
| AI | `datahub-agent-context` PyPI 包：把搜索/取详情/**trace lineage**/变更封装成 MCP + LangChain 工具给 AI agent | `datahub-agent-context/README.md` |
| 部署 | Kafka + MySQL + OpenSearch + GMS/前端等 7 个服务；有 datahub-lite 单文件嵌入式轻量变体 | `docker/quickstart/docker-compose.quickstart-profile.yml` |

### 1.3 对本方案的启示

**借鉴**：
1. 实体+边 + 边上挂详情（列级映射、转换函数、来源枚举）的 schema —— OpenMetadata 的 `entityLineage.json` 结构可直接裁剪复用；
2. `FineGrainedLineage` 的 `confidenceScore` —— AI 推断出的血缘必须带置信度、人工确认后提升，这是「AI 优化」的正确形态；
3. 每条边记录来源（Manual/Imported/AIInferred）+ 边级 change event + 确定性边 ID —— 廉价的版本管理方案；
4. reactflow 的 sourceHandle/targetHandle 列级连线 —— 两个方案都验证了这条路可行；
5. MCP/工具化接口（verbose lineage 输出 + 列级 scope 裁剪）—— AI 对话消费血缘的正确接口形态。

**避免**：
1. Kafka + ES/OpenSearch 双写与反规范化 —— 中小规模用单关系库 + 递归 CTE 即可，消除一整类一致性/重索引问题；
2. PDL/AVRO/JSON Schema 的编译期 codegen 链与多模块工程 —— 用 pydantic 模型即可；
3. 硬编码 depth≤3 递归 + 逐节点 N+1 查询 —— 一步到位用 CTE 批量遍历 + 单次 hydrate；
4. CSV 不能导入血缘的缺口 —— 本方案把「文件一等公民导入」作为核心功能。

---

## 二、目标与范围

**目标**：单人/小团队可独立运维的字段级数据血缘工具：
- 用户把自己整理（非第一手）的 CSV / XLSX / JSON 数据导入；
- 每个字段携带原文件精确定位（文件路径 + 工作表/行/列 / JSONPath），供他人回源核查；
- 关系型数据库存储，带版本管理；
- 可视化血缘图（节点/字段折叠、字段级连线）；
- AI 对话查血缘、动态出图；
- 基于第一手资料人工纠错、补充说明。

**非目标**（从两大方案的重量级能力中明确裁剪）：
- 不做 SQL 解析自动采集、不做调度器/连接器生态；
- 不接 Elasticsearch/OpenSearch，搜索用 SQLite FTS5 / Postgres 全文检索；
- 不做细粒度对象级 ACL，多用户采用「工作区级 RBAC（admin / editor / viewer）+ 全操作留痕」模型（见 4.4）。若未来需要数据集级私有/授权，再引入 `dataset_acl` 表扩展。

**技术栈**（遵循个人默认偏好）：
- 后端：Python + FastAPI + uv，SQLite 起步（预留 Postgres 升级路径，SQL 全部写兼容子集 + 递归 CTE）；
- 前端：React + TypeScript + Vite + Tailwind + shadcn/ui，图渲染 **@xyflow/react（reactflow 11+）**；
- AI：OpenAI 兼容 Chat API + function calling（工具即本系统 REST API 的薄封装）；供应商与模型经仓库根 `.env` 配置（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`），`.env.example` 入库、`.env` 加入 .gitignore，密钥永不入库；
- 认证：JWT（账号密码登录），密码只存加盐哈希。

---

## 三、导入数据格式规范（需求 1）

设计为**两类文件**：`数据集清单`（描述节点和字段）与 `血缘关系`（描述边）。同一批导入绑定一次提交。用户数据基本是二手转换数据，因此格式规范的核心是：**每个字段必须携带「源文件定位器」**。

### 3.1 数据集清单（datasets & fields）

每行描述一个数据集中的一个字段：

| 列 | 必填 | 说明 |
|---|---|---|
| `dataset_id` | 是 | 数据集唯一标识（用户自定义字符串，如 `dwd_order`） |
| `dataset_name` | 否 | 显示名 |
| `field_name` | 是 | 字段名（数据集内唯一） |
| `field_type` | 否 | 类型描述（自由文本） |
| `src_file` | **是** | 引用的**已托管源文件**标识（见 3.6）：源文件库 ID 或原始文件名（须能在本批导入绑定的上传文件集中唯一定位） |
| `src_type` | **是** | `csv` / `xlsx` / `json`，决定定位器结构 |
| `src_locator` | **是** | 源文件内定位（结构见 3.2） |
| `description` | 否 | 字段说明 |

### 3.2 源文件定位器 `src_locator`（按 `src_type` 校验）

```jsonc
// src_type = csv：字段=原始CSV的某一列
{ "column": 3 }                    // 列序号（1-based）
{ "header": "order_no" }           // 或表头名（二选一，导入时校验）

// src_type = xlsx：字段=某工作表某列，可带数据行范围
{ "sheet": "订单明细", "column": "D", "row_start": 2, "row_end": 15000 }

// src_type = xlsx + 多级表头（Multi-header）：
// header_path 按层级匹配表头行，合并单元格的父表头自动展开覆盖其所有列
{ "sheet": "订单", "header_path": ["商品信息", "订单号"], "header_rows": 2, "row_start": 3 }

// src_type = json：字段=JSON文档某路径
{ "json_path": "$.data.items[*].order_no" }
```

> 设计理由：OpenMetadata 的 FQN 体系没有 `file:line` 级定位，这是本方案的差异化核心。定位器存 JSON 列，但导入时**按 src_type 做结构校验**，校验失败整行拒绝并给出可读错误报告（文件名、行号、原因）。

**XLSX 合并单元格 / 复杂表头归一化规则**（定位解析时统一执行）：

1. **锚点归一**：任何落在合并区域内的单元格，定位一律归一到该区域的**左上角锚点**；存储时同时记录锚点地址与合并范围（`anchor: "D2", merged_range: "D2:G8"`），保证「用户看到的合并单元格」与「存储的定位」一一对应；
2. **多级表头展开**：`header_path` 按层级逐行匹配；若某层表头是合并单元格，视为其覆盖的所有列均属于该父级（如第 1 行「商品信息」合并覆盖 B:F 列，则 `["商品信息","订单号"]` 会在 B:F 范围内继续匹配第 2 行的「订单号」）；
3. **解析结果物化**：导入时用 openpyxl 解析真实文件，把 `header_path` 解析物化为确定的 `column + row_start`，连同锚点信息一起存入 `src_locator`——后续即使源文件表头被改动，历史定位仍可回看（同时校验环节会报「定位已失效」）。

### 3.3 血缘关系（lineage）

每行描述一条字段级血缘边（数据集级边由字段级边自动推导，也允许只填表级）：

| 列 | 必填 | 说明 |
|---|---|---|
| `from_dataset` / `from_field` | 是 | 上游；`from_field` 为空表示表级血缘 |
| `to_dataset` / `to_field` | 是 | 下游 |
| `transform` | 否 | 转换说明（SQL 片段/公式/文字描述），借鉴 OpenMetadata 的 `function` + `sqlQuery` |
| `confidence` | 否 | 0~1 置信度，借鉴 DataHub `FineGrainedLineage.confidenceScore`；默认 1.0 |
| `note` | 否 | 备注 |

### 3.4 三种物理格式的承载方式

| 格式 | 承载 |
|---|---|
| CSV | 两个文件：`datasets.csv` + `lineage.csv`，UTF-8 |
| XLSX | 一个工作簿两个 sheet：`datasets` / `lineage`（单元格可加批注，适合业务人员） |
| JSON | 单文件：`{ "datasets": [...], "lineage": [...] }`，字段与上表一一对应，`src_locator` 为嵌套对象 |

导入器统一归一化为同一 pydantic 模型（`DatasetFieldRecord` / `LineageEdgeRecord`），后续处理与格式无关。

### 3.5 导入校验规则

1. 结构校验：必填列缺失、`src_type` 与 `src_locator` 结构不匹配 → 拒绝；
2. **实文件核查**（源文件已托管，见 3.6）：导入时直接打开第一手文件做机械核查——sheet 是否存在、`header_path`/`column` 能否解析、合并单元格归一化、`json_path` 能否取到值。核查不通过的行进入报告并拒绝；这一步把「用户手填定位是否正确」从人工核查变成系统自动核查；
3. 引用校验：lineage 引用的 dataset/field 必须存在于本批或已有版本；
4. 重复冲突：同 `from→to` 字段对重复时合并（后到覆盖 transform/note），并在报告中列出；
5. 产出**导入报告**（成功/跳过/失败逐条 + 失败原因 + 实文件核查结果），借鉴 ingestion report 模式，报告本身可下载为 JSON。

### 3.6 源文件托管上传

源文件（第一手资料）由系统托管，不再只存路径引用：

- **上传 API**：`POST /files`（multipart，支持批量），记录原始文件名、大小、上传者；
- **文件库表**：`source_file`（见 4.1），按 **sha256 去重**——同一文件多次上传引用同一条记录（血缘场景常出现多个字段来自同一源文件）；
- **存储后端**：默认本地 `data/files/`（目录经 `.env` 配置），存储路径不直接暴露，经 `GET /files/{id}/download` / `/preview` 权限受控访问；后端抽象成接口，预留 S3/MinIO 兼容实现 `[TBD-INFRA]`（由部署环境决定，M1 先做本地）；
- **导入流程**变为三步：① 上传源文件（得到文件集）→ ② 上传清单（datasets/lineage，`src_file` 引用文件集中文件）→ ③ 校验 + 入库（绑定到同一 `import_batch`）；
- **回源核查闭环**：定位卡点击后可直接在系统内**预览源文件对应区域**（高亮 sheet / 表头路径 / 列与行范围 / JSONPath 命中值），无需再去找原始文件。

---

## 四、存储与版本管理（需求 2）

### 4.1 表结构（SQLite/Postgres 通用）

```sql
-- 用户（多用户 RBAC）
user(id INTEGER PK AUTOINCREMENT,
     username TEXT UNIQUE NOT NULL,
     password_hash TEXT NOT NULL,          -- 加盐哈希，永不明文
     display_name TEXT,
     role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
     created_at)

-- 源文件托管（第一手资料文件库）
source_file(id INTEGER PK AUTOINCREMENT,
            original_name TEXT NOT NULL,
            storage_path TEXT NOT NULL,     -- 实际存储路径，不对外暴露
            sha256 TEXT UNIQUE NOT NULL,   -- 去重键：同文件只存一份
            size_bytes INTEGER,
            src_type TEXT NOT NULL CHECK(src_type IN ('csv','xlsx','json')),
            uploaded_by TEXT NOT NULL,
            created_at)

-- 数据集（节点）
dataset(id TEXT PK,            -- 即 dataset_id
        name TEXT, description TEXT,
        created_at, updated_at)

-- 字段（含源文件定位器）
field(id INTEGER PK AUTOINCREMENT,
      dataset_id TEXT NOT NULL REFERENCES dataset(id),
      name TEXT NOT NULL,
      field_type TEXT,
      source_file_id INTEGER NOT NULL REFERENCES source_file(id),
      src_locator TEXT NOT NULL,      -- JSON：定位器 + 实文件解析物化结果（锚点/合并范围/行列）
      description TEXT,
      UNIQUE(dataset_id, name))

-- 血缘边（表级 + 字段级统一存一张表；表级边 field 为 NULL）
edge(id INTEGER PK AUTOINCREMENT,
     from_dataset TEXT NOT NULL, from_field TEXT NULL,
     to_dataset   TEXT NOT NULL, to_field   TEXT NULL,
     transform TEXT, confidence REAL DEFAULT 1.0,
     source TEXT NOT NULL CHECK(source IN ('imported','manual','ai')),
     note TEXT,
     created_by TEXT, updated_by TEXT,
     created_at, updated_at,
     UNIQUE(from_dataset, from_field, to_dataset, to_field))
-- 确定性语义：同一 from→to 只有一条边（等价 OpenMetadata 的 (fromId,toId,relation) 主键）

-- 导入批次 = 版本（借鉴 DataHub 的 ingestion run）
import_batch(id INTEGER PK, version_no INTEGER NOT NULL UNIQUE,  -- v1, v2, ...
             file_names TEXT, format TEXT, report TEXT,  -- 导入报告 JSON
             created_by TEXT NOT NULL,
             created_at)

-- 版本业务标签（发布版本号，如 v2.1-r1）
version_tag(id INTEGER PK,
            name TEXT UNIQUE NOT NULL,       -- 业务标签名
            note TEXT,                       -- 标签说明（如「Q3 口径修正发布」）
            batch_id INTEGER,                 -- 打标签时对应的导入批次
            change_seq INTEGER NOT NULL,      -- change_log 中的位置（时间点锚）
            created_by TEXT NOT NULL, created_at)

-- 字段级/边级覆盖层：编辑说明与人工修正
annotation(id INTEGER PK, target_kind TEXT CHECK(target_kind IN ('field','edge','dataset')),
           target_id TEXT,          -- field:"ds.field" / edge:"from->to" / dataset:id
           body TEXT NOT NULL, author TEXT, created_at)

-- 变更日志（借鉴 OpenMetadata ENTITY_LINEAGE_* change event + DataHub MCL）
change_log(id INTEGER PK, batch_id INTEGER NULL,  -- 关联导入批次；人工编辑为 NULL
           entity_kind TEXT, entity_key TEXT,
           op TEXT CHECK(op IN ('added','updated','deleted')),
           before TEXT, after TEXT,   -- JSON 快照
           actor TEXT, created_at)
```

### 4.2 版本管理设计

采用 **「当前态 + 导入批次 + 版本标签 + 变更日志」** 四层，而非全量快照（数据量小到中等时最省、可回滚）：

1. **导入即新版本**：每次导入创建 `import_batch`，`version_no` 递增（v1, v2...）；
2. **写前提案/写后日志**（DataHub 思路的轻量化）：导入或编辑的每一行变更都写 `change_log`（op + before/after JSON），批次和日志天然支持「**按版本回滚**」——把该批次产生的 added 反向删除、updated 恢复 before；
3. **版本业务标签**：任意时刻可打标签（如 `v2.1-r1 / Q3 口径修正发布`），标签锚定一个 `change_seq` 位置。**回滚到标签 = 反做该 seq 之后的全部 change_log**，**标签间 diff = change_log 区间比对**；标签由 editor 以上角色创建，永久保留；
4. **编辑来源可追溯**：边上的 `source` 字段区分 `imported`（用户文件来的）/ `manual`（人工纠正）/ `ai`（AI 推断，confidence < 1），配合 `created_by` 落到具体用户。

### 4.3 图遍历：递归 CTE

两大方案的教训：OpenMetadata 初版 depth≤3 硬编码 + N+1 查询，后来用 hydrate/scene 补救；DataHub 用 ES 图索引 + 分片预算。本方案规模小，直接用递归 CTE 一次查询取出 N 跳子图：

```sql
WITH RECURSIVE up(n_ds, n_field, hop) AS (
  SELECT to_dataset, to_field, 0 FROM edge WHERE (…)   -- 起点
  UNION
  SELECT e.from_dataset, e.from_field, up.hop + 1
  FROM edge e JOIN up ON e.to_dataset = up.n_ds
              AND (e.to_field IS NULL OR e.to_field = up.n_field OR up.n_field IS NULL)
  WHERE up.hop < :max_hop)
SELECT * FROM up;
```

上下游两个方向各一条 CTE；前端一次拿全子图数据，`hydrate` 语义天然满足（不存在 N+1）。

### 4.4 用户与权限（多用户）

JWT 认证 + 工作区级 RBAC 三角色，所有写操作（导入、编辑、标注、打标签）在 change_log / 各表 `created_by` 中记录操作者：

| 角色 | 权限 |
|---|---|
| `viewer` | 浏览血缘图、查看字段详情与源文件预览、AI 只读问答（trace/search/get_subgraph） |
| `editor` | viewer + 上传源文件、导入清单、画布编辑（纠错/连线/改定位器）、标注、创建版本标签、确认 AI 建议边 |
| `admin` | editor + 用户与角色管理、按批次/标签回滚、删除数据集、重置导入 |

实现为 FastAPI 依赖注入的角色守卫（每个路由声明最低角色），不做行级/对象级 ACL；`annotation` 与 `change_log` 中的 author/actor 均取自 JWT，不可伪造。

---

## 五、可视化界面（需求 3）

技术选型：**@xyflow/react（reactflow）** —— 两个方案都选择它，列级连线（sourceHandle/targetHandle）、节点折叠、布局生态都被验证过，抄作业风险最低。zustand 做画布状态。

### 5.1 核心交互

| 需求 | 实现 |
|---|---|
| 展示感兴趣的数据集 | 顶部搜索/选择起点数据集 → `GET /lineage/subgraph`（CTE）取上下游 N 跳子图 |
| 上下游关系 | 左右流向布局（dagre 自动布局），上游在左、下游在右 |
| 字段级连线 | 节点卡片内每个字段渲染为可连接的 handle 行，字段级边画 handle→handle 连线；表级边画节点→节点 |
| 折叠字段/节点 | reactflow 节点内 `collapsed` 状态：折叠节点收起字段列表（仅显示表级边）；折叠一组节点收起为一个分组占位节点（OpenMetadata `LoadMoreNode` 的思路） |
| 源文件定位 | 字段行 hover/点击弹出定位卡：源文件名 + 定位器人类可读形式（如 `订单明细.xlsx #sheet「订单明细」 D2:D15000`）。由于源文件已托管（3.6），点击定位卡可**在系统内直接预览源文件对应区域**（高亮表头路径/列/行范围/JSONPath 命中值），一键复制 |
| 过滤 | 按数据集名、字段名、置信度（隐藏 AI 低置信边）、编辑来源过滤 |

### 5.2 与 AI 出图共用同一渲染协议

后端所有「取子图」能力统一返回一种 `GraphPayload`（nodes + edges + 字段），前端只有一个渲染入口；搜索出图、点击展开、AI 对话出图都走它，避免 OpenMetadata 那样新旧两套图架构并存。

---

## 六、AI 对话（需求 4）

### 6.1 形态

聊天面板（侧边抽屉）+ 画布联动。AI 通过 **function calling** 调用本系统 API 工具，工具返回结构化数据，AI 组织回答，同时前端把工具结果中的 `graph` 渲染到画布。

### 6.2 工具集（薄封装 REST，借鉴 OpenMetadata MCP 的 verbose 原则 + datahub-agent-context 的接口形态）

| 工具 | 对应 API | 说明 |
|---|---|---|
| `search_fields` | `GET /search?q=` | 按名字/描述/说明模糊找字段 |
| `get_field_details` | `GET /fields/{ds}.{f}` | 字段详情 + 源文件定位器 + 标注历史 |
| `trace_upstream` / `trace_downstream` | `GET /lineage/trace` | 递归 CTE 取上下游，参数：起点字段、方向、最大跳数、是否含表级边 |
| `get_subgraph` | `GET /lineage/subgraph` | 取子图 `GraphPayload`，前端渲染 |
| `get_field_history` | `GET /changes?entity=` | 字段的版本变更历史 |
| `suggest_lineage` | `POST /ai/suggest` | **AI 反向优化**：AI 根据字段名/描述/相似度提议可能缺失的血缘边（confidence 低、source='ai'），用户在图上确认/拒绝 |

### 6.3 示例对话流

> 用户：`订单表里的 order_no 是从哪来的？`
> AI 调 `search_fields("order_no")` → `trace_upstream(ds=xxx, field=order_no, hops=3)`
> 回答：「`order_no` 由 `ods_raw.order_id` 经 `cast/trim` 得到（2 跳，置信度 1.0），源头字段位于 `订单明细.xlsx` sheet「订单明细」D 列」+ 前端画布自动切换到该字段上下游子图。

### 6.4 AI 优化的两条路径

1. **查询侧**（需求 4 主体）：自然语言 → 工具调用 → 动态出图；
2. **数据质量侧**（需求 5 的辅助）：`suggest_lineage` 用同名/语义相似/上下游邻近启发式 + LLM 判断，产出低置信候选边，**必须人工确认**才转 `source='manual'`——这是从 DataHub `confidenceScore` 借来的关键安全设计。

---

## 七、人工纠错与标注（需求 5）

| 能力 | 设计 |
|---|---|
| 编辑节点/字段 | 画布节点详情面板：改名、改描述、**修正 src_locator**（基于第一手资料核对后改定位） |
| 编辑边 | 改 transform/note、删除错误边、新增边（图上拖 handle 连线，等价 DataHub `manualLineage`） |
| 补充说明 | `annotation` 表：对任意字段/边/数据集添加说明条目（body + author + 时间），**追加式不覆盖原始导入值**——原始导入数据与人工见解分离，方便他人理解 |
| 全量留痕 | 每次编辑写 `change_log`（before/after），支持查看某字段「谁在何时改了什么」 |
| 回滚 | 按导入批次回滚（4.2）；单条编辑可通过 change_log 恢复 before |

---

## 八、总体架构

```
┌───────────────────────────────┐
│  前端 SPA (React + Vite)       │
│  ├─ 登录/用户（JWT）            │
│  ├─ 血缘画布 (@xyflow/react)   │
│  ├─ 导入向导（传源文件→传清单→报告）│
│  └─ AI 聊天抽屉（工具调用联动画布）│
└──────────────┬────────────────┘
        REST / JSON (JWT 鉴权 + RBAC 守卫)
┌──────────────┴────────────────┐
│  FastAPI 后端（单进程）         │
│  ├─ auth：JWT + 角色守卫       │
│  ├─ importer：csv/xlsx/json   │
│  │   归一化 + pydantic 校验     │
│  │   + 实文件定位核查(openpyxl) │
│  ├─ files：源文件托管/去重/预览 │
│  ├─ lineage：递归 CTE 图查询    │
│  ├─ versioning：批次/标签/日志  │
│  └─ ai：function calling 编排   │
└──────────────┬────────────────┘
     SQLite (FTS5 搜索)
     data/files/ (源文件托管，sha256 去重)
     [预留 Postgres / S3 升级路径]
```

与两大方案最大的架构差异：**单进程、单存储、无消息队列、无搜索集群**。DataHub 的事件驱动（Kafka+MCP+MCL）用「同步写 + change_log 表」替代；OpenMetadata 的 DB+ES 双查询路径用「递归 CTE 单路径」替代。

---

## 九、里程碑（建议）

| 阶段 | 内容 | 验证标准 |
|---|---|---|
| M1 数据底座 | 表结构（含 user/source_file/version_tag）、JWT 认证 + RBAC、源文件上传与 sha256 去重、CSV/JSON/XLSX 导入器（含合并单元格/多级表头定位解析与实文件核查）、版本批次/change_log | 三种格式各一份样例（含复杂表头 xlsx）导入通过；错误定位器被实文件核查拒绝；回滚 v2 → 恢复 v1 状态；viewer 角色无法写入 |
| M2 图查询 + 画布 | 递归 CTE API + reactflow 画布：子图渲染、字段级连线、折叠、定位卡 + 源文件区域内预览 | 手工构造 5 数据集样例，上下游 3 跳展开正确、折叠正常、点击定位卡能高亮预览源文件区域 |
| M3 编辑与标注 | 画布编辑边/字段（editor 以上）、标注、历史查看、版本业务标签与标签 diff/回滚 | 编辑留痕（记录操作者）、按标签回滚正确、人工标注不丢 |
| M4 AI 对话 | 工具集 + 聊天抽屉 + 联动出图 + suggest_lineage（确认权限 editor 以上） | 「order_no 从哪来」类问题正确出图；AI 建议边需人工确认才生效 |

---

## 十、已确认决策记录（2026-10-23）

| # | 事项 | 决策 | 设计落点 |
|---|---|---|---|
| 1 | 多用户权限 | **需要**。采用工作区级 RBAC（admin/editor/viewer）+ JWT + 全操作留痕；不做对象级 ACL | 4.4 用户与权限 |
| 2 | 版本业务标签 | **需要**。`version_tag` 表，标签锚定 change_log 位置，支持标签间 diff 与回滚到标签 | 4.1 / 4.2 |
| 3 | 源文件托管上传 | **需要**。`source_file` 表 + sha256 去重 + 受控预览/下载；附带收益：导入时可对第一手文件做定位器实文件核查，画布定位卡支持区域内预览 | 3.5 / 3.6 |
| 4 | XLSX 复杂表头 | **需要支持**。合并单元格锚点归一化 + 多级表头 `header_path` 展开 + 解析结果物化存储 | 3.2 归一化规则 |
| 5 | LLM 供应商 | OpenAI 兼容 API，配置在仓库根 `.env`（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`），`.env` 不入库 | 二 技术栈 |
| 6 | 界面布局 | **低保真原型已确认（2026-10-23）**，作为 UI 基线。共 6 界面：血缘画布（核心）、源文件预览（回源核查弹窗）、导入向导（三步+校验报告）、AI 对话（工具追溯+建议确认）、版本与用户（批次/标签/回滚+RBAC 矩阵）、登录 | 五 可视化界面 |

剩余待定项（不阻塞 M1 开发）：
- `[TBD-INFRA]` 源文件存储后端 M1 用本地 `data/files/`，S3/MinIO 抽象接口何时实做，由部署环境决定；
- `[TBD-BIZ]` 是否需要数据集级私有/授权（当前工作区内所有用户可见所有数据集），出现真实需求再引入 `dataset_acl`。
