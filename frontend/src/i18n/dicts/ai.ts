/** ai.* 字典：AI 助手抽屉（AiAssistantDrawer）。 */
export const zhAi = {
  // 头部：标题与操作
  'ai.title': 'AI 助手',
  'ai.reloadAria': '重新检查 LLM 配置',
  'ai.reloadTitle': '重新检查配置',
  'ai.closeAria': '关闭 AI 助手',

  // 工具标签（组件内 TOOL_LABEL_KEYS：工具名 → 本节键）
  'ai.tool.searchFields': '搜索字段',
  'ai.tool.getFieldDetails': '字段详情',
  'ai.tool.traceLineage': '追溯血缘',
  'ai.tool.getFieldHistory': '变更历史',
  'ai.tool.markHighlight': '标记高亮',
  'ai.tool.suggestLineage': '建议血缘',
  'ai.tool.analyzeImpact': '影响分析',
  'ai.tool.draftDescriptions': '起草描述',

  // 工具调用追踪卡
  'ai.toolCall': '工具调用',
  'ai.toolTraceCount': '工具调用 · {count} 次',
  'ai.toolOk': '调用成功',
  'ai.toolFail': '调用失败',

  // 聚焦栏
  'ai.focusCurrent': '当前聚焦',
  'ai.readonlyTools': '只读工具',
  'ai.noFocus': '未聚焦数据集',

  // 状态条与告警横幅
  'ai.statusLoadingAria': '正在读取 AI 状态',
  'ai.statusUnknown': '状态未知',
  'ai.notConfigured': '未配置',
  'ai.statusErrorTitle': '无法读取 AI 状态',
  'ai.statusLoadFailed': '无法读取 AI 状态，请稍后重试。',
  'ai.unavailableTitle': 'AI 助手暂不可用',
  'ai.notConfiguredHint':
    '未配置 LLM，请在 .env 设置 LLM_*（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）。',
  'ai.notConfiguredAction': '配置后点右上角刷新重新检测。',

  // 空态与示例提问
  'ai.logAria': 'AI 对话消息',
  'ai.emptyTitle': '用自然语言查血缘',
  'ai.emptyBody':
    'AI 会调用工具查询字段、上下游子图与变更历史；回答里的字段引用可点击回画布追踪，还能补血缘建议、起草字段描述（确认后才生效）。',
  'ai.exampleOrderSource': '订单表里的 order_no 是从哪来的？',
  'ai.exampleFieldLocator': '这个字段的源文件定位在哪里？',
  'ai.exampleRecentChanges': '最近改过哪些字段？',

  // 消息流
  'ai.you': '你',
  'ai.thinking': '正在调用工具并组织回答…',
  'ai.noAnswer': '模型未返回文字回答。',
  'ai.canvasUpdated': '画布已更新',
  'ai.graphSummary': '{datasets} 个数据集 · {edges} 条连线',
  'ai.closeAndView': '关闭并查看',
  'ai.serviceError': 'AI 服务返回 {status}：{detail}',
  'ai.cancelled': '（已取消）',
  'ai.connectFailed': '无法连接 AI 服务，请稍后重试',

  // 证据锚点 chip
  'ai.traceOnCanvas': '在画布上追踪 {dataset}.{field}',

  // 描述草稿卡
  'ai.draftBadge': '描述草稿',
  'ai.draftAccepted': '已采纳 · 已写入标注',
  'ai.draftRejected': '已拒绝',
  'ai.draftAccept': '采纳（写入标注）',
  'ai.draftReject': '拒绝',
  'ai.draftProcessing': '处理中…',
  'ai.draftViewerHint': '仅 editor 及以上角色可采纳/拒绝草稿。',

  // 输入区
  'ai.inputLabel': '向 AI 助手提问',
  'ai.placeholderChecking': '正在检查 LLM 配置…',
  'ai.placeholderStatusError': '无法读取 AI 状态，请先重试',
  'ai.placeholderReady': '问点什么…（工具调用仅只读，AI 建议需人工确认）',
  'ai.placeholderNotConfigured': '配置 LLM 后即可提问',
  'ai.send': '发送',
  'ai.sending': '发送中',
  'ai.inputHint': 'Enter 发送 · Shift + Enter 换行 · 仅回传最近 50 条',
} as const;

