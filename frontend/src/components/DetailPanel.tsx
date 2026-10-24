import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AiSuggestion,
  DatasetField,
  FieldSelection,
  LineageEdge,
  LineageGraph,
} from '../types';
import {
  ApiError,
  confirmAiSuggestion,
  patchField,
  rejectAiSuggestion,
  suggestAiEdges,
} from '../lib/api';
import { fieldEntityKey } from '../lib/entities';
import {
  formatConfidence,
  humanizeLocator,
  locatorTypeLabel,
} from '../lib/format';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { SourceBadge } from './SourceBadge';
import { AnnotationSection } from './AnnotationSection';
import { HistoryDrawer } from './HistoryDrawer';
import type { ToastTone } from './Toast';

interface DetailPanelProps {
  selection: FieldSelection | null;
  graph: LineageGraph | null;
  token: string;
  canEdit: boolean;
  onClose: () => void;
  onPreview: (selection: FieldSelection) => void;
  onRefresh: () => void;
  onNotify: (message: string, tone?: ToastTone) => void;
}

const DETAIL_HINTS: Array<[string, string, IconName]> = [
  ['定位器', 'sheet / 行列 / JSONPath', 'code'],
  ['来源徽章', 'imported · manual · ai', 'link'],
  ['回源预览', 'CSV / XLSX / JSON', 'file-search'],
];

function FileTypeBadge({ type }: { type: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] uppercase text-ink-muted">
      <Icon name="file" size={12} />
      {locatorTypeLabel(type)}
    </span>
  );
}

