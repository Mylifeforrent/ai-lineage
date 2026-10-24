# 00 · 设计总览与 Design Token

> 定位：`docs/04_hifi/` 高保真设计规范的地基文档。定义 LineageLite 前端的色彩、字体、间距、动效、层级与通用组件规格，供 01–06 页面设计文档直接引用，供 `prototype/frontend/` 开发直接执行。本文所有 token 精确到「可抄进代码」：色值、字号、时长、类名组合均为最终值，页面文档与实现不得偏离；如需变更，先改本文再同步下游。
>
> 适配范围：React 19 + TypeScript + Vite + Tailwind CSS v3 + `@xyflow/react`，无 UI 组件库、组件源码内置、禁止新增依赖。仅浅色模式（白底），不做暗色。

---

## 〇、依据与来源

| 依据 | 用途 |
|---|---|
| 用户约束（最高优先级） | 白色背景 + 蓝色主色调；Data-Dense Dashboard 风格（density 8/10，克制、专业、数据可读性优先）；无障碍硬性要求（正文对比度 ≥4.5:1、可见 focus ring、prefers-reduced-motion、150–300ms 过渡） |
| ui-ux-pro-max 检索色彩基线 | Primary `#1E40AF`、Secondary `#3B82F6`、Background `#F8FAFC`、Card `#FFFFFF`、Muted `#E9EEF6`、Muted Foreground `#475569`、Border `#DBEAFE`、Destructive `#DC2626`、Accent/CTA `#D97706`、Ring `#1E40AF`（本文在基线内微调处均标注决策理由） |
| `prototype/frontend/tailwind.config.cjs`、`src/index.css` | 现有 token 结构与命名（canvas/surface/ink/line/pine/ember/ochre/ai/rosewood、boxShadow、keyframes），本文产出其完整替换版与旧→新映射（§8、§9） |
| `docs/03_dev/02_前端开发文档.md` | §一技术栈、§六组件清单（22 个）、§七画布实现（`getEdgeVisual` 四形态、节点卡片结构、handle 体系） |
| `docs/02_prototype/lineagelite-lofi-prototype.html` | 低保真 6 屏信息架构基线（血缘画布 / 源文件预览 / 导入向导 / AI 对话 / 版本与用户 / 登录） |
| 代表性组件源码 | `LoginPage.tsx`、`DatasetNode.tsx`、`TopBar.tsx`、`LineageEdge.tsx`（getEdgeVisual）、`SourceBadge.tsx`、`Icon.tsx` |
| WCAG 2.1 | 相对亮度公式人工计算，全部文字组合对比度见 §2.6 验证表 |

本文对比度均为 WCAG 相对亮度公式的计算结果（比值保留两位小数），正文文字 ≥4.5:1，大字号（≥18.66px bold 或 ≥24px）与图形/UI 组件 ≥3:1。

---

## 一、设计定位与原则

### 1.1 产品气质

LineageLite 是 **B 端内部数据工具**：数据团队每天打开它核对「数据从哪来」。界面气质是**专业数据工具**——像精密仪器，不像营销页。用户连续注视画布与表格数十分钟，视觉系统必须低噪音、高信噪比、可长时间注视不疲劳。

风格锚点：**Data-Dense Dashboard**（density 8/10）。信息密度高但井然有序：白底、细边框分层、克制的蓝色主色、无装饰性渐变与光晕、无衬线字体、紧凑控件。

### 1.2 设计原则（可执行，5 条）

1. **数据墨水优先**：屏幕像素优先分配给数据本身（血缘图、字段、定位器）。边框、阴影、图标都是分层的手段而非装饰；禁止大面积渐变、光晕、插画化装饰（现有登录页的 blur 光球装饰在高保真中删除）。
2. **白色表面 + 一层浅灰页面**：内容永远落在白卡片上，页面背景 `#F8FAFC` 只负责把卡片「衬」出来。嵌套不超过两层表面（page → card → subtle 行底）。
3. **蓝色只给交互与身份**：蓝色（blue 色阶）表达「可点击、选中、当前项、品牌」，数据内容一律中性灰墨。蓝色面积占屏幕不超过 ~10%。
4. **状态必须可分辨**：血缘来源（imported/manual/ai）、角色、成功/警告/危险，各有一组固定三档色（DEFAULT/soft/deep），不混用；soft 底上写正文一律用 deep 档。
5. **动效服务反馈，不做表演**：过渡只用于状态变化（hover、展开、弹层进场），时长 150–300ms；持续动画只保留两种语义（AI 建议边流动、骨架屏脉动），并尊重 `prefers-reduced-motion`。

### 1.3 明暗策略

**仅浅色模式**，白底。不做暗色主题、不做 `light-dark()` 分支（低保真原型中的 dark 值仅为其自演示，不进入高保真体系）。理由：单人运维的内部工具，暗色模式带来的双倍 token 维护成本远大于收益；白底是数据核对（表格、定位器、代码）的最可靠阅读环境。

---

## 二、色彩系统（Design Token 核心）

### 2.1 主色 blue（50–900）

锚点：`#1E40AF` = **blue-800**（检索基线 Primary）、`#3B82F6` = **blue-500**（检索基线 Secondary）。两者恰为 Tailwind v3 标准 blue 色阶成员，故直接采用标准 blue 色阶——与基线零偏差、与生态工具（图表库、React Flow 默认样式）视觉一致。**主按钮用 600，hover 700**；500 及以上仅作图形色（白底文字对比度不足 4.5:1，见 §2.6）。

| Token | 色值 | 用途（唯一或主用途） |
|---|---|---|
| `blue-50` | `#EFF6FF` | hover 背景、列表选中行底、info soft 底 |
| `blue-100` | `#DBEAFE` | 浅底强调：徽章边框、选中项描边、表格高亮列底 |
| `blue-200` | `#BFDBFE` | 种子节点头部边框、浅蓝描边、进度条轨道 |
| `blue-300` | `#93C5FD` | 画布装饰线、spinner 轨道（`border-blue-200` 的替代强调档） |
| `blue-400` | `#60A5FA` | 图形次级：图标 hover、次要图形点缀（不做文字） |
| `blue-500` | `#3B82F6` | **Secondary 锚点**。图形主色：focus ring、节点选中描边、链接下划线装饰（白底文字仅 ≥3:1，禁止正文） |
| `blue-600` | `#2563EB` | **主交互**：主按钮 default、链接文字、边 hover、active 描边 |
| `blue-700` | `#1D4ED8` | 主按钮 hover、深图形强调 |
| `blue-800` | `#1E40AF` | **Primary 锚点**。品牌深蓝：徽章深字、深底色块、`ring` 色（基线 Ring 同值） |
| `blue-900` | `#1E3A8A` | 登录页左侧深色面板底、最大对比标题文字 |

### 2.2 中性色：表面与文字