export type AiKey = keyof typeof zhAi;

export const enAi: Record<AiKey, string> = {
  // 头部：标题与操作
  'ai.title': 'AI Assistant',
  'ai.reloadAria': 'Re-check LLM configuration',
  'ai.reloadTitle': 'Re-check configuration',
  'ai.closeAria': 'Close AI assistant',

  // 工具标签
  'ai.tool.searchFields': 'Search fields',
  'ai.tool.getFieldDetails': 'Field details',
  'ai.tool.traceLineage': 'Trace lineage',
  'ai.tool.getFieldHistory': 'Change history',
  'ai.tool.markHighlight': 'Mark highlight',
  'ai.tool.suggestLineage': 'Suggest lineage',
  'ai.tool.analyzeImpact': 'Impact analysis',
  'ai.tool.draftDescriptions': 'Draft descriptions',

  // 工具调用追踪卡
  'ai.toolCall': 'Tool call',
  'ai.toolTraceCount': 'Tool calls · {count}',
  'ai.toolOk': 'Call succeeded',
  'ai.toolFail': 'Call failed',

  // 聚焦栏
  'ai.focusCurrent': 'Current focus',
  'ai.readonlyTools': 'Read-only tools',
  'ai.noFocus': 'No focused dataset',

  // 状态条与告警横幅
  'ai.statusLoadingAria': 'Reading AI status',
  'ai.statusUnknown': 'Status unknown',
  'ai.notConfigured': 'Not configured',
  'ai.statusErrorTitle': 'Cannot read AI status',
  'ai.statusLoadFailed': 'Cannot read AI status. Please try again later.',
  'ai.unavailableTitle': 'AI assistant unavailable',
  'ai.notConfiguredHint':
    'LLM is not configured. Set LLM_* (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL) in .env.',
  'ai.notConfiguredAction':
    'After configuring, click the refresh button at the top right to re-check.',

  // 空态与示例提问
  'ai.logAria': 'AI conversation',
  'ai.emptyTitle': 'Query lineage in natural language',
  'ai.emptyBody':
    'The assistant calls tools to look up fields, upstream and downstream subgraphs, and change history. Field references in the answer are clickable to trace on the canvas. It can also suggest lineage and draft field descriptions (effective only after confirmation).',
  'ai.exampleOrderSource': 'Where does order_no in the orders table come from?',
  'ai.exampleFieldLocator': 'Where is the source file for this field?',
  'ai.exampleRecentChanges': 'Which fields changed recently?',

  // 消息流
  'ai.you': 'You',
  'ai.thinking': 'Calling tools and composing the answer…',
  'ai.noAnswer': 'The model returned no text answer.',
  'ai.canvasUpdated': 'Canvas updated',
  'ai.graphSummary': '{datasets} datasets · {edges} edges',
  'ai.closeAndView': 'Close and view',
  'ai.serviceError': 'AI service returned {status}: {detail}',
  'ai.cancelled': '(Cancelled)',
  'ai.connectFailed': 'Cannot connect to the AI service. Please try again later.',

  // 证据锚点 chip
  'ai.traceOnCanvas': 'Trace {dataset}.{field} on canvas',

  // 描述草稿卡
  'ai.draftBadge': 'Description draft',
  'ai.draftAccepted': 'Accepted · Written to annotation',
  'ai.draftRejected': 'Rejected',
  'ai.draftAccept': 'Accept (write annotation)',
  'ai.draftReject': 'Reject',
  'ai.draftProcessing': 'Processing…',
  'ai.draftViewerHint': 'Only editors and above can accept or reject drafts.',

  // 输入区
  'ai.inputLabel': 'Ask the AI assistant',
  'ai.placeholderChecking': 'Checking LLM configuration…',
  'ai.placeholderStatusError': 'Cannot read AI status. Retry first.',
  'ai.placeholderReady':
    'Ask anything… (tool calls are read-only; AI suggestions need confirmation)',
  'ai.placeholderNotConfigured': 'Configure the LLM to start asking',
  'ai.send': 'Send',
  'ai.sending': 'Sending',
  'ai.inputHint':
    'Enter to send · Shift + Enter for a new line · Only the last 50 messages are sent',
};
