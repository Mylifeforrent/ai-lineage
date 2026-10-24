# LineageLite 文档索引

本目录按「设计 → 原型 → 实现」的层次组织项目文档，建议按编号顺序阅读。

## 目录结构

```
docs/
├── README.md                          # 本索引
├── 01_design/                         # 设计文档（评审与开发的唯一依据）
│   ├── 轻量级AI血缘工具-设计方案.md      # 总体方案：调研结论、架构、里程碑、决策记录
│   ├── 轻量级AI血缘工具-业务模型.md      # 业务层：定位、干系人、领域概念、业务规则与不变量
│   └── 轻量级AI血缘工具-数据模型.md      # 数据层：ER 图、表定义、索引、版本重建规则
├── 02_prototype/
│   └── lineagelite-lofi-prototype.html # 低保真原型（浏览器直接打开，标签页切换 6 个界面）
└── 03_dev/                            # 开发文档（基于 01_design 设计与 prototype 实现整理）
    ├── 01_架构设计.md                   # 系统上下文、模块划分、关键数据流、部署形态、架构决策摘要
    ├── 02_前端开发文档.md               # 前端技术栈、组件清单、血缘画布实现、认证与状态管理
    ├── 03_后端开发文档.md               # 后端技术栈、模块职责、.env 配置、导入/版本/AI 实现说明
    ├── 04_前后端职责边界.md             # 14 个功能域的前后端职责矩阵与安全边界
    └── 05_API接口文档.md                # 全部 32 个端点的契约（参数、响应、错误、权限）

再下还有 04_hifi/（高保真设计规范，2026-10-24 定稿：白底 + blue 主色，已落地 prototype/frontend）：
    ├── 00_设计总览与DesignToken.md      # token 唯一来源：色彩/字体/间距/动效/通用组件规格 + 旧→新映射
    ├── 01_登录页.md                     # 左右分栏大卡：blue-900 品牌面板 + 白色表单
    ├── 02_血缘画布工作区.md             # 顶栏/侧栏/画布三区骨架与节点、边、浮层完整规格
    ├── 03_详情与预览.md                 # 右侧详情面板、回源预览模态、新增边模态
    ├── 04_AI助手.md                     # AI 对话抽屉：消息气泡、工具轨迹卡、候选边卡
    ├── 05_版本与用户.md                 # 版本抽屉、变更历史时间线、用户管理模态
    └── 06_导入向导.md                   # [TBD-FE] 全新设计基线，本轮未实现
```

## 阅读顺序

| 顺序 | 文档 | 回答的问题 |
|---|---|---|
| 1 | [设计方案](./01_design/轻量级AI血缘工具-设计方案.md) | 为什么这么做：两大开源方案的调研结论、总体架构、技术选型、里程碑与已确认决策记录（§十） |
| 2 | [业务模型](./01_design/轻量级AI血缘工具-业务模型.md) | 业务上是什么：价值主张、角色权限、12 个领域概念、7 条业务流程、9 条业务不变量 |
| 3 | [数据模型](./01_design/轻量级AI血缘工具-数据模型.md) | 数据怎么存：10 张表逐列定义（含 M3 rollback_record）、定位器 JSON 信封、命名规则、回滚重建规则、M2/M3/M4 API 契约增量 |
| 4 | [低保真原型](./02_prototype/lineagelite-lofi-prototype.html) | 长什么样：血缘画布、源文件预览、导入向导、AI 对话、版本与用户、登录 6 个界面线框 |

## 开发文档（03_dev/）

基于 01_design 设计文档与 prototype/ 实现整理，面向开发者。设计文档与实现不一致时以代码现状为准，差异记录在各文档的「已知差距 / 差异」小节。正式工程目录为仓库根 `backend/` 与 `frontend/`（自 prototype 同源移植，差异见各自 README）；本文路径引用仍指 prototype 基线。

| 文档 | 内容 |
|---|---|
| [架构设计](./03_dev/01_架构设计.md) | 系统定位与上下文、总体架构与模块划分、关键数据流（导入/子图/预览/AI/回滚）、外部依赖、部署形态、架构决策摘要 |
| [前端开发文档](./03_dev/02_前端开发文档.md) | 前端技术栈与版本、目录结构、开发工作流、认证与全局状态、API 访问层、组件清单、血缘画布实现、角色权限的 UI 表现 |
| [后端开发文档](./03_dev/03_后端开发文档.md) | 后端技术栈与版本、模块职责表、.env 配置、数据库与 RBAC、导入流水线、版本与回滚、AI 模块、错误处理约定、测试与运维命令 |
| [前后端职责边界](./03_dev/04_前后端职责边界.md) | 边界总原则、14 个功能域职责矩阵、认证授权边界、数据契约边界、AI 边界、禁止事项清单 |
| [API 接口文档](./03_dev/05_API接口文档.md) | 通用约定（认证/错误结构/状态码语义）、按功能域分组的全部端点契约、数据结构附录、端点总表 |

## 文档与代码的对应关系

| 文档章节 | 代码落点 |
|---|---|
| 数据模型 §二 表定义 | `prototype/backend/src/lineagelite/db.py`（DDL 与文档逐表对齐，含 rollback_record） |
| 数据模型 §四 JSON 结构 | `prototype/backend/src/lineagelite/locator.py`、`manifest.py`（定位器信封 + 实文件核查） |
| 设计方案 §3.5-3.6 导入流程 | `prototype/backend/src/lineagelite/import_service.py`、`routes/imports.py` |
| 设计方案 §4.4 用户与权限 | `prototype/backend/src/lineagelite/security.py`、`routes/auth.py` |
| 数据模型 §七 版本重建 | `prototype/backend/src/lineagelite/versioning.py`（按批次/按标签回滚、标签 diff、幂等反做） |
| 数据模型 §九 M2 契约增量 | `prototype/backend/src/lineagelite/routes/datasets.py`（field_names）、`preview.py`（file/verification）、`lineage.py`（edge.id） |
| 数据模型 §九 M3 编辑与标注 | `prototype/backend/src/lineagelite/routes/annotations.py`、`routes/fields.py`、`routes/edges.py`、`routes/changes.py`、`routes/version_tags.py`、`changes.py` |
| 数据模型 §九 M4 AI 接口 | `prototype/backend/src/lineagelite/routes/ai.py`、`ai/suggest.py`、`ai/tools.py`、`ai/chat.py`、`ai/llm.py`；前端 `components/AiAssistantDrawer.tsx`、`components/EdgeDetailPanel.tsx` |
| 业务模型 §六 不变量 | 部分由数据库约束保证（边唯一部分索引），部分由服务层校验保证，均有对应测试（`prototype/backend/tests/test_m3_api.py` 等） |

## 维护约定

- 文档冲突时以「数据模型 → 设计方案 → 业务模型」的数据层优先顺序裁决，并按 AGENTS.md 规范在冲突处标 `[CONFLICT]`；
- 涉及表结构、不变量、接口语义的代码改动，必须同步更新对应文档章节；
- 原型为 2026-10-23 确认的 UI 基线（设计方案 §十 决策#6），M2 前端开发以其为布局依据。
