import { useEffect, useRef, useState } from 'react';
import type { ChangeEntry, ChangeOp, LocatorEnvelope, TargetKind } from '../types';
import { ApiError, getChanges, isAbortError } from '../lib/api';
import { formatDateTime, humanizeLocator } from '../lib/format';
import { Icon } from './Icon';

interface HistoryDrawerProps {
  token: string;
  entityKind: TargetKind;
  entityKey: string;
  title: string;
  onClose: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  dataset_id: '数据集',
  name: '名称',
  field_type: '类型',
  source_file_id: '源文件',
  src_locator: '定位器',
  description: '描述',
  from_dataset: '上游数据集',
  from_field: '上游字段',
  to_dataset: '下游数据集',
  to_field: '下游字段',
  transform: '转换',
  confidence: '置信度',
  source: '来源',
  note: '备注',
};

const KIND_LABELS: Record<TargetKind, string> = {
  dataset: '数据集',
  field: '字段',
  edge: '血缘边',
};

const OP_LABELS: Record<ChangeOp, string> = {
  added: '新增',
  updated: '修改',
  deleted: '删除',
};

const OP_STYLES: Record<ChangeOp, string> = {
  added: 'border-pine-200 bg-pine-50 text-pine-700',
  updated: 'border-ochre/20 bg-ochre-soft text-ochre-deep',
  deleted: 'border-rosewood/20 bg-rosewood-soft text-rosewood-deep',
};

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '空';
  if (typeof value === 'string') return value || '空';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('type' in record && ('input' in record || 'resolved' in record)) {
      return humanizeLocator(value as LocatorEnvelope);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '[无法展示]';
    }
  }
  return String(value);
}

function changedKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  return Array.from(keys).filter(
    (key) =>
      JSON.stringify(before?.[key] ?? null) !==
      JSON.stringify(after?.[key] ?? null),
  );
}

function ChangeSummary({ entry }: { entry: ChangeEntry }) {
  const keys = changedKeys(entry.before, entry.after);
  if (entry.op === 'updated') {
    if (keys.length === 0) {
      return (
        <p className="text-[9px] leading-4 text-ink-faint">
          内容与上一版本一致（未产生实质变更）。
        </p>
      );
    }
    return (
      <ul className="space-y-1">
        {keys.map((key) => (
          <li
            key={key}
            className="grid grid-cols-[58px_minmax(0,1fr)] gap-1.5 text-[9px] leading-4"
          >
            <span className="text-ink-faint">{FIELD_LABELS[key] ?? key}</span>
            <span className="min-w-0 break-words font-mono text-[8.5px] text-ink-soft">
              <span className="text-ink-faint line-through decoration-line-strong">
                {valueText(entry.before?.[key])}
              </span>
              <span className="mx-1 text-ink-faint">→</span>
              <span className="text-pine-800">{valueText(entry.after?.[key])}</span>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const snapshot = entry.op === 'deleted' ? entry.before : entry.after;
  const summaryKeys = keys.slice(0, 5);
  if (!snapshot || summaryKeys.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] leading-4">
      {summaryKeys.map((key) => (
        <span key={key} className="min-w-0 break-words font-mono text-[8.5px] text-ink-muted">
          <span className="text-ink-faint">{FIELD_LABELS[key] ?? key} </span>
          {valueText(snapshot[key])}
        </span>
      ))}
    </div>
  );
}

/** 字段 / 边的变更历史抽屉；数据来自 GET /changes，按 id 倒序。 */
export function HistoryDrawer({
  token,
  entityKind,
  entityKey,
  title,
  onClose,
}: HistoryDrawerProps) {
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getChanges(token, entityKind, entityKey, 50, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setEntries(rows);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setError(
          reason instanceof ApiError
            ? reason.message
            : '无法读取变更历史，请稍后重试。',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, entityKind, entityKey, reloadKey]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[75] flex justify-end bg-ink/40 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="flex h-full w-full max-w-[520px] flex-col overflow-hidden border-l border-line bg-surface shadow-float animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-drawer-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
              <Icon name="history" size={12} />
              变更历史 · {KIND_LABELS[entityKind]}
            </div>
            <h2
              id="history-drawer-title"
              className="mt-1 break-all font-mono text-[12.5px] font-semibold text-ink"
            >
              {title}
            </h2>
            <p className="mt-0.5 break-all font-mono text-[8.5px] text-ink-faint">
              {entityKey}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label="刷新变更历史"
              title="刷新"
            >
              <Icon name="refresh" size={14} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label="关闭变更历史"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbf9f3] px-4 py-4">
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-line-soft bg-surface px-3 py-2.5 text-[9px] leading-4 text-ink-faint">
            <Icon name="info" size={12} className="mt-0.5 shrink-0" />
            <span>
              变更日志按时间倒序展示（最多 50 条）。导入与人工编辑都会留痕，
              标注不写入变更日志。
            </span>
          </div>

          {loading && (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-[86px] animate-soft-pulse rounded-xl border border-line bg-surface"
                />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-rosewood/20 bg-rosewood-soft px-3.5 py-3" role="alert">
              <p className="text-[10.5px] leading-5 text-rosewood-deep">{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-rosewood/25 bg-surface px-2 py-1 text-[9.5px] text-rosewood-deep"
              >
                <Icon name="refresh" size={10} />
                重新加载
              </button>
            </div>
          )}

          {!loading && !error && entries?.length === 0 && (
            <div className="rounded-xl border border-dashed border-line bg-surface/60 px-4 py-8 text-center">
              <div className="font-mono text-[10px] text-ink-muted">暂无变更记录</div>
              <p className="mt-1 text-[9px] text-ink-faint">
                该实体的创建与修改尚未写入变更日志。
              </p>
            </div>
          )}

          {!loading && !error && Boolean(entries?.length) && (
            <ol className="relative space-y-2.5 border-l border-line-soft pl-4">
              {(entries ?? []).map((entry) => (
                <li key={entry.id} className="relative">
                  <span
                    className="absolute -left-[21px] top-3 h-2 w-2 rounded-full border border-surface bg-pine-500"
                    aria-hidden="true"
                  />
                  <article className="rounded-xl border border-line-soft bg-surface/85 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`rounded border px-1.5 py-[1px] font-mono text-[8px] ${OP_STYLES[entry.op]}`}
                      >
                        {OP_LABELS[entry.op]}
                      </span>
                      <span className="font-mono text-[8.5px] text-ink-faint">
                        #{entry.id}
                      </span>
                      <span className="ml-auto font-mono text-[8px] text-ink-faint">
                        {formatDateTime(entry.created_at)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ChangeSummary entry={entry} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1 font-mono text-[8px] text-ink-faint">
                      <Icon name="user" size={9} />
                      操作者 {entry.actor}
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
