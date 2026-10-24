import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  AiHighlightItem,
  DatasetField,
  EdgeDraft,
  LineageDataset,
  LineageEdge,
  LineageGraph,
} from '../types';
import { EDGE_COLORS, withAlpha } from '../lib/edgeColors';
import {
  computeFieldChain,
  deriveFieldMatches,
  derivedLinkKey,
} from '../lib/fieldChain';
import type { FieldChain } from '../lib/fieldChain';
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
import { useI18n } from '../i18n';

const nodeTypes = { dataset: DatasetNode, group: GroupNode };
const edgeTypes = { lineage: LineageEdgeView };

/** 追踪焦点激活时，未命中链路的连线统一压暗到该透明度 */
const DIMMED_OPACITY = 0.15;
const DIMMED_MARKER_ALPHA = 0.3;

type FlowNode = DatasetFlowNode | GroupFlowNode;

interface FieldFocus {
  datasetId: string;
  fieldName: string;
}

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
  /**
   * AI 回答声明的高亮字段（mark_highlight 汇总）：seq 变化即应用或清除
   * 追踪焦点；fields 为空数组表示显式清除（新一轮回答未声明高亮）。
   */
  aiFocusFields: { seq: number; fields: AiHighlightItem[] } | null;
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
  aiFocusFields,
}: LineageCanvasProps) {
  const { t } = useI18n();
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
  // 字段追踪焦点：点击字段行或 AI 回答声明后，沿字段级关联高亮整条上下游链路
  const [focusFields, setFocusFields] = useState<FieldFocus[]>([]);

  // 视图派生：表级血缘两端同名字段匹配线（非库内血缘，仅追踪演示用）
  const derivedLinks = useMemo(
    () => (graph ? deriveFieldMatches(graph) : []),
    [graph],
  );
  const chain = useMemo(
    () =>
      graph && focusFields.length > 0
        ? computeFieldChain(graph, derivedLinks, focusFields)
        : null,
    [graph, derivedLinks, focusFields],
  );

  // M2 遗留修复：种子或跳数变化都视为一张新图——清空拖拽位置与折叠组，
  // 让 dagre 按新的子图规模重新布局，避免新旧节点位置叠加。
  useEffect(() => {
    draggedPositions.current.clear();
    setGroups([]);
    setSelectedNodeIds([]);
    setFocusFields([]);
    nextGroupId.current = 1;
  }, [seedDatasetId, hops]);

  // 子图刷新后焦点字段已不存在时，剔除失效焦点（全部失效即清空追踪态）
  useEffect(() => {
    if (focusFields.length === 0 || !graph) return;
    const next = focusFields.filter((item) => {
      const dataset = graph.datasets.find((d) => d.id === item.datasetId);
      return Boolean(
        dataset?.fields.some((f) => f.name === item.fieldName),
      );
    });
    if (next.length !== focusFields.length) setFocusFields(next);
  }, [graph, focusFields]);

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
      if (ids.length > 0) setFocusFields([]);
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
    const joiner = t('canvas.groupNameJoin');
    const label =
      names.length > 2
        ? t('canvas.groupLabelMore', {
            names: names.slice(0, 2).join(joiner),
            rest: names.length - 2,
          })
        : names.join(joiner);
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
  }, [graph, nodes, selectedNodeIds, setEdges, setNodes, t]);

  /** 追踪前保证链路字段可见：折叠的表自动展开，超出预览上限的字段列表自动展开 */
  const revealChainFields = useCallback(
    (targetChain: FieldChain) => {
      if (!graph) return;
      targetChain.nodes.forEach((node) => {
        if (collapsedIds.has(node.datasetId)) onToggleCollapse(node.datasetId);
        const target = graph.datasets.find(
          (item) => item.id === node.datasetId,
        );
        if (!target) return;
        const visibleCount = fieldsExpandedIds.has(node.datasetId)
          ? target.fields.length
          : Math.min(target.fields.length, FIELD_PREVIEW_LIMIT);
        const index = target.fields.findIndex(
          (item) => item.name === node.fieldName,
        );
        if (index >= visibleCount) onToggleFields(node.datasetId);
      });
    },
    [collapsedIds, fieldsExpandedIds, graph, onToggleCollapse, onToggleFields],
  );

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

      const nextFocus: FieldFocus[] = [
        { datasetId: dataset.id, fieldName: field.name },
      ];
      const sameFocus =
        focusFields.length === 1 &&
        focusFields[0].datasetId === nextFocus[0].datasetId &&
        focusFields[0].fieldName === nextFocus[0].fieldName;
      setFocusFields(nextFocus);

      // 追踪前先保证链路上的字段行可见，否则链路线会被隐藏。
      if (graph && !sameFocus) {
        const nextChain = computeFieldChain(graph, derivedLinks, nextFocus);
        if (nextChain) revealChainFields(nextChain);
      }

      onSelectField(dataset, field);
    },
    [
      focusFields,
      derivedLinks,
      graph,
      revealChainFields,
      onSelectField,
      setEdges,
      setNodes,
    ],
  );

  const handleEdgeClick = useCallback(
    (_: unknown, edge: LineageFlowEdge) => {
      const data = edge.data;
      if (!data?.edge || data.aggregateCount || data.derived) return;
      setFocusFields([]);
      onSelectEdge(data.edge);
    },
    [onSelectEdge],
  );

  const handlePaneClick = useCallback(() => setFocusFields([]), []);

  // AI 回答声明的高亮字段：校验存在 → 自动展开链路 → 应用为追踪焦点
  useEffect(() => {
    if (!aiFocusFields) return;
    if (aiFocusFields.fields.length === 0) {
      setFocusFields([]);
      return;
    }
    if (!graph) return;
    const valid = aiFocusFields.fields.filter((item) => {
      const dataset = graph.datasets.find((d) => d.id === item.dataset);
      return Boolean(dataset?.fields.some((f) => f.name === item.field));
    });
    if (valid.length === 0) return;
    const nextFocus = valid.map((item) => ({
      datasetId: item.dataset,
      fieldName: item.field,
    }));
    const nextChain = computeFieldChain(graph, derivedLinks, nextFocus);
    if (!nextChain) return;
    revealChainFields(nextChain);
    setFocusFields(nextFocus);
  }, [aiFocusFields, graph, derivedLinks, revealChainFields]);

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
        onNotice(t('canvas.noticeSameFieldOrNode'));
        return;
      }
      const sourceIsTable = sourceHandle === TABLE_SOURCE_HANDLE;
      const targetIsTable = targetHandle === TABLE_TARGET_HANDLE;
      if (sourceIsTable !== targetIsTable) {
        onNotice(t('canvas.noticeMixedLevel'));
        return;
      }

      const fromField = sourceIsTable
        ? null
        : parseFieldHandle(sourceHandle, 'field:out:');
      const toField = targetIsTable
        ? null
        : parseFieldHandle(targetHandle, 'field:in:');
      if (!sourceIsTable && (!fromField || !toField)) {
        onNotice(t('canvas.noticeHandleUnrecognized'));
        return;
      }
      if (source === target && sourceIsTable) {
        onNotice(t('canvas.noticeSameDataset'));
        return;
      }
      if (source === target && fromField !== null && fromField === toField) {
        onNotice(t('canvas.noticeSameField'));
        return;
      }

      onConnectRequest({
        from_dataset: source,
        from_field: fromField,
        to_dataset: target,
        to_field: toField,
      });
    },
    [onConnectRequest, onNotice, t],
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

    // 02 §七#32：纯展示派生——字段是任一 AI 候选边端点时，字段行渲染 sparkles 徽标。
    // 不改变任何边构建/选择逻辑。
    const aiEndpointFields = new Map<string, Set<string>>();
    graph.edges.forEach((edge) => {
      if (edge.source !== 'ai') return;
      if (edge.from_field) {
        const names = aiEndpointFields.get(edge.from_dataset) ?? new Set<string>();
        names.add(edge.from_field);
        aiEndpointFields.set(edge.from_dataset, names);
      }
      if (edge.to_field) {
        const names = aiEndpointFields.get(edge.to_dataset) ?? new Set<string>();
        names.add(edge.to_field);
        aiEndpointFields.set(edge.to_dataset, names);
      }
    });

    // 追踪链路命中的字段：按数据集聚合，驱动节点内字段行红色高亮
    const chainByDataset = new Map<
      string,
      { focused: string[]; linked: string[] }
    >();
    if (chain) {
      chain.nodes.forEach((node) => {
        const entry =
          chainByDataset.get(node.datasetId) ?? { focused: [], linked: [] };
        if (node.role === 'focus') entry.focused.push(node.fieldName);
        else entry.linked.push(node.fieldName);
        chainByDataset.set(node.datasetId, entry);
      });
    }

    const nextNodes: FlowNode[] = [];
    graph.datasets.forEach((dataset) => {
      if (hiddenIds.has(dataset.id)) return;
      const position = positionOf(dataset.id);
      const aiFields = aiEndpointFields.get(dataset.id);
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
          aiEndpointFields: aiFields ? Array.from(aiFields) : [],
          chainFieldNames: chainByDataset.get(dataset.id)?.linked ?? [],
          focusedFieldNames: chainByDataset.get(dataset.id)?.focused ?? [],
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
      focusState?: 'chain' | 'dim',
    ): LineageEdgeData => ({
      edge,
      kind,
      fromLabel,
      toLabel,
      focusState,
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
          chain ? 'dim' : undefined,
        );
        nextEdges.push({
          id: `edge-${edge.id}-table`,
          source: edge.from_dataset,
          target: edge.to_dataset,
          sourceHandle: TABLE_SOURCE_HANDLE,
          targetHandle: TABLE_TARGET_HANDLE,
          type: 'lineage',
          data,
          ariaLabel: t('canvas.ariaTableEdge', {
            from: edge.from_dataset,
            to: edge.to_dataset,
            source: edge.source,
          }),
          style: {
            stroke: visual.color,
            strokeWidth: visual.width,
            strokeDasharray: visual.dash,
            opacity: chain ? DIMMED_OPACITY : 0.92,
          },
          animated: visual.isAi,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: chain
              ? withAlpha(visual.color, DIMMED_MARKER_ALPHA)
              : visual.color,
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
      const focusState = chain
        ? chain.edgeIds.has(edge.id)
          ? 'chain'
          : 'dim'
        : undefined;
      const strokeColor =
        focusState === 'chain' ? EDGE_COLORS.focus : visual.color;
      const data = edgeData(
        edge,
        'field',
        `${edge.from_dataset}.${fromField}`,
        `${edge.to_dataset}.${toField}`,
        focusState,
      );
      nextEdges.push({
        id: `edge-${edge.id}-field`,
        source: edge.from_dataset,
        target: edge.to_dataset,
        sourceHandle: fieldSourceHandle(fromField),
        targetHandle: fieldTargetHandle(toField),
        type: 'lineage',
        data,
        ariaLabel: t('canvas.ariaFieldEdge', {
          from: `${edge.from_dataset}.${fromField}`,
          to: `${edge.to_dataset}.${toField}`,
          source: edge.source,
        }),
        style: {
          stroke: strokeColor,
          strokeWidth: focusState === 'chain' ? 2.6 : visual.width,
          strokeDasharray: visual.dash,
          opacity:
            focusState === 'chain'
              ? 1
              : focusState === 'dim'
                ? DIMMED_OPACITY
                : 0.95,
        },
        animated: focusState === 'chain' ? true : visual.isAi,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color:
            focusState === 'dim'
              ? withAlpha(visual.color, DIMMED_MARKER_ALPHA)
              : strokeColor,
          width: 15,
          height: 15,
        },
        zIndex: focusState === 'chain' ? 2 : 0,
        selectable: true,
        focusable: false,
      });
    });

    // 视图派生连线：表级血缘两端同名字段匹配（非库内边，不可选中/编辑）
    derivedLinks.forEach((link) => {
      if (!present.has(link.from_dataset) || !present.has(link.to_dataset)) {
        return;
      }
      // 分组内/跨组时推导线不画：跨组关系已由聚合边表达
      if (
        datasetGroups.has(link.from_dataset) ||
        datasetGroups.has(link.to_dataset)
      ) {
        return;
      }
      if (
        collapsedIds.has(link.from_dataset) ||
        collapsedIds.has(link.to_dataset)
      ) {
        return;
      }
      if (
        !fieldNames.get(link.from_dataset)?.has(link.from_field) ||
        !fieldNames.get(link.to_dataset)?.has(link.to_field)
      ) {
        return;
      }

      const key = derivedLinkKey(link);
      const focusState = chain
        ? chain.linkKeys.has(key)
          ? 'chain'
          : 'dim'
        : undefined;
      const strokeColor =
        focusState === 'chain' ? EDGE_COLORS.focus : EDGE_COLORS.derived;
      nextEdges.push({
        id: `edge-derived-${key}`,
        source: link.from_dataset,
        target: link.to_dataset,
        sourceHandle: fieldSourceHandle(link.from_field),
        targetHandle: fieldTargetHandle(link.to_field),
        type: 'lineage',
        data: {
          kind: 'field',
          derived: true,
          focusState,
          fromLabel: `${link.from_dataset}.${link.from_field}`,
          toLabel: `${link.to_dataset}.${link.to_field}`,
        },
        ariaLabel: t('canvas.ariaDerivedEdge', {
          from: `${link.from_dataset}.${link.from_field}`,
          to: `${link.to_dataset}.${link.to_field}`,
        }),
        style: {
          stroke: strokeColor,
          strokeWidth: focusState === 'chain' ? 2.6 : 1.3,
          strokeDasharray: '2 4',
          opacity:
            focusState === 'chain'
              ? 1
              : focusState === 'dim'
                ? DIMMED_OPACITY
                : 0.9,
        },
        animated: focusState === 'chain',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color:
            focusState === 'dim'
              ? withAlpha(EDGE_COLORS.derived, DIMMED_MARKER_ALPHA)
              : strokeColor,
          width: 13,
          height: 13,
        },
        zIndex: focusState === 'chain' ? 2 : 0,
        selectable: false,
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
        focusState: chain ? 'dim' : undefined,
      };
      nextEdges.push({
        id: `edge-agg-${encodeURIComponent(aggregate.sourceNode)}-${encodeURIComponent(aggregate.targetNode)}`,
        source: aggregate.sourceNode,
        target: aggregate.targetNode,
        sourceHandle: TABLE_SOURCE_HANDLE,
        targetHandle: TABLE_TARGET_HANDLE,
        type: 'lineage',
        data,
        ariaLabel: t('canvas.ariaAggregateEdge', {
          from: aggregate.sourceLabel,
          to: aggregate.targetLabel,
          count: aggregate.count,
        }),
        style: {
          stroke: visual.color,
          strokeWidth: 1.5,
          strokeDasharray: visual.dash ?? '5 4',
          opacity: chain ? DIMMED_OPACITY : 0.85,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: chain
            ? withAlpha(visual.color, DIMMED_MARKER_ALPHA)
            : visual.color,
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
    chain,
    derivedLinks,
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
    t,
  ]);

  useEffect(() => {
    if (!flowInstance || !graph || graph.datasets.length === 0) return;
    const timer = window.setTimeout(() => {
      void flowInstance.fitView({
        padding: 0.18,
        duration: 300,
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
      <div className="relative flex h-full min-h-[560px] items-center justify-center overflow-hidden bg-page bg-dot-grid bg-grid-24">
        <div className="relative mx-6 max-w-sm rounded-2xl border border-dashed border-line-strong bg-card/75 px-8 py-9 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-600">
            <Icon name="network" size={22} />
          </div>
          <h2 className="mt-4 text-xl font-medium text-ink">
            {t('canvas.emptyTitle')}
          </h2>
          <p className="mt-2 text-[13px] leading-5 text-ink-muted">
            {t('canvas.emptyHint')}
          </p>
        </div>
      </div>
    );
  }

  const groupableCount = selectedNodeIds.length;
  const hasGroupControls = groupableCount >= 2 || groups.length > 0;

  return (
    <div className="relative h-full min-h-[560px] bg-page bg-dot-grid bg-grid-24">
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
          onPaneClick={handlePaneClick}
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
          aria-label={t('canvas.ariaCanvas')}
        >
          <Controls
            position="bottom-left"
            showInteractive={false}
            className="lineage-controls"
          />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) => (node.id === seedDatasetId ? '#EA580C' : '#CBD5E1')}
            nodeStrokeColor="#FFFFFF"
            nodeBorderRadius={4}
            maskColor="rgba(248, 250, 252, 0.65)"
            className="lineage-minimap"
            ariaLabel={t('canvas.ariaMinimap')}
          />

          <Panel position="top-left" className="!m-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-1.5 pr-2 shadow-float">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <Icon name="network" size={14} />
                </span>
                <div className="px-0.5">
                  <div className="max-w-[140px] truncate text-[13px] font-medium text-ink">
                    {seedName || t('canvas.subgraphFallback')}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink-faint">
                    {t('canvas.subgraphStats', {
                      datasets: graph.datasets.length,
                      edges: graph.edges.length,
                    })}
                  </div>
                </div>
                <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
                <button
                  type="button"
                  onClick={onToggleAll}
                  className="flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1"
                  title={
                    allCollapsed
                      ? t('canvas.expandAllFieldsTitle')
                      : t('canvas.collapseAllFieldsTitle')
                  }
                >
                  <Icon
                    name={allCollapsed ? 'unfold-all' : 'fold-all'}
                    size={12}
                  />
                  {allCollapsed ? t('canvas.expandAll') : t('canvas.collapseAll')}
                </button>
              </div>

              {hasGroupControls && (
                <div className="flex animate-fade-in flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-1.5 pr-2 shadow-float">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line-soft bg-subtle text-ink-muted">
                    <Icon name="group" size={14} />
                  </span>
                  {groupableCount >= 2 && (
                    <button
                      type="button"
                      onClick={handleCollapseSelected}
                      className="flex h-7 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-[12px] font-medium text-brand-800 transition-colors duration-150 hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1"
                      title={t('canvas.groupSelectedTitle')}
                    >
                      <Icon name="fold-all" size={12} />
                      {t('canvas.groupSelected', { count: groupableCount })}
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
                      className="flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1"
                    >
                      <Icon name="unfold-all" size={12} />
                      {t('canvas.expandAllGroups', { count: groups.length })}
                    </button>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <Panel position="bottom-center" className="!mb-2 hidden md:block">
            <div className="flex items-center gap-2.5 rounded-full border border-line bg-card/90 px-3 py-1.5 font-mono text-[11px] text-ink-muted shadow-float">
              <span>{t('canvas.hintPan')}</span>
              <span className="h-2 w-px bg-line" />
              <span>{t('canvas.hintBoxSelect')}</span>
              <span className="h-2 w-px bg-line" />
              <span>{t('canvas.hintEdgeDetails')}</span>
              <span className="h-2 w-px bg-line" />
              <span>{t('canvas.hintFieldTrace')}</span>
              {canEdit && (
                <>
                  <span className="h-2 w-px bg-line" />
                  <span>{t('canvas.hintCreateEdge')}</span>
                </>
              )}
            </div>
          </Panel>
        </ReactFlow>
      )}

      {loading && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-page/60"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-card px-4 py-3 shadow-float">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            <div>
              <div className="text-[13px] font-medium text-ink">{t('canvas.loadingTitle')}</div>
              <div className="mt-0.5 font-mono text-[11px] text-ink-faint">
                {t('canvas.loadingDetail', { seed: seedDatasetId ?? '', hops })}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-page/60 p-5">
          <div
            className="w-full max-w-sm rounded-xl border border-line bg-card p-5 shadow-float"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger-deep">
                <Icon name="warning" size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[13px] font-semibold text-ink">
                  {t('canvas.errorTitle')}
                </h2>
                <p className="mt-1.5 break-words text-[12px] leading-5 text-ink-muted">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand-700 px-2.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1"
                >
                  <Icon name="refresh" size={12} />
                  {t('canvas.reload')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
