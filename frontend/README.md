# LineageLite 前端（正式目录）

LineageLite 的正式前端项目：字段级数据血缘核查与协作工具的 React SPA。视觉与交互以 `docs/04_hifi/00_设计总览与DesignToken.md` 及 01–06 页面文档为唯一设计事实来源；接口契约以 `docs/03_dev/05_API接口文档.md` 为准；实现说明见 `docs/03_dev/02_前端开发文档.md`。

## 与 prototype 的关系

- `prototype/frontend/` 是已按 hi-fi 规范完成视觉迁移的原型工作区；本目录以它为基线**移植**而来（配置与 `src/` 同源复制），并在移植后按 hi-fi 01–05 逐屏核对、修正少量偏差。
- 本目录相对 prototype 的增量能力：**导入向导**（hi-fi 06 全规格，`ImportWizardModal`）——源文件上传（`POST /files`）、清单导入（`POST /import`）、批次报告与报告下载，此前在 prototype 中无任何前端入口。
- 两目录当前并存；prototype 仅作为参照保留，后续功能在 `frontend/` 演进。

## 开发命令

```bash
cd frontend
npm install        # npm 唯一包管理器（禁止 pnpm / yarn）
npm run dev        # vite 开发服务器 → http://localhost:5173（proxy → 127.0.0.1:8000）
npm run build      # tsc -b && vite build（类型检查 + 构建产物 dist/）
npm run typecheck  # 仅类型检查
npm run preview    # 本地预览构建产物
```

依赖集与 prototype 冻结一致（react 19 / @xyflow/react / @dagrejs/dagre + Vite + Tailwind v3），不新增任何依赖；无 UI 组件库、无路由库、无状态管理库、无 HTTP 库（只用 fetch）、无图标库（`components/Icon.tsx` 内置 43 个 SVG 图标）。

开发前需先启动后端（见仓库根 README）；后端未启动时登录页与工作台会显示错误卡与重试入口，不会白屏。

## 目录结构

```
frontend/
├── index.html / vite.config.ts / tsconfig.json / tailwind.config.cjs / postcss.config.cjs
├── public/favicon.svg
└── src/
    ├── main.tsx / App.tsx      # 入口与会话切换（401 过期事件 → 回登录页）
    ├── index.css               # Tailwind 指令 + .field-input + React Flow 画布定制 + reduced-motion
    ├── types.ts                # 全部 API 类型（唯一类型出口）
    ├── lib/                    # api.ts（fetch 封装/ApiError/会话）、layout、format、roles 等 7 文件
    └── components/             # 23 个组件（22 个移植 + 新增 ImportWizardModal）
```

## 导入向导（本目录新增）

- 入口：TopBar「导入数据」primary 按钮，仅 editor 及以上角色渲染（「不渲染写入口」模式，真正校验在后端）。
- 四步向导：① 上传源文件（逐文件 `POST /files`，sha256 去重）→ ② 上传清单/选格式（csv 双文件 / xlsx / json，本地校验格式一致）→ ③ 校验与执行（`POST /import` 同事务完成）→ ④ 批次报告（统计四卡、拒绝行表、报告 JSON 下载）。
- 上传/提交 busy 中锁定 Esc、遮罩与关闭；有已上传文件时关闭前经 ConfirmDialog 二次确认；「完成」回调 Workspace 刷新数据集列表与子图。

## 已知差距

- 「按批次回滚」（`POST /import/batches/{id}/rollback`）仍无前端入口——hi-fi 06 明确批次行不提供回滚按钮，属后续工作项 `[TBD-FE]`；版本抽屉维持「按版本标签回滚」。
- 头部「将入库为版本 v{n+1}」预分配徽章取 `GET /import/batches` 的最大 `version_no + 1`，属提示性预测，实际版本号以 `POST /import` 响应为准；批次列表拉取失败时省略该徽章。
- 用户管理仍仅支持列表 + 新增用户（角色变更无后端接口，`[TBD-BIZ]`，与 prototype 一致）。
- 设计方案 §5.1「点击节点展开邻域」等与代码现状的差异记录，见 `docs/03_dev/02_前端开发文档.md` §9.3（本目录未改变这些取舍）。
