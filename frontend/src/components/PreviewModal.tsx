import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CsvPreview,
  FieldPreview,
  FieldSelection,
  JsonPreview,
  PreviewCell,
  PreviewResponse,
  XlsxPreview,
} from '../types';
import {
  ApiError,
  downloadSourceFile,
  getFieldPreview,
  isAbortError,
} from '../lib/api';
import {
  columnIndexToLabel,
  displayCell,
  formatJsonValue,
  humanizeLocator,
  locatorTypeLabel,
} from '../lib/format';
import { Icon } from './Icon';

interface PreviewModalProps {
  selection: FieldSelection;
  token: string;
  onClose: () => void;
}

interface PreviewErrorState {
  status: number;
  message: string;
}

function isCsvPreview(preview: FieldPreview): preview is CsvPreview {
  return 'header' in preview && 'rows' in preview && 'column_index' in preview;
}

function isXlsxPreview(preview: FieldPreview): preview is XlsxPreview {
  return 'header_rows' in preview && 'merged_ranges' in preview;
}

function isJsonPreview(preview: FieldPreview): preview is JsonPreview {
  return 'json_path' in preview && 'samples' in preview;
}

function PreviewShell({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-3.5 py-2.5">
        <div>
          <div className="text-[13px] font-semibold text-ink">{title}</div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-faint">
            {subtitle}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function TargetColumnBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-mono text-[11px] text-brand-800">
      <span className="h-1 w-1 rounded-full bg-brand-600" />
      高亮列 {label}
    </span>
  );
}

