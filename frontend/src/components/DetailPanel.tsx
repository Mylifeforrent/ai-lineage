import { useState } from 'react';
import type { FieldSelection, LineageEdge, LineageGraph } from '../types';
import {
  formatConfidence,
  humanizeLocator,
  locatorTypeLabel,
} from '../lib/format';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { SourceBadge } from './SourceBadge';

interface DetailPanelProps {
  selection: FieldSelection | null;
  graph: LineageGraph | null;
  onClose: () => void;
  onPreview: (selection: FieldSelection) => void;
}

const DETAIL_HINTS: Array<[string, string, IconName]> = [
  ['定位器', 'sheet / 行列 / JSONPath', 'code'],
  ['来源徽章', 'imported · manual · ai', 'link'],
  ['回源预览', 'CSV / XLSX / JSON', 'file-search'],
];

function FileTypeBadge({ type }: { type: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line bg-canvas/65 px-1.5 py-[2px] font-mono text-[8.5px] uppercase tracking-[0.08em] text-ink-muted">
      <Icon name="file" size={10} />
      {locatorTypeLabel(type)}
    </span>
  );
}

function EmptyDetail() {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-5 py-8">
      <div className="mx-auto w-full max-w-[248px] text-center">
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-canvas/65 text-pine-600">
          <Icon name="file-search" size={25} />
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface font-mono text-[8px] text-ink-faint">
            1
          </span>
        </div>
        <h2 className="mt-4 font-display text-[25px] font-medium tracking-[-0.025em] text-ink">
          核对字段的来源
        </h2>
        <p className="mt-2 text-[11px] leading-5 text-ink-muted">
          点击画布节点中的任意字段，查看字段属性、人类可读定位与上游血缘，
          并直接打开源文件区域预览。
        </p>
      </div>

      <div className="mx-auto mt-7 w-full max-w-[262px] space-y-2">
        {DETAIL_HINTS.map(([title, detail, icon], index) => (
          <div
            key={title}
            className="flex items-center gap-2.5 rounded-xl border border-line-soft bg-surface/55 px-3 py-2.5"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line-soft bg-canvas/55 text-ink-faint">
              <Icon name={icon} size={13} />
            </span>
            <div className="min-w-0">
              <div className="text-[10.5px] font-medium text-ink-soft">{title}</div>
              <div className="mt-0.5 font-mono text-[8.5px] text-ink-faint">
                {detail}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-7 flex max-w-[262px] items-start gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-[9.5px] leading-4 text-ink-faint">
        <Icon name="info" size={12} className="mt-0.5 shrink-0" />
        悬停画布上的连线可查看转换说明、置信度与来源。
      </div>
    </div>
  );
}

function IncomingEdgeCard({ edge }: { edge: LineageEdge }) {
  return (
    <div className="rounded-xl border border-line-soft bg-surface/75 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] leading-4 text-ink-soft">
            <span className="text-ink-faint">{edge.from_dataset}.</span>
            <span className="font-medium text-pine-800">{edge.from_field}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[8.5px] text-ink-faint">
            <span>置信度</span>
            <span className="tabular-nums text-ink-soft">
              {formatConfidence(edge.confidence)}
            </span>
            <span className="text-line-strong">·</span>
            <span>字段级</span>
          </div>
        </div>
        <SourceBadge source={edge.source} withDescription={false} />
      </div>
      <div className="mt-2 border-t border-line-soft pt-2">
        <div className="font-mono text-[9px] leading-4 text-ink-muted">
          <span className="text-ink-faint">转换 · </span>
          {edge.transform || '未填写'}
        </div>
        {edge.note && (
          <p className="mt-1 text-[9.5px] leading-4 text-ink-faint">{edge.note}</p>
        )}
      </div>
    </div>
  );
}

export function DetailPanel({
  selection,
  graph,
  onClose,
  onPreview,
}: DetailPanelProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  if (!selection) {
    return (
      <aside className="relative z-10 flex w-full shrink-0 flex-col border-t border-line bg-[#f8f5ed]/70 xl:h-full xl:w-[340px] xl:border-l xl:border-t-0">
        <div className="border-b border-line-soft px-4 py-4">
          <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
            检查器
          </div>
          <h2 className="mt-0.5 text-[12px] font-semibold text-ink">字段详情</h2>
        </div>
        <EmptyDetail />
      </aside>
    );
  }

  const { dataset, field } = selection;
  const incomingEdges =
    graph?.edges.filter(
      (edge) =>
        edge.to_dataset === dataset.id &&
        edge.to_field === field.name &&
        edge.from_field !== null,
    ) ?? [];
  const locatorText = humanizeLocator(field.src_locator);
  const rawLocator = JSON.stringify(field.src_locator, null, 2);
  // 字段本身由源文件导入；若有上游字段级边，则优先展示该边的 source。
  const fieldSource = incomingEdges[0]?.source ?? 'imported';

  async function copyLocator() {
    const value = `${field.source_file.original_name} · ${locatorText}`;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError(true);
      window.setTimeout(() => setCopyError(false), 1800);
    }
  }

  return (
    <aside
      className="relative z-10 flex w-full shrink-0 flex-col border-t border-line bg-[#f8f5ed]/80 xl:h-full xl:w-[340px] xl:border-l xl:border-t-0"
      aria-label="字段详情"
    >
      <div className="flex shrink-0 items-start justify-between border-b border-line-soft px-4 py-3.5">
        <div className="min-w-0">
          <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
            字段检查
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[9px] text-ink-muted">
            <Icon name="database" size={10} className="shrink-0" />
            <span className="truncate">{dataset.id}</span>
            <Icon name="chevron-right" size={9} className="shrink-0" />
            <span className="truncate text-pine-700">{field.name}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-surface hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
          aria-label="关闭字段详情"
          title="关闭字段详情"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-7">
        <div className="animate-fade-in">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-line bg-surface/80 px-1.5 py-[2px] font-mono text-[8.5px] uppercase tracking-[0.08em] text-ink-muted">
              {field.field_type || '类型未登记'}
            </span>
            <FileTypeBadge type={field.src_locator.type} />
            <SourceBadge source={fieldSource} />
          </div>
          <h2 className="mt-2.5 break-all font-mono text-[22px] font-semibold leading-[1.2] tracking-[-0.035em] text-ink">
            {field.name}
          </h2>
          <p className="mt-1.5 text-[11px] leading-5 text-ink-muted">
            {field.description || '暂无字段描述'}
          </p>
        </div>

        <div className="mt-5 rounded-xl border border-line bg-surface/75">
          <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <Icon name="file" size={12} className="text-pine-600" />
            <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-ink-faint">
              源文件
            </span>
          </div>
          <div className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span
                className="min-w-0 truncate font-mono text-[10.5px] font-medium text-ink"
                title={field.source_file.original_name}
              >
                {field.source_file.original_name}
              </span>
              <span className="shrink-0 rounded border border-pine-200 bg-pine-50 px-1.5 py-[1px] font-mono text-[8px] text-pine-700">
                托管文件
              </span>
            </div>
            <div className="mt-1 font-mono text-[8.5px] text-ink-faint">
              源文件 #{field.source_file.id}
            </div>
          </div>
        </div>

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
              源文件定位
            </h3>
            <span className="rounded-full border border-line bg-canvas/55 px-1.5 py-[1px] font-mono text-[8px] text-ink-faint">
              可读定位
            </span>
          </div>
          <div className="rounded-xl border border-pine-100 bg-pine-50/55 p-3">
            <p className="text-[11px] leading-[1.75] text-pine-900">
              {locatorText}
            </p>
            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-pine-100 pt-2">
              <span className="font-mono text-[8px] text-pine-700/70">
                定位器信封 · {field.src_locator.type || '未知'}
              </span>
              <button
                type="button"
                onClick={copyLocator}
                className="flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[8.5px] text-pine-700 transition-colors hover:bg-pine-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              >
                <Icon name="copy" size={10} />
                {copied ? '已复制' : copyError ? '复制失败' : '复制定位'}
              </button>
            </div>
          </div>
        </section>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onPreview(selection)}
            className="col-span-2 flex h-10 items-center justify-center gap-2 rounded-xl bg-pine-800 text-[11.5px] font-semibold text-white shadow-[0_8px_20px_-12px_rgba(19,54,46,0.8)] transition-all hover:bg-pine-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500 focus-visible:ring-offset-2"
          >
            <Icon name="file-search" size={15} />
            回源预览
          </button>
          <div className="col-span-2 flex items-center justify-center gap-1.5 text-[9px] text-ink-faint">
            <Icon name="lock" size={10} />
            只读预览 · 由当前定位器实时解析源文件
          </div>
        </div>

        <section className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
              上游血缘
            </h3>
            <span className="font-mono text-[8.5px] tabular-nums text-ink-faint">
              {incomingEdges.length} 条字段级边
            </span>
          </div>
          {incomingEdges.length > 0 ? (
            <div className="space-y-2">
              {incomingEdges.map((edge, index) => (
                <IncomingEdgeCard
                  key={`${edge.from_dataset}-${edge.from_field}-${index}`}
                  edge={edge}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-line px-3 py-3 text-center">
              <div className="font-mono text-[9.5px] text-ink-muted">
                根字段 / 无字段级入边
              </div>
              <p className="mt-1 text-[9px] leading-4 text-ink-faint">
                该字段可能是链路起点，或仅由表级血缘覆盖。
              </p>
            </div>
          )}
        </section>

        <details className="group mt-5 rounded-xl border border-line-soft bg-surface/45">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[9.5px] font-medium text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-pine-500/30">
            查看原始定位器
            <Icon
              name="chevron-down"
              size={12}
              className="text-ink-faint transition-transform group-open:rotate-180"
            />
          </summary>
          <pre className="max-h-52 overflow-auto border-t border-line-soft px-3 py-2.5 font-mono text-[9px] leading-4 text-ink-muted">
            {rawLocator}
          </pre>
        </details>
      </div>
    </aside>
  );
}
