/** workspace.* 字典：工作台容器（加载兜底、toast、删除确认）。 */
export const zhWorkspace = {
  'workspace.loadDatasetsFailed': '无法读取数据集列表，请检查后端服务是否已启动',
  'workspace.loadGraphFailed': '无法读取血缘子图，请稍后重试',
  'workspace.canvasUpdated': '画布已更新：{datasets} 个数据集 · {edges} 条连线',
  'workspace.edgeDeleted': '已删除血缘边 #{id}',
  'workspace.edgeDeleteFailed': '删除血缘边失败，请稍后重试。',
  'workspace.edgeCreated': '已新增血缘边 #{id}（人工补边）',
  'workspace.aiSuggested': 'AI 已落库 {count} 条血缘候选边，请在画布上人工确认',
  'workspace.deleteDesc': '{key}（来源 {source}）',
  'workspace.deleteEdgeTitle': '删除血缘边',
  'workspace.deleteConfirm': '确认删除',
  'workspace.deleteNote': '删除会写入变更日志；如需恢复，可由管理员回滚到之前的版本标签。',
} as const;

export type WorkspaceKey = keyof typeof zhWorkspace;

export const enWorkspace: Record<WorkspaceKey, string> = {
  'workspace.loadDatasetsFailed': 'Cannot load the dataset list. Check that the backend service is running.',
  'workspace.loadGraphFailed': 'Cannot load the lineage subgraph. Please try again later.',
  'workspace.canvasUpdated': 'Canvas updated: {datasets} datasets · {edges} edges',
  'workspace.edgeDeleted': 'Lineage edge #{id} deleted',
  'workspace.edgeDeleteFailed': 'Failed to delete the lineage edge. Please try again later.',
  'workspace.edgeCreated': 'Lineage edge #{id} added (manual)',
  'workspace.aiSuggested': '{count} AI-suggested candidate edges saved. Review them on the canvas.',
  'workspace.deleteDesc': '{key} (source {source})',
  'workspace.deleteEdgeTitle': 'Delete lineage edge',
  'workspace.deleteConfirm': 'Delete',
  'workspace.deleteNote': 'Deletion is written to the change log; an admin can roll back to a previous version tag to restore.',
};
