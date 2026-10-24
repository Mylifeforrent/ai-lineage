import type { DatasetSummary, LineageGraph } from '../types';
import { formatCount } from '../lib/format';
import { EDGE_COLORS } from '../lib/edgeColors';
import { Icon } from './Icon';
import { SourceBadge } from './SourceBadge';

interface DatasetSidebarProps {
  datasets: DatasetSummary[];
  visibleDatasets: DatasetSummary[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  search: string;
  hops: number;
  graph: LineageGraph | null;
  minConfidence: number;
  hideAiEdges: boolean;
  confirmedOnly: boolean;
  onMinConfidenceChange: (value: number) => void;
  onHideAiEdgesChange: (value: boolean) => void;
  onConfirmedOnlyChange: (value: boolean) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onClearSearch: () => void;
}

const CONFIDENCE_OPTIONS = [
  { value: 0, label: '不限置信度' },
  { value: 0.6, label: '置信度 ≥ 0.6' },
  { value: 0.8, label: '置信度 ≥ 0.8' },
  { value: 1, label: '置信度 = 1.0' },
];

/** 图例线样与 getEdgeVisual 完全同参（00 §2.4，色值走 lib/edgeColors 单一来源） */
const LEGEND_LINE_VISUALS = {
  field: { stroke: EDGE_COLORS.imported, width: 1.55, dash: undefined },
  table: { stroke: EDGE_COLORS.importedWeak, width: 1.4, dash: '4 5' },
  ai: { stroke: EDGE_COLORS.ai, width: 1.8, dash: '6 5' },
  derived: { stroke: EDGE_COLORS.derived, width: 1.3, dash: '2 4' },
  focus: { stroke: EDGE_COLORS.focus, width: 2.6, dash: undefined },
} as const;

function EdgeLegendLine({ variant }: { variant: keyof typeof LEGEND_LINE_VISUALS }) {
  const visual = LEGEND_LINE_VISUALS[variant];
  return (
    <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden="true">
      <line
        x1="1"
        y1="4"
        x2="27"
        y2="4"
        stroke={visual.stroke}
        strokeWidth={visual.width}
        strokeDasharray={visual.dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

function DatasetSkeleton() {
  return (
    <div className="space-y-1.5" aria-hidden="true">
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="animate-soft-pulse rounded-lg border border-line-soft bg-subtle px-3 py-2.5"
        >
          <div className="h-2.5 w-2/3 rounded bg-line" />
          <div className="mt-2 h-2 w-1/3 rounded bg-line-soft" />
        </div>
      ))}
    </div>
  );
}

export function DatasetSidebar({
  datasets,
  visibleDatasets,
  selectedId,
  loading,
  error,
  search,
  hops,
  graph,
  minConfidence,
  hideAiEdges,
  confirmedOnly,
  onMinConfidenceChange,
  onHideAiEdgesChange,
  onConfirmedOnlyChange,
  onSelect,
  onRetry,
  onClearSearch,
}: DatasetSidebarProps) {
  return (
    <aside className="flex max-h-[46vh] w-full shrink-0 flex-col border-b border-line bg-card xl:h-full xl:max-h-none xl:w-[240px] xl:border-b-0 xl:border-r">
      <div className="border-b border-line-soft px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              数据资产
            </div>
            <h2 className="mt-0.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
              数据集
              <span className="rounded-full border border-line bg-card px-1.5 font-mono text-[11px] font-medium tabular-nums text-ink-muted">
                {formatCount(datasets.length)}
              </span>
            </h2>
          </div>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-card text-ink-faint">
            <Icon name="database" size={14} />
          </span>
        </div>
        {search && (
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-muted">
            <Icon name="search" size={11} />
            <span>
              匹配 <span className="font-mono tabular-nums text-ink">{visibleDatasets.length}</span>{' '}
              个结果
            </span>
          </div>
        )}
        <div className="mt-2 text-[12px] leading-4 text-ink-faint">
          选择数据集作为种子，加载 ±{hops} 跳子图
        </div>
      </div>

      <div className="border-b border-line-soft px-4 py-3">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          过滤
        </div>
        <label className="mt-2 flex items-center justify-between gap-2 text-[12px] text-ink-muted">
          <span className="shrink-0">连线</span>
          <span className="relative min-w-0 flex-1">
            <select
              value={minConfidence}
              onChange={(event) =>
                onMinConfidenceChange(Number(event.target.value))
              }
              className="field-input h-8 appearance-none rounded-md pr-8 text-[12px]"
              aria-label="置信度过滤"
            >
              {CONFIDENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Icon
              name="chevron-down"
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            />
          </span>
        </label>
        <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-muted">
          <input
            type="checkbox"
            checked={hideAiEdges}
            onChange={(event) => onHideAiEdgesChange(event.target.checked)}
            className="h-3 w-3 rounded border-line accent-brand-600"
          />
          隐藏 AI 建议边
        </label>
        <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-muted">
          <input
            type="checkbox"
            checked={confirmedOnly}
            onChange={(event) => onConfirmedOnlyChange(event.target.checked)}
            className="h-3 w-3 rounded border-line accent-brand-600"
          />
          仅显示确认血缘
        </label>
        <p className="mt-1.5 text-[11px] leading-4 text-ink-muted">
          AI 建议（source=ai）需人工确认后才计入确认血缘。
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5 xl:px-2.5">
        {loading && <DatasetSkeleton />}

        {!loading && error && (
          <div className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-3">
            <div className="flex items-start gap-2">
              <Icon
                name="warning"
                size={14}
                className="mt-0.5 shrink-0 text-danger"
              />
              <div>
                <div className="text-[13px] font-medium text-danger-deep">
                  数据集加载失败
                </div>
                <p className="mt-1 text-[12px] leading-4 text-danger-deep">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2 inline-flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1"
                >
                  <Icon name="refresh" size={12} />
                  重试
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && visibleDatasets.length === 0 && (
          <div className="px-2 py-8 text-center">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-faint">
              <Icon name={search ? 'search' : 'database'} size={16} />
            </div>
            <p className="mt-2.5 text-[13px] font-medium text-ink-soft">
              {search ? '没有匹配的数据集' : '当前还没有数据集'}
            </p>
            {search && (
              <button
                type="button"
                onClick={onClearSearch}
                className="mt-2 text-[12px] font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
              >
                清空搜索
              </button>
            )}
          </div>
        )}

        {!loading && !error && visibleDatasets.length > 0 && (
          <ul className="space-y-1" aria-label="数据集列表">
            {visibleDatasets.map((dataset, index) => {
              const active = dataset.id === selectedId;
              return (
                <li
                  key={dataset.id}
                  className="animate-fade-up"
                  style={{ animationDelay: `${Math.min(index * 24, 240)}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(dataset.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`group relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left transition-colors duration-150 hover:border-line hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 ${
                      active
                        ? 'border-brand-100 bg-brand-50'
                        : 'border-transparent'
                    }`}
                  >
                    <span
                      className={`absolute inset-y-2 left-0 w-[2.5px] rounded-r-full transition-all duration-150 ${
                        active
                          ? 'bg-brand-600 opacity-100'
                          : 'bg-brand-400 opacity-0 group-hover:opacity-45'
                      }`}
                      aria-hidden="true"
                    />
                    <div className="flex items-center justify-between gap-2 pl-1">
                      <span
                        className={`min-w-0 truncate text-[13px] font-medium ${
                          active ? 'text-brand-800' : 'text-ink'
                        }`}
                        title={dataset.name}
                      >
                        {dataset.name || dataset.id}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
                        {formatCount(dataset.field_count)} 字段
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 pl-1">
                      <span
                        className={`truncate font-mono text-[11px] ${
                          active ? 'text-brand-700' : 'text-ink-faint'
                        }`}
                        title={dataset.id}
                      >
                        {dataset.id}
                      </span>
                      {active && (
                        <span className="shrink-0 rounded bg-brand-100 px-1.5 py-px font-mono text-[11px] uppercase text-brand-800">
                          种子
                        </span>
                      )}
                      <Icon
                        name="chevron-right"
                        size={12}
                        className={`ml-auto shrink-0 transition-all duration-150 ${
                          active
                            ? 'text-brand-500'
                            : '-translate-x-1 text-ink-faint opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                        }`}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-line-soft px-4 py-3.5">
        {graph && (
          <div className="mb-3.5 rounded-lg border border-line bg-subtle/60 px-2.5 py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                当前子图
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
            </div>
            <div className="mt-1.5 flex items-center gap-3 font-mono text-[12px] tabular-nums text-ink-soft">
              <span>
                <span className="font-medium text-ink">{graph.datasets.length}</span>{' '}
                数据集
              </span>
              <span className="h-3 w-px bg-line" />
              <span>
                <span className="font-medium text-ink">{graph.edges.length}</span>{' '}
                条连线
              </span>
            </div>
          </div>
        )}

        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          连线图例
        </div>
        <div className="mt-2 space-y-1.5 text-[12px] text-ink-muted">
          <div className="flex items-center gap-2">
            <EdgeLegendLine variant="field" />
            <span>字段级血缘</span>
          </div>
          <div className="flex items-center gap-2">
            <EdgeLegendLine variant="table" />
            <span>表级血缘</span>
          </div>
          <div className="flex items-center gap-2">
            <EdgeLegendLine variant="derived" />
            <span>同名字段匹配（推断）</span>
          </div>
          <div className="flex items-center gap-2">
            <EdgeLegendLine variant="focus" />
            <span className="text-brand-700">点击字段的追踪链路</span>
          </div>
          <div className="flex items-center gap-2">
            <EdgeLegendLine variant="ai" />
            <span className="text-ai-deep">AI 建议 · 待确认</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          <SourceBadge source="imported" withDescription={false} />
          <SourceBadge source="manual" withDescription={false} />
          <SourceBadge source="ai" withDescription={false} />
        </div>
        <p className="mt-2.5 text-[11px] leading-4 text-ink-muted">
          悬停连线查看转换说明、置信度与来源。
        </p>
      </div>
    </aside>
  );
}
