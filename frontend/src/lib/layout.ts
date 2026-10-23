import * as dagre from '@dagrejs/dagre';
import type { LineageDataset, LineageEdge } from '../types';

export const NODE_WIDTH = 288;
export const NODE_HEADER_HEIGHT = 56;
export const FIELD_ROW_HEIGHT = 34;
// 节点内部分折叠：默认最多展示 5 个字段，其余折叠（原型「其余 N 个字段已折叠」）
export const FIELD_PREVIEW_LIMIT = 5;
const FIELD_TOGGLE_HEIGHT = 26;
const EXPANDED_PADDING = 12;
const EMPTY_FIELDS_HEIGHT = 42;
const COLLAPSED_BODY_HEIGHT = 48;

export interface LayoutPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function visibleFieldCount(fieldCount: number, fieldsExpanded: boolean): number {
  return fieldsExpanded ? fieldCount : Math.min(fieldCount, FIELD_PREVIEW_LIMIT);
}

export function estimateNodeHeight(
  fieldCount: number,
  collapsed: boolean,
  fieldsExpanded = true,
): number {
  if (collapsed) return NODE_HEADER_HEIGHT + COLLAPSED_BODY_HEIGHT;
  if (fieldCount === 0) {
    return NODE_HEADER_HEIGHT + EXPANDED_PADDING + EMPTY_FIELDS_HEIGHT;
  }
  const toggle =
    fieldCount > FIELD_PREVIEW_LIMIT && !fieldsExpanded ? FIELD_TOGGLE_HEIGHT : 0;
  return (
    NODE_HEADER_HEIGHT +
    EXPANDED_PADDING +
    visibleFieldCount(fieldCount, fieldsExpanded) * FIELD_ROW_HEIGHT +
    toggle
  );
}

export function layoutDatasets(
  datasets: LineageDataset[],
  edges: LineageEdge[],
  collapsedIds: ReadonlySet<string>,
  fieldsExpandedIds: ReadonlySet<string> = new Set(),
): Map<string, LayoutPosition> {
  const graph = new dagre.graphlib.Graph({ multigraph: true, compound: false });
  graph.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 42,
    ranksep: 124,
    marginx: 36,
    marginy: 36,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const datasetIds = new Set(datasets.map((dataset) => dataset.id));
  const dimensions = new Map<string, { width: number; height: number }>();

  datasets.forEach((dataset) => {
    const width = NODE_WIDTH;
    const height = estimateNodeHeight(
      dataset.fields.length,
      collapsedIds.has(dataset.id),
      fieldsExpandedIds.has(dataset.id),
    );
    dimensions.set(dataset.id, { width, height });
    graph.setNode(dataset.id, { width, height });
  });

  edges.forEach((edge, index) => {
    if (edge.from_dataset === edge.to_dataset) return;
    if (
      !datasetIds.has(edge.from_dataset) ||
      !datasetIds.has(edge.to_dataset)
    ) {
      return;
    }
    graph.setEdge(
      edge.from_dataset,
      edge.to_dataset,
      { minlen: 1, weight: 1 },
      `lineage-${index}`,
    );
  });

  dagre.layout(graph);

  const positions = new Map<string, LayoutPosition>();
  datasets.forEach((dataset) => {
    const node = graph.node(dataset.id) as
      | { x?: number; y?: number; width?: number; height?: number }
      | undefined;
    const size = dimensions.get(dataset.id);
    if (!node || !size) return;
    const width = node.width ?? size.width;
    const height = node.height ?? size.height;
    positions.set(dataset.id, {
      x: (node.x ?? 0) - width / 2,
      y: (node.y ?? 0) - height / 2,
      width,
      height,
    });
  });

  return positions;
}