function EmptyDetail() {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-5 py-8">
      <div className="mx-auto w-full max-w-[248px] text-center">
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-page text-brand-600">
          <Icon name="file-search" size={24} />
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-card font-mono text-[11px] text-ink-faint">
            1
          </span>
        </div>
        <h2 className="mt-4 text-xl font-medium text-ink">核对字段的来源</h2>
        <p className="mt-2 text-[13px] leading-5 text-ink-muted">
          点击画布节点中的任意字段，查看字段属性、人类可读定位与上游血缘，
          并直接打开源文件区域预览。
        </p>
      </div>

      <div className="mx-auto mt-7 w-full max-w-[262px] space-y-2">
        {DETAIL_HINTS.map(([title, detail, icon], index) => (
          <div
            key={title}
            className="flex items-center gap-2.5 rounded-lg border border-line-soft bg-card px-3 py-2.5"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line-soft bg-page text-ink-faint">
              <Icon name={icon} size={13} />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink-soft">{title}</div>
              <div className="mt-0.5 font-mono text-[11px] text-ink-faint">
                {detail}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-7 flex max-w-[262px] items-start gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] leading-4 text-ink-muted">
        <Icon name="info" size={12} className="mt-0.5 shrink-0" />
        悬停或点击画布上的连线可查看转换说明，并在右侧面板追加标注。
      </div>
    </div>
  );
}

function IncomingEdgeCard({ edge }: { edge: LineageEdge }) {
  return (
    <div className="rounded-xl border border-line-soft bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[12px] leading-4 text-ink-soft">
            <span className="text-ink-faint">{edge.from_dataset}.</span>
            <span className="font-medium text-ink">{edge.from_field}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 font-mono text-[11px] text-ink-faint">
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
        <div className="font-mono text-[11px] leading-4 text-ink-muted">
          <span className="text-ink-faint">转换 · </span>
          {edge.transform || '未填写'}
        </div>
        {edge.note && (
          <p className="mt-1 text-[11px] leading-4 text-ink-faint">{edge.note}</p>
        )}
      </div>
    </div>
  );
}

interface LocatorDraft {
  column: string;
  header: string;
  sheet: string;
  rowStart: string;
  rowEnd: string;
  headerPath: string;
  headerRows: string;
  jsonPath: string;
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function draftFromField(field: DatasetField): LocatorDraft {
  const input = field.src_locator.input ?? {};
  const resolved = field.src_locator.resolved ?? {};
  const type = field.src_locator.type;
  const headerPath = Array.isArray(input.header_path)
    ? input.header_path.map((item) => String(item)).join(' → ')
    : '';
  // CSV 的 header / column 与 XLSX 的 header_path / column 都是二选一语义：
  // 初始值只回填实际生效的那一种，避免「改了列号却被表头优先命中」。
  const csvUsesHeader = type === 'csv' && input.header !== null &&
    input.header !== undefined;
  const xlsxUsesPath = type === 'xlsx' && headerPath.length > 0;

  return {
    column:
      type === 'csv'
        ? csvUsesHeader
          ? ''
          : textValue(input.column ?? resolved.column_index)
        : type === 'xlsx'
          ? xlsxUsesPath
            ? ''
            : textValue(input.column ?? resolved.column)
          : '',
    header: csvUsesHeader ? textValue(input.header) : '',
    sheet: textValue(input.sheet ?? resolved.sheet),
    rowStart: textValue(input.row_start ?? resolved.row_start),
    rowEnd: textValue(input.row_end ?? resolved.row_end),
    headerPath,
    headerRows: textValue(input.header_rows),
    jsonPath: textValue(input.json_path ?? resolved.json_path),
  };
}

function splitHeaderPath(raw: string): string[] {
  return raw
    .split(/[→>,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function suggestionId(item: AiSuggestion): string {
  return `${item.from_dataset}.${item.from_field ?? '*'}->${item.to_dataset}.${item.to_field ?? '*'}`;
}

function suggestionKey(item: AiSuggestion) {
  return {
    from_dataset: item.from_dataset,
    from_field: item.from_field,
    to_dataset: item.to_dataset,
    to_field: item.to_field,
  };
}

function buildLocatorInput(
  type: string | null,
  draft: LocatorDraft,
): Record<string, unknown> {
  if (type === 'csv') {
    const payload: Record<string, unknown> = {};
    if (draft.column.trim()) {
      const column = Number(draft.column);
      if (!Number.isInteger(column) || column < 1) {
        throw new Error('CSV 列号必须是大于等于 1 的整数。');
      }
      payload.column = column;
    }
    if (draft.header.trim()) payload.header = draft.header.trim();
    if (!payload.column && !payload.header) {
      throw new Error('CSV 定位器至少填写列号或表头名称。');
    }
    if (payload.column && payload.header) {
      throw new Error('CSV 列号与表头名称只能填写一个。');
    }
    return payload;
  }

  if (type === 'xlsx') {
    if (!draft.sheet.trim()) {
      throw new Error('XLSX 定位器必须填写工作表名称。');
    }
    const payload: Record<string, unknown> = { sheet: draft.sheet.trim() };
    const headerPath = splitHeaderPath(draft.headerPath);
    if (draft.column.trim() && headerPath.length) {
      throw new Error('XLSX 列标识与表头路径只能二选一。');
    }
    if (draft.column.trim()) payload.column = draft.column.trim();
    if (draft.rowStart.trim()) {
      const rowStart = Number(draft.rowStart);
      if (!Number.isInteger(rowStart) || rowStart < 1) {
        throw new Error('起始行必须是大于等于 1 的整数。');
      }
      payload.row_start = rowStart;
    }
    if (draft.rowEnd.trim()) {
      const rowEnd = Number(draft.rowEnd);
      if (!Number.isInteger(rowEnd) || rowEnd < 1) {
        throw new Error('结束行必须是大于等于 1 的整数。');
      }
      payload.row_end = rowEnd;
    }
    if (headerPath.length) payload.header_path = headerPath;
    if (draft.headerRows.trim()) {
      const headerRows = Number(draft.headerRows);
      if (!Number.isInteger(headerRows) || headerRows < 1) {
        throw new Error('表头行数必须是大于等于 1 的整数。');
      }
      payload.header_rows = headerRows;
    }
    return payload;
  }

  if (type === 'json') {
    if (!draft.jsonPath.trim()) {
      throw new Error('JSON 定位器必须填写 JSONPath。');
    }
    return { json_path: draft.jsonPath.trim() };
  }

  throw new Error('源文件类型未知，无法编辑定位器。');
}

interface FieldEditorProps {
  token: string;
  datasetId: string;
  field: DatasetField;
  onCancel: () => void;
  onSaved: () => void;
}

function FieldEditor({
  token,
  datasetId,
  field,
  onCancel,
  onSaved,
}: FieldEditorProps) {
  const locatorType = field.src_locator.type;
  const [description, setDescription] = useState(field.description ?? '');
  const [fieldType, setFieldType] = useState(field.field_type ?? '');
  const [draft, setDraft] = useState<LocatorDraft>(() => draftFromField(field));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const initialLocator = (() => {
    try {
      return JSON.stringify(buildLocatorInput(locatorType, draftFromField(field)));
    } catch {
      return '';
    }
  })();

  function updateDraft(patch: Partial<LocatorDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const payload: {
      description: string | null;
      field_type: string | null;
      src_locator?: Record<string, unknown>;
    } = {
      description: description.trim() || null,
      field_type: fieldType.trim() || null,
    };

    if (locatorType) {
      try {
        const nextLocator = buildLocatorInput(locatorType, draft);
        if (JSON.stringify(nextLocator) !== initialLocator) {
          payload.src_locator = nextLocator;
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '定位器格式不合法。');
        return;
      }
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSaving(true);
    setError(null);
    try {
      await patchField(token, datasetId, field.name, payload, controller.signal);
      onSaved();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(
        reason instanceof ApiError
          ? reason.message
          : '字段保存失败，请稍后重试。',
      );
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
      <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5">
        <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-brand-700">
          <Icon name="edit" size={11} />
          编辑字段属性
        </div>
        <p className="mt-1 text-[12px] leading-4 text-brand-800">
          保存定位器时后端会重新做结构校验与实文件核查，失败返回 409 并保留原值。
        </p>
      </div>

      <div>
        <label htmlFor="field-description" className="mb-1.5 block text-[12px] font-medium text-ink-soft">
          描述
        </label>
        <textarea
          id="field-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="字段业务含义（留空表示未登记）"
          className="field-input resize-y py-2 text-[13px] leading-5"
          disabled={saving}
        />
      </div>

      <div>
        <label htmlFor="field-type" className="mb-1.5 block text-[12px] font-medium text-ink-soft">
          字段类型
        </label>
        <input
          id="field-type"
          type="text"
          value={fieldType}
          onChange={(event) => setFieldType(event.target.value)}
          placeholder="如 STRING / DECIMAL / TIMESTAMP"
          className="field-input h-8 font-mono text-[13px]"
          disabled={saving}
          maxLength={64}
        />
      </div>

      <div className="rounded-xl border border-line bg-card">
        <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-soft">
            <Icon name="code" size={11} className="text-brand-600" />
            源定位器
          </span>
          <FileTypeBadge type={locatorType} />
        </div>

        <div className="space-y-2.5 px-3 py-2.5">
          {!locatorType && (
            <p className="text-[11px] leading-4 text-ink-muted">
              源文件类型未知，当前只能编辑描述与字段类型。
            </p>
          )}

          {locatorType === 'csv' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">列号</span>
                <input
                  type="number"
                  min={1}
                  value={draft.column}
                  onChange={(event) =>
                    updateDraft({ column: event.target.value, header: '' })
                  }
                  className="field-input h-8 font-mono text-[13px]"
                  disabled={saving}
                  placeholder="如 3"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">表头名称</span>
                <input
                  type="text"
                  value={draft.header}
                  onChange={(event) =>
                    updateDraft({ header: event.target.value, column: '' })
                  }
                  className="field-input h-8 text-[13px]"
                  disabled={saving}
                  placeholder="如 order_id"
                />
              </label>
            </div>
          )}
          {locatorType === 'csv' && (
            <p className="text-[11px] leading-4 text-ink-muted">
              列号与表头名称二选一；填写表头时按表头定位。
            </p>
          )}

          {locatorType === 'xlsx' && (
            <div className="space-y-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">工作表</span>
                <input
                  type="text"
                  value={draft.sheet}
                  onChange={(event) => updateDraft({ sheet: event.target.value })}
                  className="field-input h-8 text-[13px]"
                  disabled={saving}
                  placeholder="如 订单"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">列</span>
                  <input
                    type="text"
                    value={draft.column}
                    onChange={(event) =>
                      updateDraft({
                        column: event.target.value,
                        headerPath: '',
                        headerRows: '',
                      })
                    }
                    className="field-input h-8 font-mono text-[13px]"
                    disabled={saving}
                    placeholder="如 C"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">起始行</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.rowStart}
                    onChange={(event) => updateDraft({ rowStart: event.target.value })}
                    className="field-input h-8 font-mono text-[13px]"
                    disabled={saving}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">结束行</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.rowEnd}
                    onChange={(event) => updateDraft({ rowEnd: event.target.value })}
                    className="field-input h-8 font-mono text-[13px]"
                    disabled={saving}
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
                  表头路径（用 → 或逗号分隔）
                </span>
                <input
                  type="text"
                  value={draft.headerPath}
                  onChange={(event) =>
                    updateDraft({
                      headerPath: event.target.value,
                      column: '',
                    })
                  }
                  className="field-input h-8 text-[13px]"
                  disabled={saving}
                  placeholder="如 商品信息 → 订单号"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">表头行数</span>
                <input
                  type="number"
                  min={1}
                  value={draft.headerRows}
                  onChange={(event) => updateDraft({ headerRows: event.target.value })}
                  className="field-input h-8 font-mono text-[13px]"
                  disabled={saving}
                  placeholder="可选"
                />
              </label>
              <p className="text-[11px] leading-4 text-ink-muted">
                列标识与表头路径二选一；填写表头路径时按路径定位。
              </p>
            </div>
          )}

          {locatorType === 'json' && (
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">JSONPath</span>
              <input
                type="text"
                value={draft.jsonPath}
                onChange={(event) => updateDraft({ jsonPath: event.target.value })}
                className="field-input h-8 font-mono text-[13px]"
                disabled={saving}
                placeholder="如 $.orders[*].order_id"
              />
            </label>
          )}
        </div>
      </div>

      {error && (
        <div
          className="flex gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[12px] leading-4 text-danger-deep"
          role="alert"
        >
          <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-700 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {saving ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
              保存并核查…
            </>
          ) : (
            <>
              <Icon name="check" size={12} />
              保存
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-8 rounded-lg border border-line-strong bg-card px-3 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          取消
        </button>
      </div>
    </form>
  );
}

export function DetailPanel({
  selection,
  graph,
  token,
  canEdit,
  onClose,
  onPreview,
  onRefresh,
  onNotify,
}: DetailPanelProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [busySuggestionKey, setBusySuggestionKey] = useState<string | null>(
    null,
  );
  const suggestAbort = useRef<AbortController | null>(null);

  const datasetId = selection?.dataset.id ?? null;
  const fieldName = selection?.field.name ?? null;

  useEffect(() => {
    setEditing(false);
    setHistoryOpen(false);
    suggestAbort.current?.abort();
    setSuggestions([]);
    setSuggesting(false);
    setSuggestError(null);
    setSuggestNote(null);
    setBusySuggestionKey(null);
  }, [datasetId, fieldName]);

  useEffect(() => () => suggestAbort.current?.abort(), []);

  if (!selection) {
    return (
      <aside className="relative flex w-full shrink-0 flex-col border-t border-line bg-card xl:h-full xl:w-[320px] xl:border-l xl:border-t-0">
        <div className="flex h-12 shrink-0 flex-col justify-center border-b border-line-soft px-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
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
  const entityKey = fieldEntityKey(dataset.id, field.name);

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

  async function handleSuggest() {
    if (suggesting || busySuggestionKey) return;
    suggestAbort.current?.abort();
    const controller = new AbortController();
    suggestAbort.current = controller;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestNote(null);
    try {
      const candidates = await suggestAiEdges(
        token,
        { dataset: dataset.id, field: field.name },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (candidates.length > 0) {
        setSuggestions((current) => {
          const merged = new Map(
            current.map((item) => [suggestionId(item), item]),
          );
          for (const item of candidates) {
            merged.set(suggestionId(item), item);
          }
          return Array.from(merged.values());
        });
        onNotify(
          `已生成 ${candidates.length} 条 AI 候选血缘（source=ai）`,
          'success',
        );
        // 新候选已落库，刷新子图让 ai 边立即出现在画布上
        onRefresh();
      } else {
        setSuggestNote(
          suggestions.length > 0
            ? '没有新的候选（已存在的边会被排除）。'
            : '未发现候选（已存在的边会被排除）。',
        );
        onNotify(
          suggestions.length > 0
            ? '没有新的候选血缘'
            : '没有发现可补充的字段级血缘候选',
          'info',
        );
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setSuggestError(
        reason instanceof ApiError
          ? reason.message
          : 'AI 建议生成失败，请稍后重试。',
      );
    } finally {
      if (!controller.signal.aborted) setSuggesting(false);
    }
  }

  async function handleConfirmSuggestion(item: AiSuggestion) {
    const key = suggestionId(item);
    if (busySuggestionKey) return;
    suggestAbort.current?.abort();
    const controller = new AbortController();
    suggestAbort.current = controller;
    setBusySuggestionKey(key);
    setSuggestError(null);
    try {
      const edge = await confirmAiSuggestion(
        token,
        suggestionKey(item),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const remaining = suggestions.filter(
        (candidate) => suggestionId(candidate) !== key,
      );
      setSuggestions(remaining);
      if (remaining.length === 0) setSuggestNote('候选已全部处理。');
      onNotify(`已确认 AI 建议：#${edge.id} 已转为 manual`, 'success');
      onRefresh();
    } catch (reason) {
      if (controller.signal.aborted) return;
      setSuggestError(
        reason instanceof ApiError
          ? reason.message
          : '确认 AI 建议失败，请稍后重试。',
      );
    } finally {
      if (!controller.signal.aborted) setBusySuggestionKey(null);
    }
  }

  async function handleRejectSuggestion(item: AiSuggestion) {
    const key = suggestionId(item);
    if (busySuggestionKey) return;
    suggestAbort.current?.abort();
    const controller = new AbortController();
    suggestAbort.current = controller;
    setBusySuggestionKey(key);
    setSuggestError(null);
    try {
      await rejectAiSuggestion(token, suggestionKey(item), controller.signal);
      if (controller.signal.aborted) return;
      const remaining = suggestions.filter(
        (candidate) => suggestionId(candidate) !== key,
      );
      setSuggestions(remaining);
      if (remaining.length === 0) setSuggestNote('候选已全部处理。');
      onNotify('已拒绝该 AI 候选血缘', 'info');
      onRefresh();
    } catch (reason) {
      if (controller.signal.aborted) return;
      setSuggestError(
        reason instanceof ApiError
          ? reason.message
          : '拒绝 AI 建议失败，请稍后重试。',
      );
    } finally {
      if (!controller.signal.aborted) setBusySuggestionKey(null);
    }
  }

  return (
    <aside
      className="relative flex w-full shrink-0 flex-col border-t border-line bg-card xl:h-full xl:w-[320px] xl:border-l xl:border-t-0"
      aria-label="字段详情"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-soft px-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            字段检查
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-ink-muted">
            <Icon name="database" size={12} className="shrink-0" />
            <span className="truncate">{dataset.id}</span>
            <Icon name="chevron-right" size={12} className="shrink-0" />
            <span className="truncate text-brand-700">{field.name}</span>
          </div>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors duration-150 hover:border-line hover:bg-card hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            aria-label="查看字段变更历史"
            title="变更历史"
          >
            <Icon name="history" size={14} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors duration-150 hover:border-line hover:bg-card hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              aria-label={editing ? '退出字段编辑' : '编辑字段属性'}
              title={editing ? '退出编辑' : '编辑字段'}
            >
              <Icon name="edit" size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors duration-150 hover:border-line hover:bg-card hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            aria-label="关闭字段详情"
            title="关闭字段详情"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-7">
        <div className="animate-fade-in">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] uppercase text-ink-muted">
              {field.field_type || '类型未登记'}
            </span>
            <FileTypeBadge type={field.src_locator.type} />
            <SourceBadge source={fieldSource} />
          </div>
          <h2 className="mt-2.5 break-all font-mono text-lg font-semibold leading-6 text-ink">
            {field.name}
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
            {field.description || '暂无字段描述'}
          </p>
        </div>

        {editing ? (
          <FieldEditor
            key={`${dataset.id}.${field.name}`}
            token={token}
            datasetId={dataset.id}
            field={field}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onNotify('字段属性已更新', 'success');
              onRefresh();
            }}
          />
        ) : (
          <>
            <div className="mt-5 rounded-xl border border-line bg-card">
              <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
                <Icon name="file" size={12} className="text-brand-600" />
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
                  源文件
                </span>
              </div>
              <div className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="min-w-0 truncate font-mono text-[13px] font-medium text-ink"
                    title={field.source_file.original_name}
                  >
                    {field.source_file.original_name}
                  </span>
                  <span className="shrink-0 rounded border border-line bg-subtle px-1.5 py-px font-mono text-[11px] text-ink-muted">
                    托管文件
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink-faint">
                  源文件 #{field.source_file.id}
                </div>
              </div>
            </div>

            <section className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                  源文件定位
                </h3>
                <span className="rounded-full border border-line bg-page px-1.5 py-px font-mono text-[11px] text-ink-faint">
                  可读定位
                </span>
              </div>
              <div className="rounded-xl border border-brand-100 bg-brand-50 p-3">
                <p className="text-[13px] leading-relaxed text-brand-800">
                  {locatorText}
                </p>
                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-brand-100 pt-2">
                  <span className="font-mono text-[11px] text-brand-700">
                    定位器信封 · {field.src_locator.type || '未知'}
                  </span>
                  <button
                    type="button"
                    onClick={copyLocator}
                    className="flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] text-brand-700 transition-colors duration-150 hover:bg-brand-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                  >
                    <Icon name="copy" size={10} />
                    {copied ? '已复制' : copyError ? '复制失败' : '复制定位'}
                  </button>
                </div>
              </div>
            </section>

            <div className="mt-4 flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => onPreview(selection)}
                className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              >
                <Icon name="file-search" size={14} />
                回源预览
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                >
                  <Icon name="edit" size={14} />
                  编辑
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
              <Icon name="lock" size={12} />
              {canEdit
                ? '回源预览只读 · 编辑字段会写入变更日志'
                : '只读角色 · 可查看标注与变更历史'}
            </div>

            {canEdit && (
              <section className="mt-4">
                <div className="rounded-xl border border-ai/25 bg-ai-soft/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ai-deep">
                        <Icon name="sparkles" size={12} className="text-ai" />
                        AI 建议
                      </div>
                      <p className="mt-1 text-[12px] leading-4 text-ink-muted">
                        按同名字段/包含关系查找可能缺失的字段级血缘；
                        候选以 source=ai 落库，必须人工确认后才转为 manual。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSuggest}
                      disabled={suggesting || busySuggestionKey !== null}
                      className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-ai/25 bg-card px-2 text-[12px] font-medium text-ai-deep transition-colors duration-150 hover:border-ai/40 hover:bg-ai-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {suggesting ? (
                        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-ai/25 border-t-ai" />
                      ) : (
                        <Icon name="sparkles" size={11} />
                      )}
                      {suggesting ? '分析中…' : 'AI 建议'}
                    </button>
                  </div>

                  {suggestError && (
                    <div
                      className="mt-2.5 flex gap-1.5 rounded-lg border border-danger/25 bg-danger-soft px-2.5 py-2 text-[12px] leading-4 text-danger-deep"
                      role="alert"
                    >
                      <Icon name="warning" size={11} className="mt-0.5 shrink-0" />
                      <span className="break-words">{suggestError}</span>
                    </div>
                  )}

                  {suggestions.length > 0 && (
                    <div className="mt-2.5 space-y-2">
                      {suggestions.map((item) => {
                        const key = suggestionId(item);
                        const busy = busySuggestionKey === key;
                        const anyBusy = busySuggestionKey !== null;
                        return (
                          <div
                            key={key}
                            className="rounded-xl border border-ai/20 bg-card p-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 space-y-0.5 font-mono text-[12px] leading-4">
                                <div className="break-all">
                                  <span className="text-ink-faint">
                                    {item.from_dataset}.
                                  </span>
                                  <span className="font-medium text-ink-soft">
                                    {item.from_field ?? '*'}
                                  </span>
                                </div>
                                <div className="flex items-start gap-1 text-ink-faint">
                                  <Icon
                                    name="arrow-right"
                                    size={10}
                                    className="mt-0.5 shrink-0"
                                  />
                                  <span className="min-w-0 break-all">
                                    <span>{item.to_dataset}.</span>
                                    <span className="font-medium text-brand-700">
                                      {item.to_field ?? '*'}
                                    </span>
                                  </span>
                                </div>
                              </div>
                              <span className="shrink-0 rounded-full border border-ai/20 bg-ai-soft px-1.5 py-px font-mono text-[11px] text-ai-deep">
                                置信 {formatConfidence(item.confidence)}
                              </span>
                            </div>
                            <p className="mt-1.5 text-[12px] leading-4 text-ink-muted">
                              {item.reason}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2">
                              <SourceBadge source="ai" withDescription={false} />
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleConfirmSuggestion(item)}
                                  disabled={anyBusy}
                                  className="flex h-7 items-center gap-1 rounded-lg bg-brand-700 px-2 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                                >
                                  <Icon name="check" size={12} />
                                  {busy ? '确认中…' : '确认'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRejectSuggestion(item)}
                                  disabled={anyBusy}
                                  className="flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-card px-2 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-danger/30 hover:text-danger-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <Icon name="trash" size={12} />
                                  {busy ? '拒绝中…' : '拒绝'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {suggestNote && (
                    <div className="mt-2.5 rounded-lg border border-dashed border-line bg-page px-2.5 py-2 text-center text-[12px] text-ink-muted">
                      {suggestNote}
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                  上游血缘
                </h3>
                <span className="font-mono text-[11px] tabular-nums text-ink-faint">
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
                  <div className="font-mono text-[12px] text-ink-muted">
                    根字段 / 无字段级入边
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-ink-muted">
                    该字段可能是链路起点，或仅由表级血缘覆盖。
                  </p>
                </div>
              )}
            </section>

            <AnnotationSection
              token={token}
              targetKind="field"
              targetId={entityKey}
              canWrite={canEdit}
            />

            <section className="mt-5">
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="flex w-full items-center justify-between rounded-xl border border-line bg-card px-3 py-2.5 text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              >
                <span className="flex items-center gap-1.5">
                  <Icon name="history" size={12} />
                  变更历史
                </span>
                <Icon name="chevron-right" size={12} className="text-ink-faint" />
              </button>
            </section>

            <details className="group mt-4 rounded-xl border border-line-soft bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[13px] font-medium text-ink-muted outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white">
                查看原始定位器
                <Icon
                  name="chevron-down"
                  size={12}
                  className="text-ink-faint transition-transform duration-150 group-open:rotate-180"
                />
              </summary>
              <pre className="max-h-52 overflow-auto border-t border-line-soft bg-subtle/50 px-3 py-2.5 font-mono text-[11px] leading-4 text-ink-muted">
                {rawLocator}
              </pre>
            </details>
          </>
        )}
      </div>

      {historyOpen && (
        <HistoryDrawer
          token={token}
          entityKind="field"
          entityKey={entityKey}
          title={entityKey}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </aside>
  );
}
