/**
 * 血缘边四形态色值（00 §2.4 lineage 色组的唯一事实来源）。
 *
 * tailwind.config.cjs 的 colors.lineage 与此处值必须保持一致；
 * LineageEdge.getEdgeVisual 与 DatasetSidebar 图例共同引用本模块，
 * 避免同一组 hex 散落多处造成改色漂移。
 */
export const EDGE_COLORS = {
  /** source='ai' 候选边 */
  ai: '#4F46E5',
  /** source='manual' 人工边 */
  manual: '#D97706',
  /** imported 字段级边 */
  imported: '#475569',
  /** imported 表级边（弱一档） */
  importedWeak: '#64748B',
  /** 视图派生：表级血缘两端同名字段匹配的推断线 */
  derived: '#94A3B8',
  /** 点击字段后的上下游追踪高亮（与 danger 语义色同值） */
  focus: '#DC2626',
} as const;

/** hex → rgba：压暗态箭头 marker 无法继承 path 的 opacity，需单独给 alpha。 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
