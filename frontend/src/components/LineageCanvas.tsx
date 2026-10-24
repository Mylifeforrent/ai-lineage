import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type {
  Connection,
  OnSelectionChangeParams,
  ReactFlowInstance,
} from '@xyflow/react';
import type {
  DatasetField,
  EdgeDraft,
  LineageDataset,
  LineageEdge,
  LineageGraph,
} from '../types';
import { FIELD_PREVIEW_LIMIT, layoutDatasets, NODE_WIDTH } from '../lib/layout';
import {
  TABLE_SOURCE_HANDLE,
  TABLE_TARGET_HANDLE,
  fieldSourceHandle,
  fieldTargetHandle,
} from '../lib/handles';
import { DatasetNode } from './DatasetNode';
import type { DatasetFlowNode } from './DatasetNode';
import { GroupNode } from './GroupNode';
import type { GroupFlowNode } from './GroupNode';
import {
  LineageEdgeView,
  getEdgeVisual,
} from './LineageEdge';
import type { EdgeKind, LineageEdgeData, LineageFlowEdge } from './LineageEdge';
import { Icon } from './Icon';

const nodeTypes = { dataset: DatasetNode, group: GroupNode };
const edgeTypes = { lineage: LineageEdgeView };

type FlowNode = DatasetFlowNode | GroupFlowNode;

interface CollapsedGroup {
  id: string;
  memberIds: string[];
  label: string;
}

interface AggregateEdge {
  sourceNode: string;
  targetNode: string;
  sourceLabel: string;
  targetLabel: string;
  edge: LineageEdge;
  count: number;
}

interface LineageCanvasProps {
  graph: LineageGraph | null;
  seedDatasetId: string | null;
  hops: number;
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  collapsedIds: ReadonlySet<string>;
  fieldsExpandedIds: ReadonlySet<string>;
  onToggleCollapse: (datasetId: string) => void;
  onToggleFields: (datasetId: string) => void;
  onToggleAll: () => void;
  onSelectField: (dataset: LineageDataset, field: DatasetField) => void;
  onSelectEdge: (edge: LineageEdge, options?: { edit?: boolean }) => void;
  onRequestDeleteEdge: (edge: LineageEdge) => void;
  onConnectRequest: (draft: EdgeDraft) => void;
  onNotice: (message: string) => void;
  onRetry: () => void;
}

function parseFieldHandle(
  handleId: string | null,
  prefix: string,
): string | null {
  if (!handleId || !handleId.startsWith(prefix)) return null;
  const name = handleId.slice(prefix.length);
  return name || null;
}

