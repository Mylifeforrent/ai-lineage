import type { LineageEdge } from '../types';

/**
 * 标注 / change_log 的实体命名规则（与后端一致）：
 * - 字段：<dataset_id>.<field_name>
 * - 边：<from_dataset>.<from_field | *>--><to_dataset>.<to_field | *>
 */
export function fieldEntityKey(datasetId: string, fieldName: string): string {
  return `${datasetId}.${fieldName}`;
}

export function edgeEntityKey(edge: LineageEdge): string {
  const from = `${edge.from_dataset}.${edge.from_field ?? '*'}`;
  const to = `${edge.to_dataset}.${edge.to_field ?? '*'}`;
  return `${from}-->${to}`;
}
