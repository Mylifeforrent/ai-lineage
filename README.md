# ai-lineage

轻量级 AI 数据血缘工具（工作名 LineageLite）的调研与设计文档仓库。

基于对两个开源血缘方案（OpenMetadata、DataHub）的源码调研，设计一个面向小团队的轻量级方案：**字段级血缘 + 源文件精确定位回源核查 + 版本化 + AI 辅助**。

## 文档导航

| 文档 | 内容 |
|---|---|
| [轻量级AI血缘工具-设计方案.md](./轻量级AI血缘工具-设计方案.md) | 总体技术方案：两大开源方案调研结论、导入格式规范、存储与版本管理、可视化、AI 对话、里程碑 |
| [轻量级AI血缘工具-业务模型.md](./轻量级AI血缘工具-业务模型.md) | 业务层模型：定位与价值主张、干系人与角色、核心领域概念、业务流程、业务规则与不变量 |
| [轻量级AI血缘工具-数据模型.md](./轻量级AI血缘工具-数据模型.md) | 数据层模型：ER 图、9 张表定义、派生视图、JSON 结构、标识命名规则、索引与版本重建规则 |

## 引用仓库说明

`OpenMetadata/` 与 `datahub/` 为调研所用的两个开源项目源码副本，仅本地参考，**不纳入本仓库版本管理**（见 `.gitignore`）。

## 技术栈

- 后端：Python + FastAPI + uv，SQLite 起步（预留 Postgres 升级路径）
- 前端：React + TypeScript + Vite + Tailwind + shadcn/ui + @xyflow/react
- AI：OpenAI 兼容 Chat API + function calling（密钥经 `.env` 配置，不入库）
