/** lineageEdge.* 字典：血缘边 tooltip。 */
export const zhLineageEdge = {
  'lineageEdge.derivedTitle': '同名字段匹配 · 推断',
  'lineageEdge.derivedNote': '由两端数据集的表级血缘按同名字段匹配推断，仅用于上下游追踪演示，不是库内血缘边。',
  'lineageEdge.aggregateTitle': '跨组聚合 · {count} 条边',
  'lineageEdge.fieldLevelTitle': '字段级血缘 · #{id}',
  'lineageEdge.tableLevelTitle': '表级血缘 · #{id}',
  'lineageEdge.transform': '转换',
  'lineageEdge.transformEmpty': '未填写',
  'lineageEdge.confidence': '置信度',
  'lineageEdge.source': '来源',
  'lineageEdge.sourceEmpty': '未登记',
  'lineageEdge.aggregateNote': '展开分组后可查看并编辑其中每一条具体血缘。',
  'lineageEdge.viewDetail': '查看详情',
  'lineageEdge.edit': '编辑',
  'lineageEdge.delete': '删除',
} as const;

export type LineageEdgeKey = keyof typeof zhLineageEdge;

export const enLineageEdge: Record<LineageEdgeKey, string> = {
  'lineageEdge.derivedTitle': 'Same-name match · Inferred',
  'lineageEdge.derivedNote':
    'Inferred from table-level lineage by matching same-named fields on both ends. Shown for tracing demo only — not a stored lineage edge.',
  'lineageEdge.aggregateTitle': 'Cross-group aggregate · {count} edges',
  'lineageEdge.fieldLevelTitle': 'Field-level lineage · #{id}',
  'lineageEdge.tableLevelTitle': 'Table-level lineage · #{id}',
  'lineageEdge.transform': 'Transform',
  'lineageEdge.transformEmpty': 'Not filled',
  'lineageEdge.confidence': 'Confidence',
  'lineageEdge.source': 'Source',
  'lineageEdge.sourceEmpty': 'Not registered',
  'lineageEdge.aggregateNote': 'Expand the group to view and edit each lineage edge inside.',
  'lineageEdge.viewDetail': 'Details',
  'lineageEdge.edit': 'Edit',
  'lineageEdge.delete': 'Delete',
};
