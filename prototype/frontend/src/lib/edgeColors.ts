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
} as const;
