/** topbar.* 字典：顶栏。 */
export const zhTopbar = {
  'topbar.workspacePath': '工作台 / 血缘画布',
  'topbar.pageTitle': '血缘画布',
  'topbar.searchLabel': '搜索数据集或字段',
  'topbar.searchPlaceholder': '搜索数据集 / 字段…',
  'topbar.clearSearch': '清空搜索',
  'topbar.import': '导入数据',
  'topbar.importTitle': '上传源文件并导入血缘清单（editor 及以上角色）',
  'topbar.ai': 'AI 助手',
  'topbar.aiTitle': '打开 AI 助手：自然语言查血缘并联动出图',
  'topbar.versions': '版本',
  'topbar.versionsTitle': '查看导入批次、业务标签、版本差异与回滚',
  'topbar.hops': '跳数',
  'topbar.hopsGroup': '血缘子图跳数',
  'topbar.hopLabel': '{count} 跳',
  'topbar.loadingSubgraph': '正在加载子图',
  'topbar.userMenu': '用户菜单',
  'topbar.userManagement': '用户管理',
  'topbar.logout': '退出登录',
} as const;

export type TopbarKey = keyof typeof zhTopbar;

export const enTopbar: Record<TopbarKey, string> = {
  'topbar.workspacePath': 'Workspace / Lineage Canvas',
  'topbar.pageTitle': 'Lineage Canvas',
  'topbar.searchLabel': 'Search datasets or fields',
  'topbar.searchPlaceholder': 'Search datasets / fields…',
  'topbar.clearSearch': 'Clear search',
  'topbar.import': 'Import',
  'topbar.importTitle': 'Upload source files and import the lineage manifest (editor and above)',
  'topbar.ai': 'AI Assistant',
  'topbar.aiTitle': 'Open the AI assistant: query lineage in natural language with canvas sync',
  'topbar.versions': 'Versions',
  'topbar.versionsTitle': 'View import batches, tags, version diffs and rollbacks',
  'topbar.hops': 'Hops',
  'topbar.hopsGroup': 'Lineage subgraph hops',
  'topbar.hopLabel': '{count} hops',
  'topbar.loadingSubgraph': 'Loading subgraph',
  'topbar.userMenu': 'User menu',
  'topbar.userManagement': 'Manage users',
  'topbar.logout': 'Log out',
};
