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
└── 02_prototype/
    └── lineagelite-lofi-prototype.html # 低保真原型（浏览器直接打开，标签页切换 6 个界面）
```

## 阅读顺序

| 顺序 | 文档 | 回答的问题 |
|---|---|---|
| 1 | [设计方案](./01_design/轻量级AI血缘工具-设计方案.md) | 为什么这么做：两大开源方案的调研结论、总体架构、技术选型、里程碑与已确认决策记录（§十） |
| 2 | [业务模型](./01_design/轻量级AI血缘工具-业务模型.md) | 业务上是什么：价值主张、角色权限、12 个领域概念、7 条业务流程、9 条业务不变量 |
| 3 | [数据模型](./01_design/轻量级AI血缘工具-数据模型.md) | 数据怎么存：10 张表逐列定义（含 M3 rollback_record）、定位器 JSON 信封、命名规则、回滚重建规则、M2/M3/M4 API 契约增量 |
| 4 | [低保真原型](./02_prototype/lineagelite-lofi-prototype.html) | 长什么样：血缘画布、源文件预览、导入向导、AI 对话、版本与用户、登录 6 个界面线框 |

## 文档与代码的对应关系

| 文档章节 | 代码落点 |
|---|---|
| 数据模型 §二 表定义 | `backend/src/lineagelite/db.py`（DDL 与文档逐表对齐，含 rollback_record） |
| 数据模型 §四 JSON 结构 | `backend/src/lineagelite/locator.py`、`manifest.py`（定位器信封 + 实文件核查） |
| 设计方案 §3.5-3.6 导入流程 | `backend/src/lineagelite/import_service.py`、`routes/imports.py` |
| 设计方案 §4.4 用户与权限 | `backend/src/lineagelite/security.py`、`routes/auth.py` |
| 数据模型 §七 版本重建 | `backend/src/lineagelite/versioning.py`（按批次/按标签回滚、标签 diff、幂等反做） |
| 数据模型 §九 M2 契约增量 | `backend/src/lineagelite/routes/datasets.py`（field_names）、`preview.py`（file/verification）、`lineage.py`（edge.id） |
| 数据模型 §九 M3 编辑与标注 | `backend/src/lineagelite/routes/annotations.py`、`routes/fields.py`、`routes/edges.py`、`routes/changes.py`、`routes/version_tags.py`、`changes.py` |
| 数据模型 §九 M4 AI 接口 | `backend/src/lineagelite/routes/ai.py`、`ai/suggest.py`、`ai/tools.py`、`ai/chat.py`、`ai/llm.py`；前端 `components/AiAssistantDrawer.tsx`、`components/EdgeDetailPanel.tsx` |
| 业务模型 §六 不变量 | 部分由数据库约束保证（边唯一部分索引），部分由服务层校验保证，均有对应测试（`backend/tests/test_m3_api.py` 等） |

## 维护约定

- 文档冲突时以「数据模型 → 设计方案 → 业务模型」的数据层优先顺序裁决，并按 AGENTS.md 规范在冲突处标 `[CONFLICT]`；
- 涉及表结构、不变量、接口语义的代码改动，必须同步更新对应文档章节；
- 原型为 2026-10-23 确认的 UI 基线（设计方案 §十 决策#6），M2 前端开发以其为布局依据。