表面三层（自下而上）+ 文字四档 + 边框三档，全部采用 slate 系（与 `#F8FAFC`/`#475569` 基线同族）。

**表面**

| Token | 色值 | 用途 |
|---|---|---|
| `page` | `#F8FAFC` | 页面背景、画布背景（基线 Background，slate-50） |
| `card` | `#FFFFFF` | 卡片、面板、模态、抽屉、节点卡片（基线 Card，纯白） |
| `subtle` | `#F1F5F9` | 次级表面：表头行、代码块底、hover 行底、骨架屏（slate-100） |

> 基线 Muted `#E9EEF6` 微调为 `#F1F5F9`（slate-100）：与其余中性色保持同一 slate 族，避免第三种灰调；视觉差异可忽略。

**文字（ink 四档，命名与现有结构一致）**

| Token | 色值 | 用途 | on card 对比度 | on page |
|---|---|---|---|---|
| `ink` | `#0F172A` | 主文字：标题、表格主内容、节点标题（slate-900） | 17.9:1 | 17.1:1 |
| `ink-soft` | `#334155` | 次级文字：正文段落、表单值、菜单项（slate-700） | 10.4:1 | 9.9:1 |
| `ink-muted` | `#475569` | 辅助文字：说明、表头、元信息（= 基线 Muted Foreground，slate-600） | 7.6:1 | 7.2:1 |
| `ink-faint` | `#64748B` | 占位符、禁用辅助、时间戳、`kbd`（slate-500） | 4.76:1 | 4.55:1 |

