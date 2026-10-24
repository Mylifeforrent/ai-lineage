/** sourceBadge.* 字典：血缘来源徽章。 */
export const zhSourceBadge = {
  'sourceBadge.importedDesc': '文件导入',
  'sourceBadge.manualDesc': '人工确认',
  'sourceBadge.aiDesc': 'AI 建议',
  'sourceBadge.unknownLabel': '未知',
  'sourceBadge.unknownDesc': '来源未登记',
  'sourceBadge.title': '来源 {label}：{desc}',
} as const;

export type SourceBadgeKey = keyof typeof zhSourceBadge;

export const enSourceBadge: Record<SourceBadgeKey, string> = {
  'sourceBadge.importedDesc': 'Imported from file',
  'sourceBadge.manualDesc': 'Manually confirmed',
  'sourceBadge.aiDesc': 'AI suggestion',
  'sourceBadge.unknownLabel': 'Unknown',
  'sourceBadge.unknownDesc': 'Source not registered',
  'sourceBadge.title': 'Source {label}: {desc}',
};