function CsvPreviewTable({ preview }: { preview: CsvPreview }) {
  const targetIndex = preview.column_index - 1;
  const targetHeader = preview.header[targetIndex] ?? `第 ${preview.column_index} 列`;

  return (
    <PreviewShell
      title="CSV 数据预览"
      subtitle={`${preview.rows.length} 行 · 前 50 行 · 表头 ${preview.header.length} 列`}
      right={<TargetColumnBadge label={`${columnIndexToLabel(preview.column_index)} · ${targetHeader}`} />}
    >
      <div className="max-h-[46vh] overflow-auto">
        <table className="w-full min-w-[680px] border-collapse text-left text-[13px]">
          <caption className="sr-only">
            CSV 源文件数据预览，高亮字段所在列 {targetHeader}
          </caption>
          <thead className="sticky top-0 z-10">
            <tr className="bg-subtle">
              <th className="w-12 border-b border-r border-line px-2 py-2 text-center font-mono text-[11px] font-normal text-ink-faint">
                #
              </th>
              {preview.header.map((header, index) => {
                const target = index === targetIndex;
                return (
                  <th
                    key={`${header}-${index}`}
                    scope="col"
                    className={`min-w-[118px] border-b border-r border-line px-2.5 py-2 last:border-r-0 ${
                      target ? 'bg-brand-100 text-brand-800' : 'text-ink-soft'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-normal text-ink-faint">
                        {columnIndexToLabel(index + 1)}
                      </span>
                      <span className="text-[12px] font-medium">{header || '—'}</span>
                      {target && (
                        <span className="ml-auto rounded bg-brand-700 px-1 py-px font-mono text-[11px] text-white">
                          字段
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="group border-b border-line-soft last:border-b-0 hover:bg-subtle/60"
              >
                <th
                  scope="row"
                  className="border-r border-line-soft bg-page px-2 py-1.5 text-center font-mono text-[11px] font-normal text-ink-faint"
                >
                  {rowIndex + 1}
                </th>
                {preview.header.map((_, columnIndex) => {
                  const target = columnIndex === targetIndex;
                  const value = row[columnIndex];
                  return (
                    <td
                      key={columnIndex}
                      className={`max-w-[260px] truncate border-r border-line-soft px-2.5 py-1.5 font-mono text-[12px] last:border-r-0 ${
                        target
                          ? 'bg-brand-50/80 font-medium text-ink'
                          : 'text-ink-soft'
                      }`}
                      title={displayCell(value)}
                    >
                      {displayCell(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft bg-page px-3.5 py-2 text-[11px] text-ink-muted">
        <span>
          高亮列为字段定位列 · 第 {preview.column_index} 列（
          {columnIndexToLabel(preview.column_index)}）
        </span>
        <span className="font-mono">最多显示 50 行</span>
      </div>
    </PreviewShell>
  );
}

interface ParsedRange {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
}

function columnLabelToIndex(label: string): number {
  return label
    .toUpperCase()
    .split('')
    .reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
}

function parseMergedRange(raw: string): ParsedRange | null {
  const match = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(raw.trim());
  if (!match) return null;
  return {
    minCol: columnLabelToIndex(match[1]),
    minRow: Number(match[2]),
    maxCol: columnLabelToIndex(match[3]),
    maxRow: Number(match[4]),
  };
}

interface DisplayRow {
  row: number;
  cells: PreviewCell[];
  isHeader: boolean;
}

interface MergeAnchor {
  rowSpan: number;
  colSpan: number;
  value: PreviewCell;
}

function XlsxPreviewTable({ preview }: { preview: XlsxPreview }) {
  const headerCount = preview.header_rows.length;
  const entryByRow = new Map<number, DisplayRow>();
  const displayedRows: DisplayRow[] = [];

  preview.header_rows.forEach((cells, index) => {
    const entry: DisplayRow = { row: index + 1, cells, isHeader: true };
    displayedRows.push(entry);
    entryByRow.set(entry.row, entry);
  });

  preview.rows.forEach((cells, index) => {
    const absoluteRow = preview.row_start + index;
    if (entryByRow.has(absoluteRow)) return;
    const entry: DisplayRow = { row: absoluteRow, cells, isHeader: false };
    displayedRows.push(entry);
    entryByRow.set(absoluteRow, entry);
  });

  const parsedRanges = preview.merged_ranges
    .map((raw) => parseMergedRange(raw))
    .filter((range): range is ParsedRange => Boolean(range));

  const totalCols = Math.max(
    1,
    ...preview.header_rows.map((row) => row.length),
    ...preview.rows.map((row) => row.length),
    preview.column_index,
    ...parsedRanges.map((range) => range.maxCol),
  );

  const cellAt = (row: number, column: number): PreviewCell => {
    const entry = entryByRow.get(row);
    return entry?.cells[column - 1] ?? null;
  };

  const mergeAnchors = new Map<string, MergeAnchor>();
  const covered = new Set<string>();

  parsedRanges.forEach((range) => {
    const visibleRows = displayedRows.filter(
      (row) => row.row >= range.minRow && row.row <= range.maxRow,
    );
    if (!visibleRows.length) return;
    const anchorRow = visibleRows[0].row;
    const anchorCol = Math.max(1, Math.min(range.minCol, totalCols));
    if (anchorCol > totalCols || range.maxCol < anchorCol) return;
    const endCol = Math.min(range.maxCol, totalCols);
    const colSpan = endCol - anchorCol + 1;
    const rowSpan = visibleRows.length;
    if (colSpan === 1 && rowSpan === 1) return;

    mergeAnchors.set(`${anchorRow}:${anchorCol}`, {
      rowSpan,
      colSpan,
      value: cellAt(range.minRow, range.minCol),
    });

    visibleRows.forEach((row) => {
      for (let column = anchorCol; column <= endCol; column += 1) {
        if (row.row === anchorRow && column === anchorCol) continue;
        covered.add(`${row.row}:${column}`);
      }
    });
  });

  const mergedPreview = preview.merged_ranges.slice(0, 4);
  const rowEndLabel = preview.row_end >= preview.row_start
    ? `数据行 ${preview.row_start}:${preview.row_end}`
    : `数据行 ${preview.row_start} 起`;
  const targetLabel = columnIndexToLabel(preview.column_index);

  return (
    <PreviewShell
      title={`工作表「${preview.sheet}」`}
      subtitle={`${headerCount} 行表头 · ${rowEndLabel} · 当前预览 ${preview.rows.length} 行`}
      right={<TargetColumnBadge label={`${targetLabel} · 第 ${preview.column_index} 列`} />}
    >
      <div className="max-h-[46vh] overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <caption className="sr-only">
            XLSX 源文件预览，工作表 {preview.sheet}，高亮字段所在列 {targetLabel}
          </caption>
          <thead className="sticky top-0 z-10">
            <tr className="bg-subtle">
              <th className="sticky left-0 z-20 w-12 border-b border-r border-line bg-subtle px-2 py-1.5 text-center font-mono text-[11px] font-normal text-ink-muted">
                行
              </th>
              {Array.from({ length: totalCols }, (_, index) => {
                const column = index + 1;
                const target = column === preview.column_index;
                return (
                  <th
                    key={column}
                    scope="col"
                    className={`min-w-[120px] border-b border-r border-line px-2 py-1.5 text-center font-mono text-[11px] font-medium last:border-r-0 ${
                      target ? 'bg-brand-100 text-brand-800' : 'text-ink-muted'
                    }`}
                  >
                    {columnIndexToLabel(column)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((entry) => (
              <tr
                key={entry.row}
                className={
                  entry.isHeader
                    ? 'bg-warning-soft'
                    : entry.row === preview.row_start
                      ? 'border-t-2 border-brand-200'
                      : 'bg-card'
                }
              >
                <th
                  scope="row"
                  className={`sticky left-0 z-[1] border-b border-r border-line-soft px-2 py-1.5 text-center font-mono text-[11px] font-normal ${
                    entry.isHeader
                      ? 'bg-warning-soft text-warning-deep'
                      : 'bg-page text-ink-faint'
                  }`}
                  title={entry.isHeader ? '表头行' : `源文件第 ${entry.row} 行`}
                >
                  {entry.row}
                </th>
                {Array.from({ length: totalCols }, (_, index) => {
                  const column = index + 1;
                  const key = `${entry.row}:${column}`;
                  if (covered.has(key)) return null;
                  const merge = mergeAnchors.get(key);
                  const colSpan = merge?.colSpan ?? 1;
                  const rowSpan = merge?.rowSpan ?? 1;
                  const value = merge ? merge.value : cellAt(entry.row, column);
                  const target =
                    preview.column_index >= column &&
                    preview.column_index < column + colSpan;

                  return (
                    <td
                      key={column}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      colSpan={colSpan > 1 ? colSpan : undefined}
                      className={`max-w-[240px] truncate border-b border-r border-line-soft px-2.5 py-1.5 font-mono text-[12px] last:border-r-0 ${
                        target
                          ? 'bg-brand-100 font-medium text-brand-800'
                          : entry.isHeader
                            ? 'font-medium text-ink-soft'
                            : 'text-ink-muted'
                      } ${merge ? 'text-center' : ''}`}
                      title={displayCell(value)}
                    >
                      {merge && displayCell(value) === '—' ? (
                        <span className="text-ink-faint">合并单元格</span>
                      ) : (
                        displayCell(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line-soft bg-page px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-muted">
          <span>
            高亮列 {targetLabel}（第 {preview.column_index} 列） · {rowEndLabel}
          </span>
          {mergedPreview.length > 0 && (
            <>
              <span className="hidden h-2.5 w-px bg-line sm:block" />
              <span className="flex flex-wrap items-center gap-1">
                合并区域
                {mergedPreview.map((range) => (
                  <span
                    key={range}
                    className="rounded border border-line bg-card px-1.5 py-px font-mono text-[11px] text-ink-muted"
                  >
                    {range}
                  </span>
                ))}
                {preview.merged_ranges.length > mergedPreview.length && (
                  <span className="font-mono text-[11px] text-ink-faint">
                    +{preview.merged_ranges.length - mergedPreview.length}
                  </span>
                )}
              </span>
            </>
          )}
          <span className="ml-auto font-mono">最多显示 50 个数据行</span>
        </div>
      </div>
    </PreviewShell>
  );
}

function JsonPreviewPanel({ preview }: { preview: JsonPreview }) {
  return (
    <PreviewShell
      title="JSON 命中样本"
      subtitle="JSONPath 实时求值 · 仅展示前 10 个命中值"
      right={
        <span className="inline-flex items-center gap-1 rounded-full border border-transparent bg-info-soft px-2 py-0.5 font-mono text-[11px] text-info-deep">
          {preview.hits} 个命中
        </span>
      }
    >
      <div className="p-3.5">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2">
          <Icon name="code" size={13} className="shrink-0 text-ink-faint" />
          <span className="font-mono text-[13px] text-ink-soft">
            {preview.json_path}
          </span>
          <span className="ml-auto shrink-0 rounded bg-card px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
            jsonpath
          </span>
        </div>

        <div className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-page">
          {preview.samples.map((sample, index) => {
            const structured = sample !== null && typeof sample === 'object';
            const text = formatJsonValue(sample);
            return (
              <div
                key={index}
                className="grid grid-cols-[34px_minmax(0,1fr)] gap-2 px-3 py-2.5"
              >
                <span className="pt-0.5 font-mono text-[11px] text-ink-faint">
                  #{String(index + 1).padStart(2, '0')}
                </span>
                {structured ? (
                  <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ink-soft">
                    {text}
                  </pre>
                ) : (
                  <code className="break-words font-mono text-[13px] leading-5 text-ink-soft">
                    {text}
                  </code>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[11px] text-ink-muted">
          <span>命中样本保持源文件中的原始类型。</span>
          <span className="font-mono">
            显示 {preview.samples.length}/{Math.min(preview.hits, 10)}
          </span>
        </div>
      </div>
    </PreviewShell>
  );
}

function PreviewBody({ data }: { data: PreviewResponse }) {
  const preview = data.preview;
  if (isCsvPreview(preview)) return <CsvPreviewTable preview={preview} />;
  if (isXlsxPreview(preview)) return <XlsxPreviewTable preview={preview} />;
  if (isJsonPreview(preview)) return <JsonPreviewPanel preview={preview} />;
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-ink-muted">
      不支持的预览数据类型
    </div>
  );
}

function LoadingPreview() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-[86px] animate-soft-pulse rounded-xl border border-line bg-subtle" />
      <div className="h-[260px] animate-soft-pulse rounded-xl border border-line bg-subtle" />
    </div>
  );
}

function ErrorPreview({
  error,
  onRetry,
}: {
  error: PreviewErrorState;
  onRetry: () => void;
}) {
  const title =
    error.status === 409
      ? '定位已失效'
      : error.status === 403
        ? '权限不足'
        : error.status === 404
          ? '找不到预览对象'
          : error.status === 401
            ? '登录已过期'
            : '预览加载失败';
  const hint =
    error.status === 409
      ? '源文件可能已更新：工作表、列、表头路径或 JSONPath 已无法解析。请核对源文件后重新导入字段定位器。'
      : error.status === 403
        ? '当前角色没有读取源文件预览的权限，请联系管理员确认角色。'
        : '请确认字段与源文件仍存在，或稍后重试。';

  return (
    <div className="rounded-xl border border-line bg-card p-6">
      <div className="mx-auto max-w-md text-center">
        <span
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${
            error.status === 409
              ? 'bg-warning-soft text-warning-deep'
              : 'bg-danger-soft text-danger-deep'
          }`}
        >
          <Icon
            name={error.status === 409 ? 'warning' : 'file-search'}
            size={22}
          />
        </span>
        <h3 className="mt-3.5 text-xl font-medium text-ink">
          {title}
        </h3>
        <p className="mt-2 text-[13px] leading-5 text-ink-soft">
          {error.message}
        </p>
        <p className="mt-2 text-[12px] leading-5 text-ink-muted">{hint}</p>
        {error.status !== 409 && error.status !== 401 && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
          >
            <Icon name="refresh" size={12} />
            重新尝试
          </button>
        )}
      </div>
    </div>
  );
}

export function PreviewModal({ selection, token, onClose }: PreviewModalProps) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<PreviewErrorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const datasetId = selection.dataset.id;
  const fieldName = selection.field.name;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);

    getFieldPreview(token, datasetId, fieldName, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        if (reason instanceof ApiError) {
          setError({ status: reason.status, message: reason.message });
        } else {
          setError({
            status: 0,
            message: '无法读取源文件预览，请检查网络连接后重试。',
          });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [token, datasetId, fieldName, reloadKey]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  const resolvedFile = data?.file ?? selection.field.source_file;
  const resolvedLocator = data?.locator ?? selection.field.src_locator;
  const locatorText = humanizeLocator(resolvedLocator);
  const typeLabel = locatorTypeLabel(resolvedLocator.type);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadSourceFile(
        token,
        selection.field.source_file.id,
        selection.field.source_file.original_name,
      );
    } catch (reason) {
      setDownloadError(
        reason instanceof ApiError
          ? reason.message
          : '下载源文件失败，请稍后重试。',
      );
    } finally {
      setDownloading(false);
    }
  }

  async function copyLocator() {
    try {
      await navigator.clipboard.writeText(
        `${resolvedFile.original_name} · ${locatorText}`,
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 animate-fade-in sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative z-[51] flex max-h-[85vh] w-full max-w-[880px] flex-col overflow-hidden rounded-xl border border-line bg-card shadow-modal animate-modal-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700">
              <Icon name="file-search" size={16} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                  源文件回源 / 只读
                </span>
                <span className="rounded border border-line bg-card px-1.5 py-px font-mono text-[11px] uppercase text-ink-muted">
                  {typeLabel}
                </span>
              </div>
              <h2
                id="preview-title"
                className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[14px] font-semibold text-ink"
              >
                <span>回源预览</span>
                <span className="truncate font-mono text-[12px] font-normal text-ink-muted">
                  {selection.dataset.id}.{selection.field.name}
                </span>
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={copyLocator}
              className="hidden h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white sm:flex"
            >
              <Icon name="copy" size={12} />
              {copied ? '已复制' : '复制定位'}
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              aria-label="关闭回源预览"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-page px-4 py-4 sm:px-5">
          <section className="mb-3.5 grid gap-3 rounded-xl border border-line bg-card p-3.5 sm:grid-cols-2">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                源文件
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <Icon name="file" size={13} className="text-brand-600" />
                <span className="min-w-0 truncate font-mono text-[13px] font-medium text-ink">
                  {resolvedFile.original_name}
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-ink-faint">
                托管文件 · 源文件 #{resolvedFile.id}
              </div>
              {data?.file.sha256 && (
                <div
                  className="mt-0.5 font-mono text-[11px] text-ink-faint"
                  title={`sha256 ${data.file.sha256}`}
                >
                  sha256 {data.file.sha256.slice(0, 12)}… · 已去重
                </div>
              )}
            </div>
            <div className="border-t border-line-soft pt-2 sm:border-l sm:border-t-0 sm:pl-3.5 sm:pt-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                定位器
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                {locatorText}
              </p>
            </div>
            <div className="border-t border-line-soft pt-2 sm:col-span-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                  实文件核查
                </span>
                {data?.verification?.status === 'passed' ? (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full border border-transparent bg-success-soft px-1.5 py-px font-mono text-[11px] text-success-deep">
                      <Icon name="check" size={12} />
                      通过
                    </span>
                    <span className="text-[12px] text-ink-muted">
                      v{data.verification.version_no} 导入时校验 ·{' '}
                      {data.verification.checked_at.slice(0, 10)} ·{' '}
                      {data.verification.checked_by}
                    </span>
                  </>
                ) : (
                  <span className="text-[12px] text-ink-muted">
                    {data
                      ? data.verification?.status || '无导入核查记录'
                      : '读取中…'}
                  </span>
                )}
              </div>
            </div>
          </section>

          <div aria-live="polite">
            {loading && <LoadingPreview />}

            {!loading && error && (
              <ErrorPreview
                error={error}
                onRetry={() => setReloadKey((value) => value + 1)}
              />
            )}

            {!loading && !error && data && <PreviewBody data={data} />}
          </div>
        </div>

        <footer className="flex h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft bg-card px-4 text-[11px] text-ink-muted">
          <span className="flex items-center gap-1.5">
            <Icon name="lock" size={12} />
            只读 · 存储路径不对外暴露
          </span>
          <span className="hidden h-3 w-px bg-line sm:block" />
          <span className="font-mono">
            {typeLabel} · 按定位器实时解析
          </span>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
            title="经 GET /files/{id}/download 受控下载，存储路径不暴露"
          >
            <Icon name="download" size={12} />
            {downloading ? '下载中…' : '下载源文件（权限受控）'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
          >
            关闭
          </button>
          {downloadError && (
            <span className="w-full text-danger-deep" role="alert">
              {downloadError}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