export function LineageCanvas({
  graph,
  seedDatasetId,
  hops,
  loading,
  error,
  canEdit,
  collapsedIds,
  fieldsExpandedIds,
  onToggleCollapse,
  onToggleFields,
  onToggleAll,
  onSelectField,
  onSelectEdge,
  onRequestDeleteEdge,
  onConnectRequest,
  onNotice,
  onRetry,
}: LineageCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LineageFlowEdge>([]);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<
    FlowNode,
    LineageFlowEdge
  > | null>(null);
  // 用户手动拖拽后的节点位置：折叠/刷新重建 nodes 时优先复用，避免被 dagre 重排覆盖
  const draggedPositions = useRef(new Map<string, { x: number; y: number }>());
  const [groups, setGroups] = useState<CollapsedGroup[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const nextGroupId = useRef(1);

  // M2 遗留修复：种子或跳数变化都视为一张新图——清空拖拽位置与折叠组，
  // 让 dagre 按新的子图规模重新布局，避免新旧节点位置叠加。
  useEffect(() => {
    draggedPositions.current.clear();
    setGroups([]);
    setSelectedNodeIds([]);
    nextGroupId.current = 1;
  }, [seedDatasetId, hops]);

  // 子图刷新后剔除已不存在的分组成员
  useEffect(() => {
    if (!graph) {
      setGroups([]);
      setSelectedNodeIds([]);
      return;
    }
    const present = new Set(graph.datasets.map((dataset) => dataset.id));
    setSelectedNodeIds((previous) => {
      const next = previous.filter((id) => present.has(id));
      return next.length === previous.length ? previous : next;
    });
    setGroups((previous) => {
      const next = previous
        .map((group) => ({
          ...group,
          memberIds: group.memberIds.filter((id) => present.has(id)),
        }))
        .filter((group) => group.memberIds.length >= 2);
      const unchanged =
        next.length === previous.length &&
        next.every(
          (group, index) =>
            group.id === previous[index].id &&
            group.memberIds.length === previous[index].memberIds.length,
        );
      return unchanged ? previous : next;
    });
  }, [graph]);

  const handleNodeDragStop = useCallback((_: unknown, node: FlowNode) => {
    draggedPositions.current.set(node.id, { ...node.position });
  }, []);

  const handleExpandGroup = useCallback((groupId: string) => {
    draggedPositions.current.delete(groupId);
    setGroups((previous) => previous.filter((group) => group.id !== groupId));
  }, []);

  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams<FlowNode, LineageFlowEdge>) => {
      const ids = params.nodes
        .filter((node) => node.type === 'dataset')
        .map((node) => node.id);
      setSelectedNodeIds((previous) => {
        const same =
          previous.length === ids.length &&
          previous.every((id) => ids.includes(id));
        return same ? previous : ids;
      });
    },
    [],
  );

  const handleCollapseSelected = useCallback(() => {
    if (selectedNodeIds.length < 2) return;
    const nameById = new Map(
      (graph?.datasets ?? []).map((dataset) => [
        dataset.id,
        dataset.name || dataset.id,
      ]),
    );
    const names = selectedNodeIds.map((id) => nameById.get(id) ?? id);
    const label =
      names.length > 2
        ? `${names.slice(0, 2).join('、')} 等`
        : names.join('、');
    const groupId = `group-${nextGroupId.current}`;
    nextGroupId.current += 1;

    const positions = new Map<string, { x: number; y: number }>(
      nodes
        .filter((node): node is DatasetFlowNode => node.type === 'dataset')
        .map((node) => [node.id, node.position] as const),
    );
    const memberPositions = selectedNodeIds
      .map((id) => positions.get(id))
      .filter((position): position is { x: number; y: number } =>
        Boolean(position),
      );
    if (memberPositions.length >= 2) {
      const centerX =
        memberPositions.reduce((sum, position) => sum + position.x, 0) /
        memberPositions.length;
      const centerY =
        memberPositions.reduce((sum, position) => sum + position.y, 0) /
        memberPositions.length;
      draggedPositions.current.set(groupId, {
        x: centerX + NODE_WIDTH / 2 - 124,
        y: centerY + 70,
      });
    }

    setGroups((previous) => [
      ...previous,
      { id: groupId, memberIds: selectedNodeIds, label },
    ]);
    setSelectedNodeIds([]);
    setNodes((current) =>
      current.map((node) =>
        node.selected ? { ...node, selected: false } : node,
      ),
    );
    setEdges((current) =>
      current.map((edge) =>
        edge.selected ? { ...edge, selected: false } : edge,
      ),
    );
  }, [graph, nodes, selectedNodeIds, setEdges, setNodes]);

  const handleSelectField = useCallback(
    (dataset: LineageDataset, field: DatasetField) => {
      setSelectedNodeIds([]);
      setNodes((current) => {
        const hasSelected = current.some((node) => node.selected);
        return hasSelected
          ? current.map((node) => ({ ...node, selected: false }))
          : current;
      });
      setEdges((current) => {
        const hasSelected = current.some((edge) => edge.selected);
        return hasSelected
          ? current.map((edge) => ({ ...edge, selected: false }))
          : current;
      });
      onSelectField(dataset, field);
    },
    [onSelectField, setEdges, setNodes],
  );

  const handleEdgeClick = useCallback(
    (_: unknown, edge: LineageFlowEdge) => {
      const data = edge.data;
      if (!data || data.aggregateCount) return;
      onSelectEdge(data.edge);
    },
    [onSelectEdge],
  );

  const handleNodeClick = useCallback(
    (_: unknown, node: FlowNode) => {
      if (node.type === 'group') handleExpandGroup(node.id);
    },
    [handleExpandGroup],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target || !sourceHandle || !targetHandle) return;
      if (source === target && sourceHandle === targetHandle) {
        onNotice('上下游不能是同一个字段或同一个节点。');
        return;
      }
      const sourceIsTable = sourceHandle === TABLE_SOURCE_HANDLE;
      const targetIsTable = targetHandle === TABLE_TARGET_HANDLE;
      if (sourceIsTable !== targetIsTable) {
        onNotice('字段级与表级血缘不能混连：请字段连字段，或表头 handle 连表头 handle。');
        return;
      }

      const fromField = sourceIsTable
        ? null
        : parseFieldHandle(sourceHandle, 'field:out:');
      const toField = targetIsTable
        ? null
        : parseFieldHandle(targetHandle, 'field:in:');
      if (!sourceIsTable && (!fromField || !toField)) {
        onNotice('未能识别字段 handle，请重新拖拽。');
        return;
      }
      if (source === target && sourceIsTable) {
        onNotice('上下游不能是同一个数据集。');
        return;
      }
      if (source === target && fromField !== null && fromField === toField) {
        onNotice('上下游不能是同一个字段。');
        return;
      }

      onConnectRequest({
        from_dataset: source,
        from_field: fromField,
        to_dataset: target,
        to_field: toField,
      });
    },
    [onConnectRequest, onNotice],
  );

  useEffect(() => {
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const positions = layoutDatasets(
      graph.datasets,
      graph.edges,
      collapsedIds,
      fieldsExpandedIds,
    );
    const present = new Set(graph.datasets.map((dataset) => dataset.id));

    // 分组映射：成员数据集在视图层隐藏，跨组边聚合到组节点
    const datasetGroups = new Map<string, CollapsedGroup>();
    groups.forEach((group) => {
      const memberIds = group.memberIds.filter((id) => present.has(id));
      if (memberIds.length < 2) return;
      memberIds.forEach((id) => datasetGroups.set(id, group));
    });
    const hiddenIds = new Set(datasetGroups.keys());

    const positionOf = (datasetId: string) => {
      const dragged = draggedPositions.current.get(datasetId);
      if (dragged) return dragged;
      const position = positions.get(datasetId);
      return { x: position?.x ?? 0, y: position?.y ?? 0 };
    };

    const nextNodes: FlowNode[] = [];
    graph.datasets.forEach((dataset) => {
      if (hiddenIds.has(dataset.id)) return;
      const position = positionOf(dataset.id);
      nextNodes.push({
        id: dataset.id,
        type: 'dataset',
        position,
        style: { width: NODE_WIDTH },
        data: {
          dataset,
          collapsed: collapsedIds.has(dataset.id),
          isSeed: dataset.id === seedDatasetId,
          fieldsExpanded: fieldsExpandedIds.has(dataset.id),
          connectable: canEdit,
          onToggleCollapse,
          onToggleFields,
          onSelectField: handleSelectField,
        },
        draggable: true,
        selectable: true,
        zIndex: dataset.id === seedDatasetId ? 4 : 1,
      });
    });

    // 组节点放在成员当前位置的包围盒中心；不参与 dagre 布局（最小实现取舍）。
    groups.forEach((group) => {
      const memberIds = group.memberIds.filter((id) => present.has(id));
      if (memberIds.length < 2) return;
      const memberPositions = memberIds.map(positionOf);
      const centerX =
        memberPositions.reduce((sum, position) => sum + position.x, 0) /
        memberPositions.length;
      const centerY =
        memberPositions.reduce((sum, position) => sum + position.y, 0) /
        memberPositions.length;
      const draggedGroup = draggedPositions.current.get(group.id);
      nextNodes.push({
        id: group.id,
        type: 'group',
        position: draggedGroup ?? {
          x: centerX + NODE_WIDTH / 2 - 124,
          y: centerY + 70,
        },
        style: { width: 248 },
        data: {
          label: group.label,
          memberIds,
          onExpand: handleExpandGroup,
        },
        draggable: true,
        selectable: false,
        zIndex: 3,
      });
    });

    // 只渲染节点中实际可见字段的 handle/连线；部分折叠时隐藏字段的边同步隐藏
    const fieldNames = new Map(
      graph.datasets.map((dataset) => [
        dataset.id,
        new Set(
          (fieldsExpandedIds.has(dataset.id)
            ? dataset.fields
            : dataset.fields.slice(0, FIELD_PREVIEW_LIMIT)
          ).map((field) => field.name),
        ),
      ]),
    );

    const nextEdges: LineageFlowEdge[] = [];
    const aggregateEdges = new Map<string, AggregateEdge>();

    const edgeData = (
      edge: LineageEdge,
      kind: EdgeKind,
      fromLabel: string,
      toLabel: string,
    ): LineageEdgeData => ({
      edge,
      kind,
      fromLabel,
      toLabel,
      canEdit,
      onSelect: () => onSelectEdge(edge),
      onEdit: canEdit ? () => onSelectEdge(edge, { edit: true }) : undefined,
      onDelete: canEdit ? () => onRequestDeleteEdge(edge) : undefined,
    });

    graph.edges.forEach((edge) => {
      if (!present.has(edge.from_dataset) || !present.has(edge.to_dataset)) {
        return;
      }

      const fromGroup = datasetGroups.get(edge.from_dataset);
      const toGroup = datasetGroups.get(edge.to_dataset);
      if (fromGroup && toGroup && fromGroup.id === toGroup.id) {
        return;
      }

      if (fromGroup || toGroup) {
        // 跨组边聚合：同一对「组/数据集」只保留一条，展开组后可再操作具体边
        const sourceNode = fromGroup?.id ?? edge.from_dataset;
        const targetNode = toGroup?.id ?? edge.to_dataset;
        const key = `${sourceNode}-->${targetNode}`;
        const existing = aggregateEdges.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          aggregateEdges.set(key, {
            sourceNode,
            targetNode,
            sourceLabel: fromGroup
              ? fromGroup.label
              : `${edge.from_dataset}.*`,
            targetLabel: toGroup ? toGroup.label : `${edge.to_dataset}.*`,
            edge,
            count: 1,
          });
        }
        return;
      }

      const fromField = edge.from_field;
      const toField = edge.to_field;

      if (fromField === null || toField === null) {
        const visual = getEdgeVisual(edge);
        const data = edgeData(
          edge,
          'table',
          `${edge.from_dataset}.*`,
          `${edge.to_dataset}.*`,
        );
        nextEdges.push({
          id: `edge-${edge.id}-table`,
          source: edge.from_dataset,
          target: edge.to_dataset,
          sourceHandle: TABLE_SOURCE_HANDLE,
          targetHandle: TABLE_TARGET_HANDLE,
          type: 'lineage',
          data,
          ariaLabel: `表级血缘，从 ${edge.from_dataset} 到 ${edge.to_dataset}，来源 ${edge.source}`,
          style: {
            stroke: visual.color,
            strokeWidth: visual.width,
            strokeDasharray: visual.dash,
            opacity: 0.92,
          },
          animated: visual.isAi,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: visual.color,
            width: 15,
            height: 15,
          },
          zIndex: 0,
          selectable: true,
          focusable: false,
        });
        return;
      }

      if (
        collapsedIds.has(edge.from_dataset) ||
        collapsedIds.has(edge.to_dataset)
      ) {
        return;
      }
      if (
        !fieldNames.get(edge.from_dataset)?.has(fromField) ||
        !fieldNames.get(edge.to_dataset)?.has(toField)
      ) {
        return;
      }

      const visual = getEdgeVisual(edge);
      const data = edgeData(
        edge,
        'field',
        `${edge.from_dataset}.${fromField}`,
        `${edge.to_dataset}.${toField}`,
      );
      nextEdges.push({
        id: `edge-${edge.id}-field`,
        source: edge.from_dataset,
        target: edge.to_dataset,
        sourceHandle: fieldSourceHandle(fromField),
        targetHandle: fieldTargetHandle(toField),
        type: 'lineage',
        data,
        ariaLabel: `字段级血缘，从 ${edge.from_dataset}.${fromField} 到 ${edge.to_dataset}.${toField}，来源 ${edge.source}`,
        style: {
          stroke: visual.color,
          strokeWidth: visual.width,
          strokeDasharray: visual.dash,
          opacity: 0.95,
        },
        animated: visual.isAi,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: visual.color,
          width: 15,
          height: 15,
        },
        zIndex: 0,
        selectable: true,
        focusable: false,
      });
    });

    aggregateEdges.forEach((aggregate) => {
      const visual = getEdgeVisual(aggregate.edge);
      const data: LineageEdgeData = {
        edge: aggregate.edge,
        kind: 'table',
        fromLabel: aggregate.sourceLabel,
        toLabel: aggregate.targetLabel,
        aggregateCount: aggregate.count,
      };
      nextEdges.push({
        id: `edge-agg-${encodeURIComponent(aggregate.sourceNode)}-${encodeURIComponent(aggregate.targetNode)}`,
        source: aggregate.sourceNode,
        target: aggregate.targetNode,
        sourceHandle: TABLE_SOURCE_HANDLE,
        targetHandle: TABLE_TARGET_HANDLE,
        type: 'lineage',
        data,
        ariaLabel: `跨组聚合血缘，从 ${aggregate.sourceLabel} 到 ${aggregate.targetLabel}，共 ${aggregate.count} 条`,
        style: {
          stroke: visual.color,
          strokeWidth: 1.5,
          strokeDasharray: visual.dash ?? '5 4',
          opacity: 0.85,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: visual.color,
          width: 15,
          height: 15,
        },
        zIndex: 0,
        selectable: false,
        focusable: false,
      });
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [
    graph,
    // 跳数变化时即使 graph 还是旧引用，也要立刻用清空后的拖拽位置重新布局
    hops,
    seedDatasetId,
    collapsedIds,
    fieldsExpandedIds,
    groups,
    canEdit,
    onToggleCollapse,
    onToggleFields,
    handleSelectField,
    onSelectEdge,
    onRequestDeleteEdge,
    setNodes,
    setEdges,
  ]);

  useEffect(() => {
    if (!flowInstance || !graph || graph.datasets.length === 0) return;
    const timer = window.setTimeout(() => {
      void flowInstance.fitView({
        padding: 0.18,
        duration: 380,
        minZoom: 0.28,
        maxZoom: 0.95,
      });
    }, 100);
    return () => window.clearTimeout(timer);
    // 过滤只改变边集合，不重置视口；种子/跳数/分组变化时重新适配
  }, [flowInstance, seedDatasetId, hops, graph?.datasets.length, groups.length]);

  const allCollapsed =
    Boolean(graph?.datasets.length) &&
    graph!.datasets.every((dataset) => collapsedIds.has(dataset.id));
  const seedName =
    graph?.datasets.find((dataset) => dataset.id === seedDatasetId)?.name ??
    seedDatasetId;

  if (!graph && !loading && !error) {
    return (
      <div className="relative flex h-full min-h-[520px] items-center justify-center overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 bg-fine-grid bg-grid-28 opacity-60"
          aria-hidden="true"
        />
        <div className="relative mx-6 max-w-sm rounded-2xl border border-dashed border-line-strong bg-surface/75 px-8 py-9 text-center backdrop-blur-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-pine-200 bg-pine-50 text-pine-600">
            <Icon name="network" size={22} />
          </div>
          <h2 className="mt-4 font-display text-[24px] font-medium tracking-[-0.02em] text-ink">
            选择一个数据集
          </h2>
          <p className="mt-2 text-[11.5px] leading-5 text-ink-muted">
            从左侧数据集栏选择种子，画布会展示字段级与表级上下游血缘。
          </p>
        </div>
      </div>
    );
  }

  const groupableCount = selectedNodeIds.length;
  const hasGroupControls = groupableCount >= 2 || groups.length > 0;

  return (
    <div className="relative h-full min-h-[560px] bg-canvas bg-fine-grid bg-grid-28">
      {graph && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance) => setFlowInstance(instance)}
          onSelectionChange={handleSelectionChange}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onConnect={handleConnect}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 0.95 }}
          minZoom={0.22}
          maxZoom={1.65}
          nodesConnectable={canEdit}
          nodesFocusable
          edgesFocusable={false}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          deleteKeyCode={null}
          elevateNodesOnSelect
          proOptions={{ hideAttribution: true }}
          className="lineage-flow"
          aria-label="字段级血缘画布"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={23}
            size={1.05}
            color="#c9c2b3"
          />
          <Controls
            position="bottom-left"
            showInteractive={false}
            className="lineage-controls"
          />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) => (node.id === seedDatasetId ? '#2f8268' : '#b7c9c0')}
            nodeStrokeColor="#fffdf8"
            nodeBorderRadius={4}
            maskColor="rgba(243, 240, 231, 0.7)"
            className="lineage-minimap"
            ariaLabel="血缘画布缩略图"
          />

          <Panel position="top-left" className="!m-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/92 p-1.5 pr-2 shadow-sm backdrop-blur-md">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-pine-800 text-pine-100">
                  <Icon name="network" size={14} />
                </span>
                <div className="px-0.5">
                  <div className="max-w-[140px] truncate text-[10.5px] font-semibold text-ink">
                    {seedName || '血缘子图'}
                  </div>
                  <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ink-faint">
                    {graph.datasets.length} 个数据集 · {graph.edges.length} 条连线
                  </div>
                </div>
                <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
                <button
                  type="button"
                  onClick={onToggleAll}
                  className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[9.5px] font-medium text-ink-muted transition-colors hover:border-pine-300 hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
                  title={allCollapsed ? '展开全部字段' : '收起全部字段'}
                >
                  <Icon
                    name={allCollapsed ? 'unfold-all' : 'fold-all'}
                    size={12}
                  />
                  {allCollapsed ? '全部展开' : '全部收起'}
                </button>
              </div>

              {hasGroupControls && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/92 p-1.5 pr-2 shadow-sm backdrop-blur-md">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line-soft bg-canvas/70 text-ink-muted">
                    <Icon name="group" size={14} />
                  </span>
                  {groupableCount >= 2 && (
                    <button
                      type="button"
                      onClick={handleCollapseSelected}
                      className="flex h-7 items-center gap-1.5 rounded-md border border-pine-300 bg-pine-50 px-2 text-[9.5px] font-medium text-pine-700 transition-colors hover:bg-pine-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
                      title="把框选的节点折叠成一个组占位节点"
                    >
                      <Icon name="fold-all" size={12} />
                      折叠选中（{groupableCount}）
                    </button>
                  )}
                  {groups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        groups.forEach((group) =>
                          draggedPositions.current.delete(group.id),
                        );
                        setGroups([]);
                      }}
                      className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[9.5px] font-medium text-ink-muted transition-colors hover:border-pine-300 hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
                    >
                      <Icon name="unfold-all" size={12} />
                      展开全部组（{groups.length}）
                    </button>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <Panel position="bottom-center" className="!mb-2 hidden md:block">
            <div className="flex items-center gap-2.5 rounded-full border border-line/85 bg-surface/80 px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-faint backdrop-blur-sm">
              <span>拖拽平移</span>
              <span className="h-2 w-px bg-line" />
              <span>Shift + 拖拽框选</span>
              <span className="h-2 w-px bg-line" />
              <span>悬停/点击连线查看详情</span>
              {canEdit && (
                <>
                  <span className="h-2 w-px bg-line" />
                  <span>拖拽 handle 新增血缘</span>
                </>
              )}
            </div>
          </Panel>
        </ReactFlow>
      )}

      {loading && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-canvas/55 backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 shadow-float">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-pine-200 border-t-pine-700" />
            <div>
              <div className="text-[11px] font-medium text-ink">正在加载血缘子图</div>
              <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-faint">
                展开 {seedDatasetId} · {hops} 跳邻域
              </div>
            </div>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-canvas/70 p-5 backdrop-blur-[2px]">
          <div
            className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-float"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rosewood-soft text-rosewood">
                <Icon name="warning" size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[12.5px] font-semibold text-ink">
                  无法加载当前子图
                </h2>
                <p className="mt-1.5 break-words text-[11px] leading-5 text-ink-muted">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-pine-800 px-3 py-1.5 text-[10.5px] font-medium text-white transition-colors hover:bg-pine-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/40"
                >
                  <Icon name="refresh" size={12} />
                  重新加载
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
