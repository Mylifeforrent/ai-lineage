/** groupNode.* 字典：折叠组占位节点。 */
export const zhGroupNode = {
  'groupNode.aria': '折叠分组 {label}，包含 {count} 个数据集，点击展开',
  'groupNode.expandTitle': '展开该分组',
  'groupNode.datasetCount': '{count} 个数据集',
  'groupNode.clickExpand': '点击展开',
} as const;

export type GroupNodeKey = keyof typeof zhGroupNode;

export const enGroupNode: Record<GroupNodeKey, string> = {
  'groupNode.aria': 'Collapsed group {label} with {count} datasets, click to expand',
  'groupNode.expandTitle': 'Expand this group',
  'groupNode.datasetCount': '{count} datasets',
  'groupNode.clickExpand': 'Click to expand',
};