硬性规则：`ink-faint` 在 `subtle`(#F1F5F9) 底上为 4.34:1 **不达标**——subtle 底上的正文最低用 `ink-muted`；`ink-faint` 只用于白/页面底，或作为 placeholder（非必要信息）。

**边框（line 三档）**

| Token | 色值 | 用途 |
|---|---|---|
| `line` | `#E2E8F0` | 默认边框：卡片、输入框静止态、分隔强调（slate-200） |
| `line-strong` | `#CBD5E1` | 强边框：输入框/卡片 hover、表格外框、滚动条（slate-300） |
| `line-soft` | `#F1F5F9` | 弱分隔：卡片内行分隔、分区线（= subtle 同值，保留独立命名便于语义替换） |

> 基线 Border `#DBEAFE`（blue-100）微调为 slate-200 作默认边框：`#DBEAFE` 对白底仅 1.22:1，作为全局边框过浅且会让界面整体过蓝；`#DBEAFE` 保留在 blue-100 档位，用于「蓝色语义」的浅描边（徽章、选中描边）。

### 2.3 语义色（每组 DEFAULT / soft / deep 三档）

对齐现有 ember/ochre/ai 的三档结构。**用法规则：soft 档做底、deep 档做 soft 底上的正文与图标、DEFAULT 做白底上的图标/文字与实心按钮底**。warning 与 danger 的 DEFAULT 在各自 soft 底上不足 4.5:1，故 soft 底上一律用 deep（见 §2.6）。

| 语义 | DEFAULT | soft | deep | 场景 |
|---|---|---|---|---|
| `success` | `#15803D` | `#F0FDF4` | `#166534` | 成功 toast、已确认状态、校验通过（green-600/50/800） |
| `warning` | `#D97706` | `#FFFBEB` | `#B45309` | 置信度低、登录过期提示、人工血缘边（= 基线 Accent/CTA，amber-600/50/700） |
| `danger` | `#DC2626` | `#FEF2F2` | `#B91C1C` | 错误、删除确认、定位失效（= 基线 Destructive，red-600/50/700） |
| `info` | `#2563EB` | `#EFF6FF` | `#1E40AF` | 常规提示、导入批次状态（= blue-600/50/800） |

### 2.4 功能色：AI 徽标色与血缘边来源色

**AI 色（`ai` 三档，独立于主蓝）**

| Token | 色值 | 用途 |
|---|---|---|
| `ai` | `#4F46E5` | AI 标识色：AI 建议边、sparkles 图标、AI 徽章点（indigo-600） |
| `ai-soft` | `#EEF2FF` | AI 徽章底、AI 相关面板浅底（indigo-50） |
| `ai-deep` | `#3730A3` | AI 徽章文字、soft 底上的 AI 相关正文（indigo-800） |

> 决策：**不与主蓝共用**。旧值 `#2F64D8` 与新主蓝 `#2563EB` 亮度几乎相同、并排不可分辨；而「AI 建议 = 未确认」是本产品最关键的状态语义，虚线+流动动画之外需要色彩冗余编码。选定靛蓝（indigo）家族：与主蓝拉开可辨差异，又属蓝紫冷调，不破坏「蓝色主色调」的整体印象（AI 色仅小面积点缀）。对比度：`#4F46E5` on white 6.29:1、on `#EEF2FF` 5.62:1，均可作正文。

**血缘边来源色（`lineage` 组，对齐 `LineageEdge.tsx` 的 `getEdgeVisual` 四形态）**

边色直接进 SVG `stroke`，定义为 `lineage` 色组供 `getEdgeVisual` 常量引用（避免 hex 散落）。四种形态保持现有线型/线宽不变，仅替换色值：

| 形态（getEdgeVisual 分支） | 旧色 | 新 Token / 色值 | 线型 | 宽度 | on page 对比度（图形 ≥3:1） |
|---|---|---|---|---|---|
| `source='ai'`（AI 建议） | `#2f64d8` | `lineage-ai` = `#4F46E5` | 虚线 `6 5` | 1.8 | 6.0:1 ✓（保留 `animated` 流动） |
| `source='manual'`（人工确认） | `#a36b11` | `lineage-manual` = `#D97706` | 字段级实线；表级虚线 `4 5` | 1.7 | 3.05:1 ✓ |
| imported 字段级 | `#52645c` | `lineage-imported` = `#475569` | 实线 | 1.55 | 7.2:1 ✓ |
| imported 表级 | `#8b958f` | `lineage-imported-weak` = `#64748B` | 虚线 `4 5` | 1.4 | 4.55:1 ✓ |
| 同名字段匹配（derived，视图派生） | —（新增） | `lineage-derived` = `#94A3B8` | 点状虚线 `2 4` | 1.3 | 2.46:1 ✗（见下方注 2） |
| 字段追踪高亮（focusState='chain'） | —（新增） | `lineage-focus` = `#DC2626` | 沿用原形态线型 | 2.6 | 4.64:1 ✓（`animated` 流动） |

> imported 表级旧色 `#8b958f` 对 `#F8FAFC` 仅 2.45:1（低于图形 3:1），改用 `#64748B`，靠「虚线 + 更细」保持弱于字段级边。
>
> 注 2：`lineage-derived` 为「表级血缘两端同名字段匹配」的**视图派生辅助线**（不落库、不可选中），刻意弱于全部库内边。2.46:1 低于图形 3:1 属**已知取舍**：同名匹配关系可由两端字段名、tooltip 文本与图例完整读出，线体不承载唯一信息（WCAG 1.4.11 适用于「理解内容所必需」的图形）。若评审要求达标，需在本表增设更深一档色值后再改 `lib/edgeColors.ts`【TBD-UX，确认阶段处理】。`lineage-focus` 与 danger 语义色同值（追踪 = 临时强调，非错误语义），通过红色 + 流动动画与 danger 静态用法区分。

### 2.5 图谱画布专用

| 元素 | 规格 |
|---|---|
| 画布背景 | `bg-page`（`#F8FAFC`）+ 点阵网格：`backgroundImage: radial-gradient(circle, rgba(148,163,184,0.35) 1px, transparent 1px)`，`backgroundSize: 24px 24px`（token：`bg-dot-grid bg-grid-24`；替代旧方格线 `fine-grid`——点阵比线格更轻，Data-Dense 画布噪音更低） |
| 节点卡片 | `bg-card` + `border-line-strong`（hover 收敛为 `shadow-card`）；宽 288px、圆角 `rounded-xl`(12px) 不变（`lib/layout.ts` 常量不动） |
| 种子节点 | 顶部 2px 强调条 `bg-blue-600/80`；头部底 `bg-blue-50`、头部边框 `border-blue-200`；「种子」徽章 `text-blue-800`；`shadow-node-active` |
| 节点选中 | `shadow-node-active`（1.5px blue-600 外圈 + 深蓝投影，见 §4.4）；键盘 focus 用 2px `blue-600/65` outline + offset 3px |
| 节点头部（非种子） | 底 `bg-subtle`、下边框 `border-line-soft` |
| 字段行 | hover 底 `bg-blue-50/70`，字段名 hover 变 `text-blue-800` |
| 表级 handle | 9px 方形（r2）：白底 + `border-line-strong`，hover `border-blue-700 bg-blue-100` + blue ring |
| 字段级 handle | 7px 圆点：白底 + `border-line-strong`、opacity 0.55；节点 hover / 自身 hover 时 `border-blue-600 bg-blue-50` opacity 1 |
| Controls / MiniMap | 白底、`border-line`、`rounded-lg`、`shadow-float`；按钮 hover `bg-page text-blue-700` |
| 边 tooltip 卡 | 白底、`border-line`、`rounded-lg`、`shadow-float`（替代原 React Flow 默认样式） |

### 2.6 对比度验证表（WCAG 2.1 计算）

**正文级（要求 ≥4.5:1）**

| 前景 | 背景 | 比值 | 结论 |
|---|---|---|---|
| `ink` #0F172A | card #FFFFFF | 17.90 | ✓ |
| `ink` | page #F8FAFC | 17.06 | ✓ |
| `ink-soft` #334155 | #FFFFFF | 10.36 | ✓ |
| `ink-soft` | #F8FAFC | 9.90 | ✓ |
| `ink-muted` #475569 | #FFFFFF | 7.58 | ✓ |
| `ink-muted` | #F8FAFC | 7.24 | ✓ |
| `ink-muted` | subtle #F1F5F9 | 6.92 | ✓ |
| `ink-faint` #64748B | #FFFFFF | 4.76 | ✓ |
| `ink-faint` | #F8FAFC | 4.55 | ✓（最低限，只用于占位/元信息） |
| `ink-faint` | subtle #F1F5F9 | 4.34 | ✗ 禁止该组合，subtle 底改用 ink-muted |
| blue-600 #2563EB（链接文字） | #FFFFFF | 5.17 | ✓ |
| blue-700 #1D4ED8 | #FFFFFF | 6.70 | ✓ |
| blue-800 #1E40AF | #FFFFFF | 8.72 | ✓ |
| blue-800 | blue-50 #EFF6FF | 8.01 | ✓（徽章/选中行） |
| white | blue-600（主按钮） | 5.17 | ✓ |
| white | blue-700（主按钮 hover） | 6.70 | ✓ |
| white | blue-800 | 8.72 | ✓ |
| white | danger #DC2626（危险按钮） | 4.83 | ✓ |
| success #15803D | #FFFFFF | 5.02 | ✓ |
| ai #4F46E5 | #FFFFFF | 6.29 | ✓ |

**soft 底徽章/提示条（deep 档正文，要求 ≥4.5:1）**

| 前景 | 背景 | 比值 | 结论 |
|---|---|---|---|
| success-deep #166534 | success-soft #F0FDF4 | 6.81 | ✓ |
| warning-deep #B45309 | warning-soft #FFFBEB | 4.84 | ✓ |
| danger-deep #B91C1C | danger-soft #FEF2F2 | 5.91 | ✓ |
| info-deep #1E40AF | info-soft #EFF6FF | 8.01 | ✓ |
| ai-deep #3730A3 | ai-soft #EEF2FF | 8.88 | ✓ |
| warning #D97706 | warning-soft #FFFBEB | 3.07 | ✗ 禁止（故规则定为 soft 底用 deep） |
| danger #DC2626 | danger-soft #FEF2F2 | 4.41 | ✗ 禁止（同上） |

**图形 / UI 组件（要求 ≥3:1）**

| 图形 | 背景 | 比值 | 结论 |
|---|---|---|---|
| lineage-imported #475569 | #F8FAFC | 7.24 | ✓ |
| lineage-imported-weak #64748B | #F8FAFC | 4.55 | ✓ |
| lineage-manual #D97706 | #F8FAFC | 3.05 | ✓（1.7px 线，达标下限） |
| lineage-ai #4F46E5 | #F8FAFC | 6.01 | ✓ |
| lineage-focus #DC2626 | #F8FAFC | 4.64 | ✓（2.6px 线 + 流动动画） |
| lineage-derived #94A3B8 | #F8FAFC | 2.46 | ✗ 已知取舍：视图派生辅助线，信息由字段名/tooltip/图例冗余承载（§2.4 注 2） |
| blue-500 #3B82F6（ring/选中描边） | #FFFFFF | 3.68 | ✓ 图形；✗ 不得作白底文字 |
| input 边框 line #E2E8F0 | #FFFFFF | 1.23 | 已知权衡：静止态输入框辨识依赖 placeholder 与形状（业界通行，GitHub/Linear 同类）；focus 态边框 blue-600 达 5.17:1。无障碍检查单如实登记（§10） |

> 禁用态（disabled）元素 WCAG 不要求对比度，统一 `opacity-50` 或中性灰（见 §7.1）。

---

## 三、字体系统

### 3.1 字族（2 族，收敛自 3 族）

| Token | 字栈 | 用途 |
|---|---|---|
| `font-sans` | `'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif` | 全部界面文字（中英文混排、标题、按钮） |
| `font-mono` | `'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace` | 数据集 id、字段名、定位器、代码/JSON、数字统计（配 `tabular-nums`）、`kbd` |

> **决策：移除衬线 display 字族**（Newsreader / Noto Serif SC / Songti SC）。理由：(1) Data-Dense Dashboard 要求克制、无装饰，衬线的编辑/文学气质与「专业数据工具」定位冲突；(2) 全无衬线使登录页大标题与工作台气质连续，避免「营销页 → 工具页」的割裂；(3) 少加载一个 Google Fonts 字族（Newsreader + Noto Serif SC 约 100KB+），内网工具加载更快。原 `font-display` 场景（登录页大标题）改用 `font-sans` + 24–28px + `font-semibold` + `tracking-tight`。Google Fonts `@import` 同步删去两族（§8.2）。

中文以 Noto Sans SC 为主（400/500/600/700 四字重，加载即用）；等宽一律 IBM Plex Mono（400/500/600）。**禁止**再引入字族。

### 3.2 字号阶（8 档，收敛碎片值）

现有代码字号碎片严重（7.5–55px 共 15+ 个值），统一收敛为以下 8 档 + 写法约定。Tailwind 默认档用默认类，非默认档用任意值写法：

| 档 | 写法 | 用途 | 行高 |
|---|---|---|---|
| 11 | `text-[11px]` | 徽章、节点 id、`kbd`、mono 元信息 | `leading-4` (16px) |
| 12 | `text-xs` | 次要正文、表格单元、侧栏条目、label | `leading-4`/`leading-[18px]` |
| 13 | `text-[13px]` | **默认控件字号**：按钮、输入框、菜单项、正文（density 8 的正文锚点） | `leading-5` (20px) |
| 14 | `text-sm` | 强调正文、表单说明、tooltip 正文 | `leading-5` |
| 16 | `text-base` | 卡片标题、区块标题（h2/h3） | `leading-6` (24px) |
| 18 | `text-lg` | 模态/抽屉标题、统计数字 | `leading-6` |
| 20 | `text-xl` | 登录页副标题、空态主文案 | `leading-7` |
| 24 | `text-2xl` | 登录页主标题（可加 `tracking-tight`） | `leading-8` (32px) |
| 28（特例） | `text-[28px]` | 仅登录页左栏主标语一处 | `leading-[1.25]` |

规则：节点卡片内字段名统一 `text-[11px] font-mono`（旧 10.5px/8.5px 收敛到 11px/12px 档）；**禁止出现档外字号**（页面文档不得发明 15px、22px 等）。

### 3.3 字重规则

| 字重 | 场景 |
|---|---|
| 400 | 正文、表格内容、说明文字（默认，不写 `font-normal`） |
| 500 | 按钮、菜单项、表单 label、徽章文字、节点标题、表头 |
| 600 | 区块/卡片标题、模态与抽屉标题、页面 h1（小字号标题靠 600 立起来） |
| 700 | 仅两处：登录页主标语、大号统计数字（18px+）。小字号禁止 700（发虚） |

### 3.4 排版细则

- 数字（统计、置信度、计数）一律 `font-mono tabular-nums`，保证列表对齐。
- 定位器、字段名、数据集 id 一律 `font-mono`；中文说明混排时 mono 只包住代码部分。
- `tracking-tight`（-0.025em）仅用于 ≥20px 标题；正文与 mono 不加字距。
- 长 id / 定位器用 `truncate` + `title` 提示，不换行撑破卡片。

---

## 四、间距、圆角、边框、阴影与尺寸

### 4.1 间距（4px 节奏）

Tailwind 默认 spacing 刻度即 4px 节奏，不扩展。约定：

| 间距 | 写法 | 场景 |
|---|---|---|
| 4 / 8 | `p-1`/`p-2`, `gap-1`/`gap-2` | 控件内部（图标与文字、徽章内边距） |
| 12 | `p-3`, `gap-3` | 控件之间、列表行距、卡片内边距（紧凑） |
| 16 | `p-4`, `gap-4` | 卡片标准内边距、区块之间 |
| 20 / 24 | `p-5`/`p-6` | 页面级留白、登录页内边距 |
| 32 | `p-8` | 大区块分隔（少用） |

### 4.2 圆角（Tailwind 默认刻度，不重定义）

| Token | 值 | 场景 |
|---|---|---|
| `rounded` | 4px | 徽章内元素、`kbd`、chip 内点 |
| `rounded-md` | 6px | 输入框、chip、小按钮、代码片段底 |
| `rounded-lg` | 8px | 按钮、下拉菜单、toast、tooltip、Controls/MiniMap |
| `rounded-xl` | 12px | 卡片、节点卡片、模态、抽屉（旧节点 14px 收敛到 12px） |
| `rounded-2xl` | 16px | 登录页大卡片 |
| `rounded-full` | — | 徽章、头像、圆点 handle |

### 4.3 边框宽度

- 默认 `border`（1px）：卡片、输入框、表格。
- 选中/强调描边 1.5px：仅画布节点（SVG/box-shadow 实现，见 `shadow-node-active`）。
- 2px：focus ring（`ring-2`，见 §7 通用 focus 规格）。
- 禁止 2px+ 的装饰性粗边框。

### 4.4 阴影（5 档，key 名保留 + 新增 modal）

全部为**蓝色系冷灰投影**（rgba 基于 slate-900 #0F172A / blue-800 #1E40AF），替换旧墨绿投影：

| Token | 值 | 用途 |
|---|---|---|
| `shadow-card` | `0 1px 2px rgba(15, 23, 42, 0.05), 0 2px 8px -4px rgba(15, 23, 42, 0.08)` | 静止卡片、节点 hover |
| `shadow-node` | `0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 12px -6px rgba(15, 23, 42, 0.10)` | 画布节点默认 |
| `shadow-node-active` | `0 0 0 1.5px rgba(37, 99, 235, 0.55), 0 8px 24px -12px rgba(30, 64, 175, 0.35)` | 节点选中/种子（自带 blue-600 外圈） |
| `shadow-float` | `0 2px 6px rgba(15, 23, 42, 0.06), 0 12px 32px -12px rgba(15, 23, 42, 0.18)` | 下拉菜单、tooltip、toast、抽屉、Controls/MiniMap |
| `shadow-modal` | `0 8px 24px rgba(15, 23, 42, 0.12), 0 24px 64px -16px rgba(15, 23, 42, 0.25)` | 模态框（新增强调层级） |

### 4.5 控件高度与关键尺寸（density 8 紧凑值）

| 控件 | 尺寸 |
|---|---|
| 按钮 sm / md | 28px（`h-7`，画布内、表格行内）/ 32px（`h-8`，默认） |
| 按钮 lg（登录提交、向导主操作） | 36px（`h-9`） |
| 输入框 | 32px（`h-8`，画布/筛选紧凑）/ 36px（`h-9`，表单默认，`.field-input` 默认高度） |
| 顶栏 TopBar | 56px（`h-14`；现 68px 收紧） |
| 侧栏 DatasetSidebar 宽 | 240px（现 ~220 收敛统一） |
| 右侧详情面板宽 | 320px |
| 右侧抽屉 | 360px（字段/变更历史）/ 480px（AI 对话、版本）两档 |
| 模态 | sm 400 / md 560 / lg 720 / xl 880px 四档（`max-w-*` + 居中） |
| 节点卡片 | 宽 288px 固定（`lib/layout.ts` 常量，不改）；头部 56px、字段行 34px 不变 |
| 图标按钮热区 | ≥24px（`h-6 w-6` 最小） |

---

## 五、动效 Token

### 5.1 时长与缓动

| 档 | 值 | 场景 |
|---|---|---|
| `duration-150` | 150ms | hover/active 颜色、边框、图标位移（`transition-colors` 默认时长） |
| `duration-200` | 200ms | 下拉菜单、toast 进出、抽屉滑入、输入框 focus |
| `duration-300` | 300ms | 模态进场、面板展开、列表项 fade-up（300ms 上限满足约束） |

缓动：进场/位移统一 `out-quint` = `cubic-bezier(0.22, 1, 0.36, 1)`（保留现有值，Tailwind 扩展 `transitionTimingFunction['out-quint']`，类 `ease-out-quint`）；纯颜色过渡用默认 `ease-out`。禁止 `ease-in`（进场显得迟滞）。

### 5.2 keyframes 决策（4 个全保留，时长收敛）

| Keyframe | 旧 | 新 | 决策理由 |
|---|---|---|---|
| `fade-up` | 420ms | **300ms** `out-quint` | 列表/面板进场；420ms 超出 300ms 上限且偏慢 |
| `fade-in` | 260ms | **200ms** `ease-out` | 下拉/菜单/遮罩淡入 |
| `modal-in` | 260ms | **250ms** `out-quint` | 模态进场（上移 14px + scale 0.985 保留） |
| `soft-pulse` | 1.8s infinite | **保留 1.8s** | 仅两处：AI 建议边流动语义的辅助、骨架屏脉动。持续动画受 `prefers-reduced-motion` 全局关闭（index.css 已有规则，保留） |

`index.css` 内的 `dataset-card-in`（360ms）收敛为 250ms `out-quint`，逻辑不变。

---

## 六、z-index 层级表

不扩展 `theme.zIndex`，统一用 Tailwind 默认档 + 任意值。**全局分层（低→高）**：

| 层 | z 值 | 内容 |
|---|---|---|
| 画布内容 | 0（React Flow 内部） | 节点、边、handle（种子节点由 React Flow `zIndex` 抬升，不用全局档） |
| 画布浮层 | `z-20` | Controls、MiniMap、边 tooltip（`.react-flow__panel` 现值 20，保留）、`EdgeLabelRenderer` 层 |
| 顶栏 | `z-30` | TopBar（sticky，现值保留） |
| 抽屉 | 遮罩 `z-40` / 面板 `z-[41]` | 右侧抽屉（HistoryDrawer/VersionDrawer/AiAssistantDrawer） |
| 模态 | 遮罩 `z-50` / 面板 `z-[51]` | PreviewModal、EdgeCreateModal、UserManagementModal、ConfirmDialog（模态可叠于抽屉之上） |
| Toast | `z-[60]` | 全局提示（最高，任何状态可见） |

规则：组件不得使用档外 z 值；弹层永远「遮罩低一层、面板高一档」，保证遮罩不盖自家面板。

---

## 七、通用组件规格（横切，页面文档按此引用）

### 7.1 按钮（4 变体 × 5 状态）

统一骨架：`inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors duration-150` + 变体类 + 尺寸（默认 `h-8 px-3`）。**统一 focus 规格（全部交互元素）**：`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white`；深蓝底（blue-800+）上改 `ring-white/60`。

| 变体 | default | hover | active | disabled | focus |
|---|---|---|---|---|---|
| **primary** `btn-primary` | `bg-blue-600 text-white` | `hover:bg-blue-700` | `active:bg-blue-800` | `disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed`（中性化，不用半透明蓝） | 统一 focus |
| **secondary** | `border border-line-strong bg-card text-ink-soft` | `hover:border-blue-400 hover:text-blue-700` | `active:bg-blue-50` | `disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-line-strong` | 统一 focus |
| **ghost** | `text-ink-muted`（无边框无底） | `hover:bg-subtle hover:text-ink` | `active:bg-line` | 同 secondary | 统一 focus |
| **danger** | `bg-danger text-white` | `hover:bg-danger-deep` | `active:bg-danger-deep` | 同 primary 的 disabled | 统一 focus |

完整示例（primary，可直接抄）：

```html
class="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
```

danger ghost 变体（列表内删除入口）：`border border-danger/25 bg-danger-soft text-danger-deep hover:border-danger/45`。带图标按钮：图标 14px，与文字同色；仅图标按钮热区 ≥24×24 + `aria-label`。

### 7.2 输入框与 label 布局

`.field-input` 组件类保留在 `index.css`（更新为蓝系，§8.2），默认 `h-9`；紧凑场景加 `h-8`。

- label：`mb-1.5 block text-[12px] font-medium text-ink-soft`（`htmlFor` 必填；搜索类用 `sr-only`）。
- 输入框内状态（由组件类实现）：静止 `border-line bg-card/60` → hover `border-line-strong` → focus `border-blue-600 bg-card + ring-2 ring-blue-600/15`；placeholder `text-ink-faint`；disabled `opacity-50 cursor-not-allowed`。
- 左图标输入框（搜索）：图标 `absolute left-3 text-ink-faint`，focus-within 时变 `text-blue-600`；输入框 `pl-9`。

### 7.3 下拉选择

- 原生 select（侧栏过滤器等）：`.field-input h-8 pr-8 appearance-none` + 右侧 chevron 图标 14px。
- 自定义菜单（用户菜单、角色选择）：容器 `rounded-lg border border-line bg-card py-1 shadow-float animate-fade-in`（z 按层级表）；菜单项 `flex h-8 items-center gap-2 px-3 text-[13px] text-ink-soft hover:bg-subtle focus-visible:bg-subtle`；当前项 `bg-blue-50 text-blue-800 font-medium`；分组标题 `px-3 py-1.5 text-[11px] text-ink-faint`；分隔线 `my-1 border-t border-line-soft`。

### 7.4 徽章（badge）

骨架：`inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] leading-none`（带前置圆点时 `gap-1.5` + `h-1.5 w-1.5 rounded-full`）。

**来源徽章（SourceBadge，source 三值 + 未知兜底）**

| source | 类组合 | 圆点 |
|---|---|---|
| imported（文件导入） | `border-blue-200 bg-blue-50 text-blue-800` | `bg-blue-600` |
| manual（人工确认） | `border-warning/25 bg-warning-soft text-warning-deep` | `bg-warning` |
| ai（AI 建议） | `border-ai/25 bg-ai-soft text-ai-deep` | `bg-ai` |
| 未知兜底 | `border-line bg-card/70 text-ink-muted` | `bg-ink-faint` |

**角色徽章（admin/editor/viewer）**

| 角色 | 类组合 |
|---|---|
| admin（管理员） | `border-transparent bg-blue-800 text-white` |
| editor（编辑） | `border-blue-200 bg-blue-50 text-blue-800` |
| viewer（只读） | `border-line bg-subtle text-ink-muted` |

**状态徽章**（导入批次状态、版本状态）复用语义色：成功 `bg-success-soft text-success-deep`、失败 `bg-danger-soft text-danger-deep`、进行中 `bg-info-soft text-info-deep`、待确认 `bg-warning-soft text-warning-deep`（均 `border-transparent`）。

### 7.5 标签 chip

过滤条件、AI 工具名、定位器锚点：`inline-flex h-6 items-center gap-1 rounded-md border border-line bg-card px-2 font-mono text-[11px] text-ink-muted`；可删除 chip 尾接 `h-4 w-4` close 图标按钮（`hover:bg-subtle`）；激活 chip `border-blue-300 bg-blue-50 text-blue-800`。

### 7.6 模态框

- 遮罩：`fixed inset-0 z-50 bg-slate-900/40 animate-fade-in`（点击关闭，ConfirmDialog 等危险操作保留现有遮罩不关的规则则去掉 onClick）。
- 面板：`relative z-[51] mx-auto w-full rounded-xl border border-line bg-card shadow-modal animate-modal-in` + 尺寸档（sm `max-w-[400px]` / md `max-w-[560px]` / lg `max-w-[720px]` / xl `max-w-[880px]`），`max-h-[85vh] flex flex-col`。
- 结构：头 `flex h-12 shrink-0 items-center justify-between border-b border-line-soft px-4`（标题 `text-[14px] font-semibold text-ink` + 关闭图标按钮）；身 `flex-1 overflow-y-auto px-4 py-4`；脚 `flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line-soft px-4`（主操作在右，次操作在左或主操作左侧）。
- 行为：Esc 关闭、打开时焦点移入、关闭后焦点还原（ConfirmDialog 现有行为保持）。

### 7.7 右侧抽屉

- 遮罩：`fixed inset-0 z-40 bg-slate-900/25 animate-fade-in`。
- 面板：`fixed right-0 top-0 z-[41] h-full bg-card border-l border-line shadow-float flex flex-col`，宽度档 `w-[360px]`（详情/历史）/ `w-[480px]`（AI 对话/版本），滑入 200ms `out-quint`（transform translateX）。
- 结构：头 `flex h-12 items-center justify-between border-b border-line-soft px-4`（标题 `text-[14px] font-semibold` + 关闭按钮）；身 `flex-1 overflow-y-auto`；AI 对话底部输入区 `border-t border-line-soft p-3`。
- Esc 关闭；抽屉内可再开模态（层级表保证）。

### 7.8 Toast

`fixed right-4 bottom-4 z-[60] flex h-10 items-center gap-2 rounded-lg border px-3.5 text-[13px] shadow-float animate-fade-up`；三态：success `border-success/25 bg-success-soft text-success-deep`、error `border-danger/25 bg-danger-soft text-danger-deep`、info `border-blue-200 bg-blue-50 text-blue-800`；左侧状态图标 14px 与文字同色；自动消失 4.2s（现值保留）；`role="alert"/"status"` 保留。

### 7.9 空态

居中列布局：图标 24px `text-ink-faint` → 主文案 `text-[13px] font-medium text-ink-soft` → 说明 `text-xs text-ink-muted` → （可选）secondary 按钮。容器 `flex flex-col items-center justify-center gap-2 py-12`。

### 7.10 加载态

- Spinner：`h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600`（小号 `h-3.5 w-3.5 border-[1.5px]`，深色底上 `border-white/40 border-t-white`）。
- 骨架屏：`animate-soft-pulse rounded-md bg-subtle`（数据集列表加载，替代现有实现）。
- 顶栏子图加载小 spinner：`h-2.5 w-2.5 border-[1.5px] border-blue-300 border-t-blue-700`。

### 7.11 图标规范

- `Icon.tsx` 内置 42 个 SVG 图标体系**原样保留**（不引入图标库）；`stroke-width` 统一 **1.5**（lucide 风格，现有实现一致）。
- 尺寸三档：12（行内微图标）/ 14（按钮、菜单、徽章，默认）/ 16（工具栏、空态）。装饰性图标 `aria-hidden`，语义图标保留现有 `aria-label` 约定。
- 颜色一律 `currentColor`（继承文字色）；禁止给图标单独上色档外值。

---

## 八、Tailwind 配置目标代码与 index.css 关键段

### 8.1 完整 `tailwind.config.cjs`（theme.extend 可粘贴版）

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* 表面 */
        page: '#F8FAFC',      // 页面/画布背景（slate-50）
        card: '#FFFFFF',      // 卡片/面板/模态表面
        subtle: '#F1F5F9',    // 次级表面：表头、代码底、hover 行（slate-100）
        /* 文字 */
        ink: {
          DEFAULT: '#0F172A', // 主文字（slate-900）
          soft: '#334155',    // 次级文字（slate-700）
          muted: '#475569',   // 辅助文字（slate-600）
          faint: '#64748B',   // 占位/禁用辅助（slate-500）
        },
        /* 边框 */
        line: {
          DEFAULT: '#E2E8F0', // 默认边框（slate-200）
          strong: '#CBD5E1',  // 强边框/hover（slate-300）
          soft: '#F1F5F9',    // 弱分隔（= subtle）
        },
        /* 主色（锚点：800=#1E40AF，500=#3B82F6） */
        blue: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        /* 语义色（DEFAULT=图标/白底文字/实心底，soft=浅底，deep=soft 底正文） */
        success: { DEFAULT: '#15803D', soft: '#F0FDF4', deep: '#166534' },
        warning: { DEFAULT: '#D97706', soft: '#FFFBEB', deep: '#B45309' },
        danger: { DEFAULT: '#DC2626', soft: '#FEF2F2', deep: '#B91C1C' },
        info: { DEFAULT: '#2563EB', soft: '#EFF6FF', deep: '#1E40AF' },
        /* AI 功能色（indigo，与主蓝区分；soft 底正文用 deep） */
        ai: { DEFAULT: '#4F46E5', soft: '#EEF2FF', deep: '#3730A3' },
        /* 血缘边来源色（getEdgeVisual 形态专用，SVG stroke） */
        lineage: {
          imported: '#475569',        // imported 字段级（实线 1.55）
          'imported-weak': '#64748B', // imported 表级（虚线 1.4）
          manual: '#D97706',          // 人工确认
          ai: '#4F46E5',              // AI 建议（虚线+流动）
          derived: '#94A3B8',         // 视图派生：表级血缘同名字段匹配推断线（点状 2 4）
          focus: '#DC2626',           // 字段追踪高亮（= danger，流动）
        },
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.05), 0 2px 8px -4px rgba(15, 23, 42, 0.08)',
        node: '0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 12px -6px rgba(15, 23, 42, 0.10)',
        'node-active':
          '0 0 0 1.5px rgba(37, 99, 235, 0.55), 0 8px 24px -12px rgba(30, 64, 175, 0.35)',
        float: '0 2px 6px rgba(15, 23, 42, 0.06), 0 12px 32px -12px rgba(15, 23, 42, 0.18)',
        modal: '0 8px 24px rgba(15, 23, 42, 0.12), 0 24px 64px -16px rgba(15, 23, 42, 0.25)',
      },
      backgroundImage: {
        'dot-grid':
          'radial-gradient(circle, rgba(148, 163, 184, 0.35) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-24': '24px 24px',
      },
      transitionTimingFunction: {
        'out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      opacity: {
        15: '0.15', 35: '0.35', 45: '0.45', 55: '0.55', 65: '0.65', 85: '0.85', 92: '0.92', 98: '0.98',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'modal-in': {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.985)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'soft-pulse': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '0.85' },
        },
      },
      animation: {
        'fade-up': 'fade-up 300ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 200ms ease-out both',
        'modal-in': 'modal-in 250ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'soft-pulse': 'soft-pulse 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
```

### 8.2 `src/index.css` 需要修改的关键段

**(1) 字体 @import（删除两个衬线字族）**

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;600;700&display=swap');
```

**(2) body 基础样式（base 层）**

```css
body {
  @apply bg-page font-sans text-ink antialiased;
  margin: 0;
  font-feature-settings: 'kern' 1;
  text-rendering: optimizeLegibility;
}
```

**(3) 选区色与滚动条（蓝系替换）**

```css
::selection {
  background: #dbeafe;  /* blue-100 */
  color: #1e3a8a;       /* blue-900 */
}

* {
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;  /* line-strong */
}
/* ::-webkit-scrollbar-thumb 背景 #cbd5e1，hover #94a3b8，其余规则（7px/圆角）不变 */
```

**(4) `.field-input`（组件层，蓝系 focus）**

```css
.field-input {
  @apply w-full rounded-md border border-line bg-card/60 px-3 text-[13px] text-ink outline-none transition-all duration-150 placeholder:text-ink-faint;
  height: 36px; /* 紧凑场景由页面加 h-8 覆盖 */
}
.field-input:hover:not(:disabled) { border-color: #cbd5e1; }
.field-input:focus {
  border-color: #2563eb;   /* blue-600 */
  background: #ffffff;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}
.field-input:disabled { cursor: not-allowed; opacity: 0.5; }
```

（旧版 `rounded-xl` 收敛为 `rounded-md`，与 §7.2 一致；阴影从 3px ring 收敛为 2px。）

**(5) React Flow 画布段（`.lineage-flow` 及以下）**——结构保留、色值替换：

- `.lineage-flow` 背景：删去米色径向渐变，改 `background: #f8fafc;` + 点阵由容器类 `bg-dot-grid bg-grid-24` 提供（画布组件上加类）。
- `.react-flow__node-dataset.selected .dataset-card`：选中阴影改 `0 0 0 1.5px rgba(37,99,235,.55), 0 8px 24px -12px rgba(30,64,175,.35)`（= `shadow-node-active`）。
- `.dataset-card` 进场动画 `dataset-card-in` 时长 360ms→250ms。
- `.react-flow__node-dataset:focus-visible .dataset-card`：outline 改 `2px solid rgba(37, 99, 235, 0.65)`。
- `.table-handle`：边框 `#cbd5e1`、底 `#ffffff`、外圈 `0 0 0 2px rgba(248,250,252,.9)`；hover `border-color:#1d4ed8; background:#dbeafe; box-shadow:0 0 0 3px rgba(37,99,235,.15)`。
- `.field-handle`：边框 `#cbd5e1`、底 `#f8fafc`、opacity 0.55；激活 `border-color:#2563eb; background:#eff6ff` + blue ring。
- `.lineage-controls` / `.lineage-minimap`：底 `#ffffff`、边框 `#e2e8f0`、圆角 `8px`、`shadow-float` 值；按钮 hover `background:#f8fafc; color:#1d4ed8`。
- `@media (prefers-reduced-motion: reduce)` 规则**原样保留**（关闭一切动画/过渡）。

---

## 九、旧 → 新 Token 映射表（开发照此全局替换）

### 9.1 色彩

| 旧 token（旧值） | 新 token（新值） | 说明 |
|---|---|---|
| `bg-canvas`（#f3f0e7） | `bg-page`（#F8FAFC） | 页面/画布底 |
| `bg-surface`（#fffdf8） | `bg-card`（#FFFFFF） | 卡片表面 |
| —（无） | `bg-subtle`（#F1F5F9） | 新增次级表面；旧的 `bg-[#f8f5ed]`、`bg-[#fbf9f3]` 等硬编码米色底全部改指此档 |
| `text-ink`（#1b2a25） | `text-ink`（#0F172A） | 同名换值 |
| `text-ink-soft`（#3b4d45） | `text-ink-soft`（#334155） | 同名换值 |
| `text-ink-muted`（#506159） | `text-ink-muted`（#475569） | 同名换值 |
| `text-ink-faint`（#66746d） | `text-ink-faint`（#64748B） | 同名换值 |
| `border-line`（#dcd6c9） | `border-line`（#E2E8F0） | 同名换值 |
| `border-line-strong`（#c9c2b3） | `border-line-strong`（#CBD5E1） | 同名换值 |
| `border-line-soft`（#ece8de） | `border-line-soft`（#F1F5F9） | 同名换值 |
| `pine-50`（#eef7f2） | `blue-50`（#EFF6FF） | hover 背景/浅底 |
| `pine-100`（#d7ece1） | `blue-100`（#DBEAFE） | 浅描边/徽章边 |
| `pine-200`（#b3d9c7） | `blue-200`（#BFDBFE） | 种子头部边框 |
| `pine-300`（#83bfa6） | `blue-300`（#93C5FD） | 图形点缀 |
| `pine-400`（#519f83） | `blue-400`（#60A5FA） | 图形次级 |
| `pine-500`（#2f8268） | `blue-500`（#3B82F6） | ring/选中描边（图形） |
| `pine-600`（#1f6753） | `blue-600`（#2563EB） | 主按钮/链接文字 |
| `pine-700`（#1a5344） | `blue-700`（#1D4ED8） | 主按钮 hover |
| `pine-800`（#174237） | `blue-800`（#1E40AF） | 深底/徽章深字 |
| `pine-900`（#13362e） | `blue-900`（#1E3A8A） | 登录深色面板 |
| `ember`（DEFAULT #b9552f / soft #f8e9df / deep #8d3e20） | `danger`（#DC2626 / #FEF2F2 / #B91C1C） | 合并入 danger |
| `rosewood`（#9b3a43 / #f8e8e9 / #742b32） | `danger`（同上） | 与 ember 合并（同为错误/危险语义） |
| `ochre`（#a36b11 / #fbf1d9 / #78500c） | `warning`（#D97706 / #FFFBEB / #B45309） | 警告/人工边 |
| `ai`（#2f64d8 / #eaf0ff / #214aa3） | `ai`（#4F46E5 / #EEF2FF / #3730A3） | 同名换值（indigo 化，§2.4） |
| 边色 `#2f64d8`（getEdgeVisual ai） | `lineage-ai`（#4F46E5） | 走常量 |
| 边色 `#a36b11`（manual） | `lineage-manual`（#D97706） | 走常量 |
| 边色 `#52645c`（imported 字段级） | `lineage-imported`（#475569） | 走常量 |
| 边色 `#8b958f`（imported 表级） | `lineage-imported-weak`（#64748B） | 走常量 |

> 使用统计（供评估替换面）：`text-ink-faint` 195 处、`border-line` 132、`bg-surface` 110、rosewood 104、pine-* 合计约 260、ember 31、ochre 24、`font-display` 12。ink/line 因同名换值，多数文件**零改动**；机械替换集中在 pine→blue、rosewood/ember→danger、ochre→warning 三组。

### 9.2 字体 / 阴影 / 背景 / 动效

| 旧 | 新 | 说明 |
|---|---|---|
| `font-display`（Newsreader/宋体系） | `font-sans` + 字号/字重调整（§3.1） | 衬线字族删除；登录页大标题按 01 页面文档重排 |
| `shadow-card` | `shadow-card`（新值） | 同名换值 |
| `shadow-float` | `shadow-float`（新值） | 同名换值 |
| `shadow-node` / `shadow-node-active` | 同名（新值） | 同名换值；新增 `shadow-modal` |
| `bg-fine-grid bg-grid-28` | `bg-dot-grid bg-grid-24` | 方格线→点阵 |
| `animate-fade-up`（420ms） | `animate-fade-up`（300ms） | 同名换时长 |
| `animate-fade-in`（260ms） | `animate-fade-in`（200ms） | 同名换时长 |
| `animate-modal-in`（260ms） | `animate-modal-in`（250ms） | 同名换时长 |
| `animate-soft-pulse`（1.8s） | 不变 | 保留 |
| `ease` 硬编码 cubic-bezier(0.22,1,0.36,1) | `ease-out-quint` | 新增缓动 token |
| index.css：`::selection` #cce4d8/#13362e | #DBEAFE/#1E3A8A | |
| index.css：滚动条 #c9c2b3/#a9a192 | #CBD5E1 / hover #94A3B8 | |
| index.css：`.lineage-flow` 米色渐变底 | #F8FAFC + `bg-dot-grid bg-grid-24` | |
| index.css：`dataset-card-in` 360ms | 250ms | |
| 硬编码装饰色（登录页 `#203f36`、`#8fb0a3`、`#173b31` 等深绿系） | 登录页深色面板统一 `blue-900` 系 | 按 01 页面文档执行 |
| `rounded-[14px]`（节点） | `rounded-xl`（12px） | |
| TopBar `min-h-[68px]` | `h-14`（56px） | |
| 碎片字号 7.5/8/8.5/9/9.5/10.5px | `text-[11px]` / `text-xs`（12px） | §3.2 收敛 |
| 登录页 46/55px display 大标题 | `text-[28px]` / `text-2xl` sans | §3.2 特例 |

---

## 十、无障碍检查单（Web 桌面适用项，交付前逐条 Pass/Fail）

1. **文字对比度**：正文组合全部 ≥4.5:1（以 §2.6 验证表为准）；soft 底徽章/提示条正文必须用 deep 档；禁止 `ink-faint` 出现在 subtle 底正文。用取色器抽查每页 ≥3 处实际渲染组合。
2. **图形对比度**：血缘边、focus ring、选中描边、图标 ≥3:1（§2.6 图形表）。已知登记项：输入框静止态边框 1.23:1（业界通行权衡，靠 placeholder + focus 态补偿）——保持登记，不改设计。
3. **可见 focus**：所有可交互元素（按钮/输入/菜单项/节点/边/关闭钮）有 `:focus-visible` 样式（统一 ring 规格 §7.1），且不被 `overflow` 裁切；画布节点键盘 focus 的 outline（2px blue-600/65 + offset 3px）可达。Tab 遍历登录页、顶栏、侧栏、画布工具面板无焦点丢失。
4. **prefers-reduced-motion**：系统开启减少动态时，`fade-*`/`modal-in`/`soft-pulse`/AI 边流动/节点进场全部静止（index.css 全局规则覆盖，改动动画时不得绕过该规则）。
5. **键盘可达**：搜索框 `/` 快捷聚焦（保留）；模态 Esc 关闭 + 焦点圈定 + 关闭后焦点还原（ConfirmDialog 行为推广到全部模态）；抽屉 Esc 关闭；`aria-expanded`/`aria-haspopup`/`role` 沿用现有组件实现，不因视觉改版丢失。
6. **色彩不做唯一编码**：血缘来源在颜色之外有虚线线型差异 + 徽章文字；AI 边额外有流动动画；危险操作有文字说明。
7. **触达目标**：图标按钮热区 ≥24×24；顶栏跳数按钮 ≥25×24。
8. **过渡时长**：所有交互动效 150–300ms（§5.1），无超过 300ms 的状态过渡。

---

## 十一、页面文档索引（占位，其他 agent 创建后回填链接）

| 文档 | 覆盖屏（低保真 6 屏） |
|---|---|
| `01_登录页.md` | 登录屏（LoginPage：双栏卡片、深蓝面板、表单） |
| `02_血缘画布.md` | 血缘画布（TopBar、DatasetSidebar、LineageCanvas、DatasetNode/GroupNode/LineageEdge、DetailPanel/EdgeDetailPanel） |
| `03_源文件预览.md` | 源文件预览（PreviewModal：CSV/XLSX/JSON 三形态） |
| `04_导入向导.md` | 导入向导（上传源文件 + 导入清单，前端尚未实现，纯设计规格） |
| `05_AI对话与用户管理.md` | AI 对话（AiAssistantDrawer）+ 用户管理（UserManagementModal） |
| `06_版本与变更历史.md` | 版本抽屉（VersionDrawer）+ 变更历史（HistoryDrawer）+ 二次确认（ConfirmDialog） |

> 页面文档写作约定：引用本文 token 时写 token 名（如 `blue-600`、`shadow-float`），不重复定义值；组件规格直接引 §7 小节号；新出现的页面级样式必须先回写本文再使用。
