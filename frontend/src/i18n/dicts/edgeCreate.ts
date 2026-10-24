/** edgeCreate.* 字典：人工补边弹窗。 */
export const zhEdgeCreate = {
  'edgeCreate.eyebrowField': '人工补边 · 字段级',
  'edgeCreate.eyebrowTable': '人工补边 · 表级',
  'edgeCreate.title': '新增血缘',
  'edgeCreate.close': '关闭新增血缘弹窗',
  'edgeCreate.transformLabel': '转换说明',
  'edgeCreate.transformPlaceholder': '如 trim/cast、lookup、金额汇总',
  'edgeCreate.confidenceLabel': '置信度（0~1）',
  'edgeCreate.confidenceInvalid': '置信度必须是 0 到 1 之间的数字。',
  'edgeCreate.noteLabel': '备注',
  'edgeCreate.notePlaceholder': '为什么补这条边（可选）',
  'edgeCreate.hint': '人工边来源记为 manual，会写入变更日志；同一上下游已存在血缘时后端返回 409。',
  'edgeCreate.submitFailed': '新增血缘失败，请稍后重试。',
  'edgeCreate.creating': '创建中…',
  'edgeCreate.submit': '创建血缘边',
} as const;

export type EdgeCreateKey = keyof typeof zhEdgeCreate;

export const enEdgeCreate: Record<EdgeCreateKey, string> = {
  'edgeCreate.eyebrowField': 'Manual edge · Field-level',
  'edgeCreate.eyebrowTable': 'Manual edge · Table-level',
  'edgeCreate.title': 'Add lineage edge',
  'edgeCreate.close': 'Close the add-lineage dialog',
  'edgeCreate.transformLabel': 'Transform description',
  'edgeCreate.transformPlaceholder': 'e.g. trim/cast, lookup, amount rollup',
  'edgeCreate.confidenceLabel': 'Confidence (0–1)',
  'edgeCreate.confidenceInvalid': 'Confidence must be a number between 0 and 1.',
  'edgeCreate.noteLabel': 'Note',
  'edgeCreate.notePlaceholder': 'Why this edge is added (optional)',
  'edgeCreate.hint': 'Manual edges are recorded as source=manual and written to the change log; the backend returns 409 if the same lineage already exists.',
  'edgeCreate.submitFailed': 'Failed to add the lineage edge. Please try again later.',
  'edgeCreate.creating': 'Creating…',
  'edgeCreate.submit': 'Create edge',
};
