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
import { useI18n } from '../i18n';
import type { VersionKey } from '../i18n/dicts/version';

interface VersionDrawerProps {
  token: string;
  role: string;
  onClose: () => void;
  onDataChanged: () => void;
  onNotify: (message: string, tone?: ToastTone) => void;
}

const KIND_LABEL_KEYS: Record<TargetKind, VersionKey> = {
  dataset: 'version.kind.dataset',
  field: 'version.kind.field',
  edge: 'version.kind.edge',
};

const OP_LABEL_KEYS: Record<ChangeOp, VersionKey> = {
  added: 'version.op.added',
  updated: 'version.op.updated',
  deleted: 'version.op.deleted',
};

const OP_STYLES: Record<ChangeOp, string> = {
  added: 'border-transparent bg-success-soft text-success-deep',
  updated: 'border-transparent bg-warning-soft text-warning-deep',
  deleted: 'border-transparent bg-danger-soft text-danger-deep',
};

export function VersionDrawer({
  token,
  role,
  onClose,
  onDataChanged,
  onNotify,
}: VersionDrawerProps) {
  const { t } = useI18n();
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
            : t('version.loadFailed'),
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
        onNotify(t('version.tagCreated', { name: created.name }), 'success');
      } catch (reason) {
        setCreateError(
          reason instanceof ApiError
            ? reason.message
            : t('version.createFailed'),
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
          : t('version.diffFailed'),
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
        t('version.rollbackDone', { name: pendingRollback.name, count: result.reverted }),
      );
      onNotify(t('version.rollbackToast', { name: pendingRollback.name }), 'success');
      setPendingRollback(null);
      setReloadKey((value) => value + 1);
      setDiff(null);
      onDataChanged();
    } catch (reason) {
      onNotify(
        reason instanceof ApiError
          ? reason.message
          : t('version.rollbackFailed'),
        'error',
      );
    } finally {
      setRollingBack(false);
    }
  }, [onDataChanged, onNotify, pendingRollback, rollingBack, token]);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-900/25 animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pendingRollback) {
          onClose();
        }
      }}
    >
      <aside
        className="relative z-[41] flex h-full w-full flex-col overflow-hidden border-l border-line bg-card shadow-float animate-drawer-in sm:w-[480px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-drawer-title"
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700">
              <Icon name="tag" size={16} />
            </span>
            <h2
              id="version-drawer-title"
              className="min-w-0 text-[14px] font-semibold text-ink"
            >
              {t('version.title')}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              aria-label={t('version.refresh')}
              title={t('version.refreshShort')}
            >
              <Icon name="refresh" size={14} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              aria-label={t('version.close')}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-page px-4 py-4">
          {loading && (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-14 animate-soft-pulse rounded-xl border border-line bg-subtle"
                />
              ))}
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3" role="alert">
              <p className="text-[13px] leading-5 text-danger-deep">{loadError}</p>
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                className="mt-2 inline-flex h-7 items-center gap-1 rounded-lg border border-line-strong bg-card px-2 text-[11px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              >
                <Icon name="refresh" size={11} />
                {t('history.reload')}
              </button>
            </div>
          )}

          {!loading && !loadError && (
            <div className="space-y-5">
              <div className="flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2.5 text-[12px] leading-5 text-ink-muted">
                <Icon name="info" size={12} className="mt-0.5 shrink-0 text-ink-faint" />
                <span>{t('version.rollbackIntro')}</span>
              </div>

              {rollbackNotice && (
                <div className="flex items-start gap-2 rounded-lg border border-success/25 bg-success-soft px-3 py-2.5 text-[12px] leading-4 text-success-deep">
                  <Icon name="check" size={12} className="mt-0.5 shrink-0" />
                  <span>{rollbackNotice}</span>
                </div>
              )}

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                    <Icon name="layers" size={11} />
                    {t('version.batches')}
                  </h3>
                  <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                    {t('version.batchCount', { count: batches?.length ?? 0 })}
                  </span>
                </div>
                {batches?.length ? (
                  <div className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-card">
                    {batches.map((batch) => (
                      <div
                        key={batch.id}
                        className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2.5"
                      >
                        <span className="font-mono text-[13px] font-semibold tabular-nums text-ink">
                          v{batch.version_no}
                        </span>
                        <span className="rounded border border-line bg-page px-1.5 py-px font-mono text-[11px] uppercase text-ink-faint">
                          {batch.format}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-faint" title={batch.file_names.join('、')}>
                          {batch.file_names.join('、') || '—'}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                          {formatDateTime(batch.created_at)} · {batch.created_by}
                        </span>
                        {batch.rolled_back_at ? (
                          <span className="rounded-full border border-line bg-subtle px-1.5 py-px font-mono text-[11px] text-ink-muted">
                            {t('version.rolledBack')}
                          </span>
                        ) : (
                          <span className="rounded-full border border-transparent bg-success-soft px-1.5 py-px font-mono text-[11px] text-success-deep">
                            {t('version.active')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-muted">
                    {t('version.noBatches')}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                    <Icon name="tag" size={11} />
                    {t('version.tags')}
                  </h3>
                  <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                    {t('version.tagCount', { count: tags?.length ?? 0 })}
                  </span>
                </div>

                {tags?.length ? (
                  <div className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-card">
                    {tags.map((tag) => (
                      <div key={tag.id} className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-[13px] font-semibold text-brand-800">
                            {tag.name}
                          </span>
                          <span className="rounded border border-line bg-page px-1.5 py-px font-mono text-[11px] tabular-nums text-ink-faint">
                            {t('version.changeSeq', { seq: tag.change_seq })}
                          </span>
                          <span className="font-mono text-[11px] text-ink-faint">
                            {formatDateTime(tag.created_at)} · {tag.created_by}
                          </span>
                          {canRollback && (
                            <button
                              type="button"
                              onClick={() => {
                                setRollbackNotice(null);
                                setPendingRollback(tag);
                              }}
                              className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-danger/25 bg-danger-soft px-2 text-[11px] font-medium text-danger-deep transition-colors duration-150 hover:border-danger/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                            >
                              <Icon name="rollback" size={11} />
                              {t('version.rollbackTo')}
                            </button>
                          )}
                        </div>
                        {tag.note && (
                          <p className="mt-1 break-words text-[12px] leading-4 text-ink-muted">
                            {tag.note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-muted">
                    {t('version.noTags')}
                  </div>
                )}

                {canWrite ? (
                  <form onSubmit={handleCreateTag} className="mt-2.5 rounded-xl border border-line bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="version-tag-name" className="sr-only">
                        {t('version.tagNameLabel')}
                      </label>
                      <input
                        id="version-tag-name"
                        type="text"
                        value={tagName}
                        onChange={(event) => setTagName(event.target.value)}
                        placeholder={t('version.tagNamePlaceholder')}
                        maxLength={64}
                        className="field-input h-8 w-[150px] font-mono text-[12px]"
                        disabled={creating}
                      />
                      <label htmlFor="version-tag-note" className="sr-only">
                        {t('version.tagNoteLabel')}
                      </label>
                      <input
                        id="version-tag-note"
                        type="text"
                        value={tagNote}
                        onChange={(event) => setTagNote(event.target.value)}
                        placeholder={t('version.tagNotePlaceholder')}
                        maxLength={200}
                        className="field-input h-8 min-w-[160px] flex-1 text-[13px]"
                        disabled={creating}
                      />
                      <button
                        type="submit"
                        disabled={creating || !tagName.trim()}
                        className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-brand-700 px-2.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                      >
                        <Icon name="plus" size={11} />
                        {creating ? t('version.creating') : t('version.createTag')}
                      </button>
                    </div>
                    <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
                      {t('version.tagHint')}
                    </p>
                    {createError && (
                      <p className="mt-1.5 rounded-md border border-danger/25 bg-danger-soft px-2 py-1.5 text-[11px] leading-4 text-danger-deep" role="alert">
                        {createError}
                      </p>
                    )}
                  </form>
                ) : (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
                    <Icon name="lock" size={11} />
                    {t('version.readonly')}
                  </p>
                )}
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                    <Icon name="diff" size={11} />
                    {t('version.diffTitle')}
                  </h3>
                  <span className="font-mono text-[11px] text-ink-faint">
                    {t('version.netChanges')}
                  </span>
                </div>

                {tags && tags.length >= 2 ? (
                  <div className="rounded-xl border border-line bg-card p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">{t('version.fromLabel')}</span>
                        <span className="relative block">
                          <select
                            value={diffFrom}
                            onChange={(event) => setDiffFrom(event.target.value)}
                            className="field-input h-8 min-w-[130px] appearance-none pr-8 font-mono text-[12px] text-ink-soft"
                          >
                            {tags.map((tag) => (
                              <option key={tag.id} value={tag.name}>
                                {tag.name}
                              </option>
                            ))}
                          </select>
                          <Icon
                            name="chevron-down"
                            size={14}
                            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint"
                          />
                        </span>
                      </label>
                      <Icon name="arrow-right" size={12} className="pb-2 text-ink-faint" aria-hidden="true" />
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">{t('version.toLabel')}</span>
                        <span className="relative block">
                          <select
                            value={diffTo}
                            onChange={(event) => setDiffTo(event.target.value)}
                            className="field-input h-8 min-w-[130px] appearance-none pr-8 font-mono text-[12px] text-ink-soft"
                          >
                            {tags.map((tag) => (
                              <option key={tag.id} value={tag.name}>
                                {tag.name}
                              </option>
                            ))}
                          </select>
                          <Icon
                            name="chevron-down"
                            size={14}
                            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint"
                          />
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={handleDiff}
                        disabled={diffLoading || !diffFrom || !diffTo}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-3 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-50"
                      >
                        <Icon name="diff" size={11} />
                        {diffLoading ? t('version.diffCalculating') : t('version.diffRun')}
                      </button>
                    </div>

                    {diffError && (
                      <p className="mt-2 rounded-md border border-danger/25 bg-danger-soft px-2 py-1.5 text-[11px] leading-4 text-danger-deep" role="alert">
                        {diffError}
                      </p>
                    )}

                    {diff && (
                      <div className="mt-3 border-t border-line-soft pt-3 animate-fade-in">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[12px] font-medium text-ink-soft">
                            {diffFrom} → {diffTo}
                          </span>
                          <span className="rounded-full border border-transparent bg-success-soft px-2 py-px font-mono text-[11px] tabular-nums text-success-deep">
                            {t('version.diffAdded', { count: diff.summary.added })}
                          </span>
                          <span className="rounded-full border border-transparent bg-warning-soft px-2 py-px font-mono text-[11px] tabular-nums text-warning-deep">
                            {t('version.diffUpdated', { count: diff.summary.updated })}
                          </span>
                          <span className="rounded-full border border-transparent bg-danger-soft px-2 py-px font-mono text-[11px] tabular-nums text-danger-deep">
                            {t('version.diffDeleted', { count: diff.summary.deleted })}
                          </span>
                        </div>

                        {diff.items.length === 0 ? (
                          <p className="mt-2 text-[12px] text-ink-muted">
                            {t('version.diffEmpty')}
                          </p>
                        ) : (
                          <ul className="mt-2 max-h-[240px] divide-y divide-line-soft overflow-y-auto overflow-hidden rounded-lg border border-line-soft">
                            {diff.items.map((item) => (
                              <li
                                key={`${item.entity_kind}-${item.entity_key}`}
                                className="flex items-start gap-2 bg-card px-2.5 py-1.5"
                              >
                                <span className={`shrink-0 rounded border px-1.5 py-px font-mono text-[11px] ${OP_STYLES[item.op]}`}>
                                  {t(OP_LABEL_KEYS[item.op])}
                                </span>
                                <span className="shrink-0 text-[11px] text-ink-faint">
                                  {t(KIND_LABEL_KEYS[item.entity_kind])}
                                </span>
                                <span className="min-w-0 break-all font-mono text-[12px] text-ink-soft">
                                  {item.entity_key}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-faint">
                          <Icon name="info" size={10} />
                          {t('version.diffHint')}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-muted">
                    {t('version.diffNeedTwo')}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(pendingRollback)}
        title={t('version.rollbackTitle')}
        danger
        busy={rollingBack}
        confirmLabel={t('version.rollbackConfirm')}
        cancelLabel={t('common.cancel')}
        message={
          <div className="space-y-1.5">
            <p>
              {t('version.rollbackMessage', { name: pendingRollback?.name ?? '' })}
            </p>
            <p className="font-mono text-[11px] leading-4 text-ink-faint">
              {t('version.rollbackIdempotent')}
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
