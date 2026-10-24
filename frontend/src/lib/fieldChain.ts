import type { LineageGraph } from '../types';

/**
 * 视图层派生的「同名字段匹配」连线。
 *
 * 非库内血缘实体：由表级血缘（from_field/to_field 为 null）按两端数据集的
 * 同名字段推导，仅用于画布展示与上下游追踪演示；不可选中、不可编辑。
 */
export interface DerivedFieldLink {
  from_dataset: string;
  from_field: string;
  to_dataset: string;
  to_field: string;
}

export interface FieldChainNode {
  datasetId: string;
  fieldName: string;
  role: 'focus' | 'linked';
}

/** 点击字段后命中的上下游追踪链路（沿字段级关联无向 BFS）。 */
export interface FieldChain {
  /** 命中的库内字段级边 id */
  edgeIds: Set<number>;
  /** 命中的推导同名字段线 key（见 derivedLinkKey） */
  linkKeys: Set<string>;
  nodes: FieldChainNode[];
}

type ChainConnection =
  | { kind: 'edge'; key: number; other: string }
  | { kind: 'link'; key: string; other: string };

export function derivedLinkKey(link: DerivedFieldLink): string {
  return `${link.from_dataset}::${link.from_field}::${link.to_dataset}::${link.to_field}`;
}

/**
 * 从表级血缘推导同名字段匹配线：两端数据集共有、且未被这对数据集之间
 * 任何一条显式字段级边占用的字段名（已有显式映射时以显式边为准，
 * 避免推导线与人工/AI 确认的字段映射互相矛盾）。
 */
export function deriveFieldMatches(graph: LineageGraph): DerivedFieldLink[] {
  const fieldsByDataset = new Map<string, Set<string>>();
  graph.datasets.forEach((dataset) => {
    fieldsByDataset.set(
      dataset.id,
      new Set(dataset.fields.map((field) => field.name)),
    );
  });

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const explicitEndpointFields = new Map<string, Set<string>>();
  graph.edges.forEach((edge) => {
    if (edge.from_field === null || edge.to_field === null) return;
    const key = pairKey(edge.from_dataset, edge.to_dataset);
    const names = explicitEndpointFields.get(key) ?? new Set<string>();
    names.add(edge.from_field);
    names.add(edge.to_field);
    explicitEndpointFields.set(key, names);
  });

  const derived: DerivedFieldLink[] = [];
  const seen = new Set<string>();
  graph.edges.forEach((edge) => {
    // 只展开表级血缘：显式字段级边只代表单个字段映射，不能推断其余字段
    if (edge.from_field !== null || edge.to_field !== null) return;
    if (edge.from_dataset === edge.to_dataset) return;
    const fromFields = fieldsByDataset.get(edge.from_dataset);
    const toFields = fieldsByDataset.get(edge.to_dataset);
    if (!fromFields || !toFields) return;
    const occupied = explicitEndpointFields.get(
      pairKey(edge.from_dataset, edge.to_dataset),
    );

    fromFields.forEach((fieldName) => {
      if (!toFields.has(fieldName)) return;
      if (occupied?.has(fieldName)) return;
      const link: DerivedFieldLink = {
        from_dataset: edge.from_dataset,
        from_field: fieldName,
        to_dataset: edge.to_dataset,
        to_field: fieldName,
      };
      const key = derivedLinkKey(link);
      if (seen.has(key)) return;
      seen.add(key);
      derived.push(link);
    });
  });
  return derived;
}

/**
 * 以一个或多个点击/声明的字段为起点，沿「库内字段级边 + 推导同名字段线」
 * 做无向 BFS，收集整条上下游链路；起点字段没有任何字段级关联时返回 null
 * （此时画布不做高亮与压暗）。
 */
export function computeFieldChain(
  graph: LineageGraph,
  derivedLinks: DerivedFieldLink[],
  focus: Array<{ datasetId: string; fieldName: string }>,
): FieldChain | null {
  if (focus.length === 0) return null;
  const nodeKey = (datasetId: string, fieldName: string) =>
    `${datasetId}::${fieldName}`;
  const nodeInfo = new Map<string, { datasetId: string; fieldName: string }>();
  const adjacency = new Map<string, ChainConnection[]>();

  const connect = (
    aDataset: string,
    aField: string,
    bDataset: string,
    bField: string,
    connection: ChainConnection,
  ) => {
    const a = nodeKey(aDataset, aField);
    const b = nodeKey(bDataset, bField);
    nodeInfo.set(a, { datasetId: aDataset, fieldName: aField });
    nodeInfo.set(b, { datasetId: bDataset, fieldName: bField });
    const list = adjacency.get(a) ?? [];
    list.push({ ...connection, other: b });
    adjacency.set(a, list);
  };

  graph.edges.forEach((edge) => {
    if (edge.from_field === null || edge.to_field === null) return;
    connect(
      edge.from_dataset,
      edge.from_field,
      edge.to_dataset,
      edge.to_field,
      { kind: 'edge', key: edge.id, other: '' },
    );
    connect(
      edge.to_dataset,
      edge.to_field,
      edge.from_dataset,
      edge.from_field,
      { kind: 'edge', key: edge.id, other: '' },
    );
  });
  derivedLinks.forEach((link) => {
    const key = derivedLinkKey(link);
    connect(link.from_dataset, link.from_field, link.to_dataset, link.to_field, {
      kind: 'link',
      key,
      other: '',
    });
    connect(link.to_dataset, link.to_field, link.from_dataset, link.from_field, {
      kind: 'link',
      key,
      other: '',
    });
  });

  const focusKeys = focus.map((item) => nodeKey(item.datasetId, item.fieldName));
  const visited = new Set<string>(focusKeys);
  const edgeIds = new Set<number>();
  const linkKeys = new Set<string>();
  const queue = [...focusKeys];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    (adjacency.get(current) ?? []).forEach((connection) => {
      if (connection.kind === 'edge') edgeIds.add(connection.key);
      else linkKeys.add(connection.key);
      if (!visited.has(connection.other)) {
        visited.add(connection.other);
        queue.push(connection.other);
      }
    });
  }

  if (edgeIds.size === 0 && linkKeys.size === 0) return null;

  const focusKeySet = new Set(focusKeys);
  const nodes: FieldChainNode[] = [];
  visited.forEach((key) => {
    const info = nodeInfo.get(key);
    if (!info) return;
    nodes.push({
      ...info,
      role: focusKeySet.has(key) ? 'focus' : 'linked',
    });
  });
  return { edgeIds, linkKeys, nodes };
}
