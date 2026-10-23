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
import type { ReactFlowInstance } from '@xyflow/react';
import type {
  DatasetField,
  LineageDataset,
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
import {
  LineageEdgeView,
  getEdgeVisual,
} from './LineageEdge';
import type { EdgeKind, LineageEdgeData, LineageFlowEdge } from './LineageEdge';
import { Icon } from './Icon';

const nodeTypes = { dataset: DatasetNode };
const edgeTypes = { lineage: LineageEdgeView };

interface LineageCanvasProps {
  graph: LineageGraph | null;
  seedDatasetId: string | null;
  hops: number;
  loading: boolean;
  error: string | null;
  collapsedIds: ReadonlySet<string>;
  fieldsExpandedIds: ReadonlySet<string>;
  onToggleCollapse: (datasetId: string) => void;
  onToggleFields: (datasetId: string) => void;
  onToggleAll: () => void;
  onSelectField: (dataset: LineageDataset, field: DatasetField) => void;
  onRetry: () => void;
}

export function LineageCanvas({
  graph,
  seedDatasetId,
  hops,
  loading,
  error,
  collapsedIds,
  fieldsExpandedIds,
  onToggleCollapse,
  onToggleFields,
  onToggleAll,
  onSelectField,
  onRetry,
}: LineageCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<DatasetFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LineageFlowEdge>([]);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<
    DatasetFlowNode,
    LineageFlowEdge
  > | null>(null);
  // 用户手动拖拽后的节点位置：折叠/刷新重建 nodes 时优先复用，避免被 dagre 重排覆盖
  const draggedPositions = useRef(new Map<string, { x: number; y: number }>());

  // 切换种子数据集时视为一张新图，清除旧的拖拽位置
  useEffect(() => {
    draggedPositions.current.clear();
  }, [seedDatasetId]);

  const handleNodeDragStop = useCallback((_: unknown, node: DatasetFlowNode) => {
    draggedPositions.current.set(node.id, { ...node.position });
  }, []);

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
    const nextNodes: DatasetFlowNode[] = graph.datasets.map((dataset) => {
      const position = positions.get(dataset.id);
      const dragged = draggedPositions.current.get(dataset.id);
      return {
        id: dataset.id,
        type: 'dataset',
        position: dragged ?? {
          x: position?.x ?? 0,
          y: position?.y ?? 0,
        },
        style: { width: NODE_WIDTH },
        data: {
          dataset,
          collapsed: collapsedIds.has(dataset.id),
          isSeed: dataset.id === seedDatasetId,
          fieldsExpanded: fieldsExpandedIds.has(dataset.id),
          onToggleCollapse,
          onToggleFields,
          onSelectField,
        },
        draggable: true,
        selectable: true,
        zIndex: dataset.id === seedDatasetId ? 4 : 1,
      };
    });

    const present = new Set(graph.datasets.map((dataset) => dataset.id));
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
    graph.edges.forEach((edge, index) => {
      if (!present.has(edge.from_dataset) || !present.has(edge.to_dataset)) {
        return;
      }

      const fromField = edge.from_field;
      const toField = edge.to_field;

      if (fromField === null || toField === null) {
        const visual = getEdgeVisual(edge);
        const data: LineageEdgeData = {
          edge,
          kind: 'table' satisfies EdgeKind,
          fromLabel: `${edge.from_dataset}.*`,
          toLabel: `${edge.to_dataset}.*`,
        };
        nextEdges.push({
          id: `edge-${index}-${edge.from_dataset}-${edge.to_dataset}-table`,
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
          selectable: false,
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
      const data: LineageEdgeData = {
        edge,
        kind: 'field' satisfies EdgeKind,
        fromLabel: `${edge.from_dataset}.${fromField}`,
        toLabel: `${edge.to_dataset}.${toField}`,
      };
      nextEdges.push({
        id: `edge-${index}-${edge.from_dataset}-${fromField}-${edge.to_dataset}-${toField}`,
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
        selectable: false,
        focusable: false,
      });
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [
    graph,
    seedDatasetId,
    collapsedIds,
    fieldsExpandedIds,
    onToggleCollapse,
    onToggleFields,
    onSelectField,
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
    // 过滤只改变边集合，不重置视口；仅在种子或子图规模变化时重新适配
  }, [flowInstance, seedDatasetId, graph?.datasets.length]);

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
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 0.95 }}
          minZoom={0.22}
          maxZoom={1.65}
          nodesConnectable={false}
          nodesFocusable
          edgesFocusable={false}
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
          </Panel>

          <Panel position="bottom-center" className="!mb-2 hidden md:block">
            <div className="flex items-center gap-2.5 rounded-full border border-line/85 bg-surface/80 px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.1em] text-ink-faint backdrop-blur-sm">
              <span>拖拽平移</span>
              <span className="h-2 w-px bg-line" />
              <span>滚轮缩放</span>
              <span className="h-2 w-px bg-line" />
              <span>悬停连线查看详情</span>
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
