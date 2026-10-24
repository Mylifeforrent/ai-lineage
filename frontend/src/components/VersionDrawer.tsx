import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  ImportBatch,
  TargetKind,
  VersionTag,
  VersionTagDiff,
  ChangeOp,
} from '../types';
import {
  ApiError,
  createVersionTag,
  getImportBatches,
  getVersionTagDiff,
  getVersionTags,
  isAbortError,
  rollbackVersionTag,
} from '../lib/api';
import { formatDateTime } from '../lib/format';
import { isAdmin, isEditor } from '../lib/roles';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import type { ToastTone } from './Toast';

interface VersionDrawerProps {
  token: string;
  role: string;
  onClose: () => void;
  onDataChanged: () => void;
  onNotify: (message: string, tone?: ToastTone) => void;
}

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

export function VersionDrawer({
  token,
  role,
  onClose,
  onDataChanged,
  onNotify,
}: VersionDrawerProps) {
  const canWrite = isEditor(role);
  const canRollback = isAdmin(role);

  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [tags, setTags] = useState<VersionTag[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [tagName, setTagName] = useState('');
  const [tagNote, setTagNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [diffFrom, setDiffFrom] = useState('');
  const [diffTo, setDiffTo] = useState('');
  const [diff, setDiff] = useState<VersionTagDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [pendingRollback, setPendingRollback] = useState<VersionTag | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackNotice, setRollbackNotice] = useState<string | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    Promise.all([
      getImportBatches(token, controller.signal),
      getVersionTags(token, controller.signal),
    ])
      .then(([batchRows, tagRows]) => {
        if (controller.signal.aborted) return;
        setBatches(batchRows);
        setTags(tagRows);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setLoadError(
          reason instanceof ApiError
            ? reason.message
            : '无法读取版本信息，请稍后重试。',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, reloadKey]);

  useEffect(() => {
    if (!tags?.length) {
      setDiffFrom('');
      setDiffTo('');
      setDiff(null);
      return;
    }
    setDiffFrom((current) =>
      current && tags.some((tag) => tag.name === current)
        ? current
        : tags[0].name,
    );
    setDiffTo((current) =>
      current && tags.some((tag) => tag.name === current)
        ? current
        : tags[tags.length - 1].name,
    );
  }, [tags]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pendingRollback) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, pendingRollback]);

  const handleCreateTag = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const name = tagName.trim();
      if (!name || creating) return;
      setCreating(true);
      setCreateError(null);
      try {
        const created = await createVersionTag(token, {
          name,
          note: tagNote.trim() || null,
        });
        setTagName('');
        setTagNote('');
        setReloadKey((value) => value + 1);
        onNotify(`版本标签「${created.name}」已创建`, 'success');
      } catch (reason) {
        setCreateError(
          reason instanceof ApiError
            ? reason.message
            : '创建版本标签失败，请稍后重试。',
        );
      } finally {
        setCreating(false);
      }
    },
    [creating, onNotify, tagName, tagNote, token],
  );

  const handleDiff = useCallback(async () => {
    if (!diffFrom || !diffTo || diffLoading) return;
    setDiffLoading(true);
    setDiffError(null);
    setDiff(null);
    try {
      const result = await getVersionTagDiff(token, diffFrom, diffTo);
      setDiff(result);
    } catch (reason) {
      setDiffError(
        reason instanceof ApiError
          ? reason.message
          : '无法计算版本差异，请稍后重试。',
      );
    } finally {
      setDiffLoading(false);
    }
  }, [diffFrom, diffTo, diffLoading, token]);

  const handleRollback = useCallback(async () => {
    if (!pendingRollback || rollingBack) return;
    setRollingBack(true);
    try {
      const result = await rollbackVersionTag(token, pendingRollback.name);
      setRollbackNotice(
        `已回滚到「${pendingRollback.name}」，反做 ${result.reverted} 条变更。`,
      );
      onNotify(`已回滚到「${pendingRollback.name}」`, 'success');
      setPendingRollback(null);
      setReloadKey((value) => value + 1);
      setDiff(null);
      onDataChanged();
    } catch (reason) {
      onNotify(
        reason instanceof ApiError
          ? reason.message
          : '回滚失败，请稍后重试。',
        'error',
      );
    } finally {
      setRollingBack(false);
    }
  }, [onDataChanged, onNotify, pendingRollback, rollingBack, token]);

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-ink/40 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pendingRollback) {
          onClose();
        }
      }}
    >
      <aside
        className="flex h-full w-full max-w-[620px] flex-col overflow-hidden border-l border-line bg-surface shadow-float animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-drawer-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
              <Icon name="tag" size={12} />
              导入批次 · 业务标签
            </div>
            <h2
              id="version-drawer-title"
              className="mt-1 font-display text-[22px] font-medium tracking-[-0.02em] text-ink"
            >
              版本
            </h2>
            <p className="mt-0.5 text-[9.5px] leading-4 text-ink-faint">
              回滚只反做变更日志；标注为追加式，不受回滚影响。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label="刷新版本信息"
              title="刷新"
            >
              <Icon name="refresh" size={14} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label="关闭版本抽屉"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbf9f3] px-4 py-4 sm:px-5">
          {loading && (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-14 animate-soft-pulse rounded-xl border border-line bg-surface"
                />
              ))}
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-xl border border-rosewood/20 bg-rosewood-soft px-3.5 py-3" role="alert">
              <p className="text-[10.5px] leading-5 text-rosewood-deep">{loadError}</p>
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

          {!loading && !loadError && (
            <div className="space-y-5">
              {rollbackNotice && (
                <div className="flex items-start gap-2 rounded-xl border border-pine-200 bg-pine-50 px-3 py-2.5 text-[10px] leading-4 text-pine-800">
                  <Icon name="check" size={12} className="mt-0.5 shrink-0" />
                  <span>{rollbackNotice}</span>
                </div>
              )}

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
                    <Icon name="layers" size={11} />
                    导入批次
                  </h3>
                  <span className="font-mono text-[8px] text-ink-faint">
                    {batches?.length ?? 0} 个批次
                  </span>
                </div>
                {batches?.length ? (
                  <div className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
                    {batches.map((batch) => (
                      <div
                        key={batch.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
                      >
                        <span className="font-mono text-[10.5px] font-semibold text-ink">
                          v{batch.version_no}
                        </span>
                        <span className="rounded border border-line bg-canvas/55 px-1.5 py-[1px] font-mono text-[8px] uppercase text-ink-faint">
                          {batch.format}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[8.5px] text-ink-faint" title={batch.file_names.join('、')}>
                          {batch.file_names.join('、') || '—'}
                        </span>
                        <span className="font-mono text-[8.5px] text-ink-faint">
                          {formatDateTime(batch.created_at)} · {batch.created_by}
                        </span>
                        {batch.rolled_back_at ? (
                          <span className="rounded-full border border-rosewood/20 bg-rosewood-soft px-1.5 py-[1px] font-mono text-[8px] text-rosewood-deep">
                            已回滚
                          </span>
                        ) : (
                          <span className="rounded-full border border-pine-200 bg-pine-50 px-1.5 py-[1px] font-mono text-[8px] text-pine-700">
                            有效
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-line bg-surface/60 px-3 py-4 text-center text-[9.5px] text-ink-faint">
                    暂无导入批次
                  </div>
                )}
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
                    <Icon name="tag" size={11} />
                    业务标签
                  </h3>
                  <span className="font-mono text-[8px] text-ink-faint">
                    {tags?.length ?? 0} 个标签
                  </span>
                </div>

                {tags?.length ? (
                  <div className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
                    {tags.map((tag) => (
                      <div key={tag.id} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-[10.5px] font-semibold text-pine-800">
                            {tag.name}
                          </span>
                          <span className="rounded border border-line bg-canvas/55 px-1.5 py-[1px] font-mono text-[8px] text-ink-faint">
                            变更序号 #{tag.change_seq}
                          </span>
                          <span className="font-mono text-[8px] text-ink-faint">
                            {formatDateTime(tag.created_at)} · {tag.created_by}
                          </span>
                          {canRollback && (
                            <button
                              type="button"
                              onClick={() => {
                                setRollbackNotice(null);
                                setPendingRollback(tag);
                              }}
                              className="ml-auto flex items-center gap-1 rounded-md border border-rosewood/20 bg-rosewood-soft px-2 py-1 text-[9px] font-medium text-rosewood transition-colors hover:border-rosewood/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rosewood/30"
                            >
                              <Icon name="rollback" size={10} />
                              回滚到此标签
                            </button>
                          )}
                        </div>
                        {tag.note && (
                          <p className="mt-1 break-words text-[9.5px] leading-4 text-ink-muted">
                            {tag.note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-line bg-surface/60 px-3 py-4 text-center text-[9.5px] text-ink-faint">
                    还没有业务标签。标签会锚定当前变更序号，供版本差异与回滚使用。
                  </div>
                )}

                {canWrite ? (
                  <form onSubmit={handleCreateTag} className="mt-2.5 rounded-xl border border-line bg-surface/70 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={tagName}
                        onChange={(event) => setTagName(event.target.value)}
                        placeholder="标签名，如 v3.0-r1"
                        aria-label="版本标签名"
                        maxLength={64}
                        className="field-input h-8 max-w-[170px] font-mono text-[10px]"
                        disabled={creating}
                      />
                      <input
                        type="text"
                        value={tagNote}
                        onChange={(event) => setTagNote(event.target.value)}
                        placeholder="标签说明（可选）"
                        aria-label="版本标签说明"
                        maxLength={200}
                        className="field-input h-8 flex-1 text-[10px]"
                        disabled={creating}
                      />
                      <button
                        type="submit"
                        disabled={creating || !tagName.trim()}
                        className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-pine-800 px-2.5 text-[9.5px] font-medium text-white transition-colors hover:bg-pine-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Icon name="plus" size={10} />
                        {creating ? '创建中…' : '打标签'}
                      </button>
                    </div>
                    <p className="mt-1.5 font-mono text-[8px] text-ink-faint">
                      编辑及以上角色可创建；重名会返回 409。
                    </p>
                    {createError && (
                      <p className="mt-1.5 rounded-md border border-rosewood/20 bg-rosewood-soft px-2 py-1.5 text-[9px] leading-4 text-rosewood-deep" role="alert">
                        {createError}
                      </p>
                    )}
                  </form>
                ) : (
                  <p className="mt-2 flex items-center gap-1.5 text-[8.5px] text-ink-faint">
                    <Icon name="lock" size={10} />
                    只读角色不能创建标签或回滚版本。
                  </p>
                )}
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
                    <Icon name="diff" size={11} />
                    标签间差异
                  </h3>
                  <span className="font-mono text-[8px] text-ink-faint">
                    净变更摘要
                  </span>
                </div>

                {tags && tags.length >= 2 ? (
                  <div className="rounded-xl border border-line bg-surface/75 p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block">
                        <span className="mb-1 block font-mono text-[8px] text-ink-faint">起始标签</span>
                        <select
                          value={diffFrom}
                          onChange={(event) => setDiffFrom(event.target.value)}
                          className="h-8 min-w-[130px] rounded-lg border border-line bg-surface px-2 font-mono text-[10px] text-ink-soft outline-none focus:border-pine-500"
                        >
                          {tags.map((tag) => (
                            <option key={tag.id} value={tag.name}>
                              {tag.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="pb-2 text-ink-faint" aria-hidden="true">→</span>
                      <label className="block">
                        <span className="mb-1 block font-mono text-[8px] text-ink-faint">结束标签</span>
                        <select
                          value={diffTo}
                          onChange={(event) => setDiffTo(event.target.value)}
                          className="h-8 min-w-[130px] rounded-lg border border-line bg-surface px-2 font-mono text-[10px] text-ink-soft outline-none focus:border-pine-500"
                        >
                          {tags.map((tag) => (
                            <option key={tag.id} value={tag.name}>
                              {tag.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={handleDiff}
                        disabled={diffLoading || !diffFrom || !diffTo}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[9.5px] font-medium text-ink-muted transition-colors hover:border-pine-300 hover:text-pine-700 disabled:cursor-wait disabled:opacity-60"
                      >
                        <Icon name="diff" size={11} />
                        {diffLoading ? '计算中…' : '计算差异'}
                      </button>
                    </div>

                    {diffError && (
                      <p className="mt-2 rounded-md border border-rosewood/20 bg-rosewood-soft px-2 py-1.5 text-[9px] leading-4 text-rosewood-deep" role="alert">
                        {diffError}
                      </p>
                    )}

                    {diff && (
                      <div className="mt-3 border-t border-line-soft pt-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[9.5px] font-medium text-ink-soft">
                            {diffFrom} → {diffTo}
                          </span>
                          <span className="rounded-full border border-pine-200 bg-pine-50 px-1.5 py-[1px] font-mono text-[8px] text-pine-700">
                            +{diff.summary.added} 新增
                          </span>
                          <span className="rounded-full border border-ochre/20 bg-ochre-soft px-1.5 py-[1px] font-mono text-[8px] text-ochre-deep">
                            ~{diff.summary.updated} 修改
                          </span>
                          <span className="rounded-full border border-rosewood/20 bg-rosewood-soft px-1.5 py-[1px] font-mono text-[8px] text-rosewood-deep">
                            −{diff.summary.deleted} 删除
                          </span>
                        </div>

                        {diff.items.length === 0 ? (
                          <p className="mt-2 text-[9px] text-ink-faint">
                            两个标签之间没有净变更。
                          </p>
                        ) : (
                          <ul className="mt-2 max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
                            {diff.items.map((item) => (
                              <li
                                key={`${item.entity_kind}-${item.entity_key}`}
                                className="flex items-start gap-2 rounded-lg border border-line-soft bg-canvas/35 px-2 py-1.5"
                              >
                                <span className={`shrink-0 rounded border px-1.5 py-[1px] font-mono text-[8px] ${OP_STYLES[item.op]}`}>
                                  {OP_LABELS[item.op]}
                                </span>
                                <span className="shrink-0 font-mono text-[8px] text-ink-faint">
                                  {KIND_LABELS[item.entity_kind]}
                                </span>
                                <span className="min-w-0 break-all font-mono text-[8.5px] text-ink-soft">
                                  {item.entity_key}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 flex items-center gap-1 text-[8px] text-ink-faint">
                          <Icon name="info" size={9} />
                          差异按实体自然键归并，统计净变化；标注不参与差异统计。
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-line bg-surface/60 px-3 py-4 text-center text-[9.5px] text-ink-faint">
                    至少创建两个标签后，才能对比标签之间的净变更。
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(pendingRollback)}
        title="回滚到版本标签"
        danger
        busy={rollingBack}
        confirmLabel="确认回滚"
        cancelLabel="取消"
        message={
          <div className="space-y-1.5">
            <p>
              将反做标签「{pendingRollback?.name}」之后的所有变更（含人工编辑与导入批次），
              并立即刷新画布。
            </p>
            <p className="font-mono text-[9px] text-ink-faint">
              回滚可重复执行（幂等）；标注不会被删除。
            </p>
          </div>
        }
        onConfirm={handleRollback}
        onCancel={() => {
          if (!rollingBack) setPendingRollback(null);
        }}
      />
    </div>
  );
}
