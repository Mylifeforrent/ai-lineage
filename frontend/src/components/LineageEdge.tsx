import { useEffect, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import type { LineageEdge } from '../types';
import { formatConfidence } from '../lib/format';
import { SourceBadge } from './SourceBadge';
import { Icon } from './Icon';

export type EdgeKind = 'field' | 'table';

export interface LineageEdgeData extends Record<string, unknown> {
  edge: LineageEdge;
  kind: EdgeKind;
  fromLabel: string;
  toLabel: string;
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
    return { color: '#2f64d8', dash: '6 5', width: 1.8, isAi };
  }
  if (isManual) {
    return {
      color: '#a36b11',
      dash: isTable ? '4 5' : undefined,
      width: 1.7,
      isAi,
    };
  }
  return {
    color: isTable ? '#8b958f' : '#52645c',
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

  const { edge, kind, fromLabel, toLabel } = edgeData;
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
        style={{ pointerEvents: 'stroke', cursor: 'default' }}
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
          strokeWidth: hovered ? (edge.source === 'ai' ? 2.8 : 2.4) : undefined,
          filter: hovered ? 'drop-shadow(0 1px 1px rgba(27,42,37,0.14))' : undefined,
          transition: 'stroke-width 150ms ease, opacity 150ms ease',
        }}
      />
      {hovered && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute z-50 w-[268px]"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onMouseEnter={show}
            onMouseLeave={hide}
            role="tooltip"
          >
            <div className="edge-tooltip animate-fade-in rounded-xl border border-line bg-surface/98 p-3 text-left shadow-float backdrop-blur-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-ink-faint">
                  {kind === 'field' ? '字段级血缘' : '表级血缘'}
                </span>
                <SourceBadge source={edge.source} withDescription={false} />
              </div>
              <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] leading-4 text-ink">
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
              <div className="mt-2.5 grid grid-cols-[48px_1fr] gap-x-2 gap-y-1.5 border-t border-line-soft pt-2.5 text-[10px]">
                <span className="text-ink-faint">转换</span>
                <span className="break-words font-mono text-[9.5px] leading-4 text-ink-soft">
                  {edge.transform || '未填写'}
                </span>
                <span className="text-ink-faint">置信度</span>
                <span className="font-mono text-[9.5px] tabular-nums text-ink-soft">
                  {formatConfidence(edge.confidence)}
                </span>
                <span className="text-ink-faint">来源</span>
                <span className="font-mono text-[9.5px] text-ink-soft">
                  {edge.source || '未登记'}
                </span>
              </div>
              {edge.note && (
                <p className="mt-2 border-t border-line-soft pt-2 text-[9.5px] leading-4 text-ink-muted">
                  {edge.note}
                </p>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
