import { useEffect, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import type { LineageEdge } from '../types';
import { formatConfidence } from '../lib/format';
import { EDGE_COLORS } from '../lib/edgeColors';
import { SourceBadge } from './SourceBadge';
import { Icon } from './Icon';

export type EdgeKind = 'field' | 'table';

export interface LineageEdgeData extends Record<string, unknown> {
  edge: LineageEdge;
  kind: EdgeKind;
  fromLabel: string;
  toLabel: string;
  /** 折叠分组时跨组边的聚合条数；存在时该连线不可单独操作 */
  aggregateCount?: number;
  canEdit?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export type LineageFlowEdge = Edge<LineageEdgeData, 'lineage'>;

export interface EdgeVisual {
  color: string;
  dash?: string;
  width: number;
  isAi: boolean;
}

export function getEdgeVisual(edge: LineageEdge): EdgeVisual {
  const isAi = edge.source === 'ai';
  const isManual = edge.source === 'manual';
  const isTable =
    edge.from_field === null || edge.to_field === null;

  if (isAi) {
    return { color: EDGE_COLORS.ai, dash: '6 5', width: 1.8, isAi };
  }
  if (isManual) {
    return {
      color: EDGE_COLORS.manual,
      dash: isTable ? '4 5' : undefined,
      width: 1.7,
      isAi,
    };
  }
  return {
    color: isTable ? EDGE_COLORS.importedWeak : EDGE_COLORS.imported,
    dash: isTable ? '4 5' : undefined,
    width: isTable ? 1.4 : 1.55,
    isAi,
  };
}

export function LineageEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const edgeData = data as unknown as LineageEdgeData | undefined;
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  if (!edgeData) return null;

  const {
    edge,
    kind,
    fromLabel,
    toLabel,
    aggregateCount,
    canEdit,
    onSelect,
    onEdit,
    onDelete,
  } = edgeData;
  const isAggregate =
    aggregateCount !== undefined && aggregateCount !== null && aggregateCount > 0;
  const active = hovered || Boolean(selected);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 18,
    offset: 30,
  });

  const show = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovered(true);
  };

  const hide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setHovered(false);
      hideTimer.current = null;
    }, 130);
  };

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onMouseEnter={show}
        onMouseLeave={hide}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={0}
        style={{
          ...style,
          strokeWidth: active ? (edge.source === 'ai' ? 2.8 : 2.4) : undefined,
          filter: active
            ? 'drop-shadow(0 1px 1px rgba(15,23,42,0.18))'
            : undefined,
          transition: 'stroke-width 150ms ease, opacity 150ms ease',
        }}
      />
      {active && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute z-20 w-[268px]"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onMouseEnter={show}
            onMouseLeave={hide}
            role="tooltip"
          >
            <div className="edge-tooltip animate-fade-in rounded-lg border border-line bg-card p-3 text-left shadow-float">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                  {isAggregate
                    ? `跨组聚合 · ${aggregateCount} 条边`
                    : `${kind === 'field' ? '字段级血缘' : '表级血缘'} · #${edge.id}`}
                </span>
                <SourceBadge source={edge.source} withDescription={false} />
              </div>
              <div className="mt-2 flex items-center gap-1.5 font-mono text-[12px] leading-4 text-ink">
                <span className="min-w-0 truncate" title={fromLabel}>
                  {fromLabel}
                </span>
                <Icon
                  name="arrow-right"
                  size={11}
                  className="shrink-0 text-ink-faint"
                />
                <span className="min-w-0 truncate" title={toLabel}>
                  {toLabel}
                </span>
              </div>
              <div className="mt-2.5 grid grid-cols-[48px_1fr] gap-x-2 gap-y-1.5 border-t border-line-soft pt-2.5 text-[11px]">
                <span className="text-ink-faint">转换</span>
                <span className="break-words font-mono text-[13px] leading-4 text-ink-soft">
                  {edge.transform || '未填写'}
                </span>
                <span className="text-ink-faint">置信度</span>
                <span className="font-mono text-[13px] tabular-nums text-ink-soft">
                  {formatConfidence(edge.confidence)}
                </span>
                <span className="text-ink-faint">来源</span>
                <span className="font-mono text-[13px] text-ink-soft">
                  {edge.source || '未登记'}
                </span>
              </div>
              {edge.note && (
                <p className="mt-2 border-t border-line-soft pt-2 text-[12px] leading-4 text-ink-muted">
                  {edge.note}
                </p>
              )}
              {isAggregate ? (
                <p className="mt-2 border-t border-line-soft pt-2 text-[11px] leading-4 text-ink-faint">
                  展开分组后可查看并编辑其中每一条具体血缘。
                </p>
              ) : (
                <div className="mt-2 flex items-center gap-1.5 border-t border-line-soft pt-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect?.();
                    }}
                    className="inline-flex h-7 items-center rounded-md border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-blue-400 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/60"
                  >
                    查看详情
                  </button>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit?.();
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-blue-400 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/60"
                      >
                        <Icon name="edit" size={12} />
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete?.();
                        }}
                        className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-danger/25 bg-danger-soft px-2.5 text-[12px] font-medium text-danger-deep transition-colors duration-150 hover:border-danger/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30"
                      >
                        <Icon name="trash" size={12} />
                        删除
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
