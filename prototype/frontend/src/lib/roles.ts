/**
 * 前端角色可见性工具（UI 层）。
 *
 * 注意：这里只决定「是否展示写操作入口」，真正的权限校验始终在后端。
 * viewer 隐藏全部写入口；editor 可编辑/标注/打标签；admin 额外可回滚与管用户。
 */
export type Role = 'viewer' | 'editor' | 'admin' | (string & {});

export function isEditor(role: string): boolean {
  return role === 'editor' || role === 'admin';
}

export function isAdmin(role: string): boolean {
  return role === 'admin';
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'admin':
      return '管理员';
    case 'editor':
      return '编辑';
    case 'viewer':
      return '只读';
    default:
      return role || '未知角色';
  }
}
