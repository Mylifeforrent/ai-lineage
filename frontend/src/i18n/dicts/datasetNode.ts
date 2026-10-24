/** datasetNode.* 字典：画布表节点卡片。 */
export const zhDatasetNode = {
  'datasetNode.aria': '数据集 {name}，{count} 个字段',
  'datasetNode.expandFields': '展开 {id} 的字段列表',
  'datasetNode.collapseFields': '收起 {id} 的字段列表',
  'datasetNode.expandFieldsTitle': '展开字段列表',
  'datasetNode.collapseFieldsTitle': '收起字段列表',
  'datasetNode.seed': '种子',
  'datasetNode.fieldCount': '{count} 个字段',
  'datasetNode.expandAll': '展开 {count} 个字段',
  'datasetNode.noFields': '暂无字段',
  'datasetNode.viewField': '查看字段 {id}',
  'datasetNode.fieldTitle': '{desc} · 点击查看定位与回源预览',
  'datasetNode.aiCandidate': '存在待确认的 AI 候选血缘',
  'datasetNode.foldToLimit': '收起至前 {count} 个字段',
  'datasetNode.expandRest': '展开其余 {count} 个字段',
  'datasetNode.restFolded': '其余 {count} 个字段已折叠',
} as const;

export type DatasetNodeKey = keyof typeof zhDatasetNode;

export const enDatasetNode: Record<DatasetNodeKey, string> = {
  'datasetNode.aria': 'Dataset {name}, {count} fields',
  'datasetNode.expandFields': 'Expand field list of {id}',
  'datasetNode.collapseFields': 'Collapse field list of {id}',
  'datasetNode.expandFieldsTitle': 'Expand field list',
  'datasetNode.collapseFieldsTitle': 'Collapse field list',
  'datasetNode.seed': 'Seed',
  'datasetNode.fieldCount': '{count} fields',
  'datasetNode.expandAll': 'Expand {count} fields',
  'datasetNode.noFields': 'No fields',
  'datasetNode.viewField': 'View field {id}',
  'datasetNode.fieldTitle': '{desc} · Click to view locator and source preview',
  'datasetNode.aiCandidate': 'Has pending AI-suggested lineage',
  'datasetNode.foldToLimit': 'Fold to first {count} fields',
  'datasetNode.expandRest': 'Expand the other {count} fields',
  'datasetNode.restFolded': '{count} more fields folded',
};
