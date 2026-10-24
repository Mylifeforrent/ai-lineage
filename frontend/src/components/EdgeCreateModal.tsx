import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EdgeDraft, LineageEdge } from '../types';
import { ApiError, createEdge, isAbortError } from '../lib/api';
import { Icon } from './Icon';
import { useI18n } from '../i18n';

interface EdgeCreateModalProps {
  draft: EdgeDraft;
  token: string;
  onClose: () => void;
  onCreated: (edge: LineageEdge) => void;
}

/**
 * 画布 handle 拖拽后的「新增血缘」二次确认。
 * 字段级 / 表级由 draft 的 from_field / to_field 是否为空决定。
 */
export function EdgeCreateModal({
  draft,
  token,
  onClose,
  onCreated,
}: EdgeCreateModalProps) {
  const { t } = useI18n();
  const [transform, setTransform] = useState('');
  const [confidence, setConfidence] = useState('1');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const isFieldLevel = draft.from_field !== null && draft.to_field !== null;
  const fromLabel = `${draft.from_dataset}.${draft.from_field ?? '*'}`;
  const toLabel = `${draft.to_dataset}.${draft.to_field ?? '*'}`;

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, submitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const parsedConfidence = Number(confidence);
    if (!Number.isFinite(parsedConfidence) || parsedConfidence < 0 || parsedConfidence > 1) {
      setError(t('edgeCreate.confidenceInvalid'));
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createEdge(
        token,
        {
          ...draft,
          transform: transform.trim() || null,
          confidence: parsedConfidence,
          note: note.trim() || null,
        },
        controller.signal,
      );
      onCreated(created);
    } catch (reason) {
      if (isAbortError(reason)) return;
      setError(
        reason instanceof ApiError
          ? reason.message
          : t('edgeCreate.submitFailed'),
      );
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3 animate-fade-in sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="relative z-[51] w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-card shadow-modal animate-modal-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edge-create-title"
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700">
              <Icon name="link" size={16} />
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                {isFieldLevel ? t('edgeCreate.eyebrowField') : t('edgeCreate.eyebrowTable')}
              </div>
              <h2 id="edge-create-title" className="mt-0.5 text-[14px] font-semibold text-ink">
                {t('edgeCreate.title')}
              </h2>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('edgeCreate.close')}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="space-y-3.5 px-4 py-4">
            <p className="break-all font-mono text-[13px] leading-5 text-ink-soft">
              {fromLabel}
              <span className="mx-1.5 text-ink-faint">→</span>
              {toLabel}
            </p>

            <div>
              <label
                htmlFor="edge-transform"
                className="mb-1.5 block text-[12px] font-medium text-ink-soft"
              >
                {t('edgeCreate.transformLabel')}
              </label>
              <input
                id="edge-transform"
                type="text"
                value={transform}
                onChange={(event) => setTransform(event.target.value)}
                placeholder={t('edgeCreate.transformPlaceholder')}
                className="field-input h-9 text-[13px]"
                disabled={submitting}
                maxLength={200}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
              <div>
                <label
                  htmlFor="edge-confidence"
                  className="mb-1.5 block text-[12px] font-medium text-ink-soft"
                >
                  {t('edgeCreate.confidenceLabel')}
                </label>
                <input
                  id="edge-confidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={confidence}
                  onChange={(event) => setConfidence(event.target.value)}
                  className="field-input h-9 font-mono text-[13px]"
                  disabled={submitting}
                />
              </div>
              <div>
                <label
                  htmlFor="edge-note"
                  className="mb-1.5 block text-[12px] font-medium text-ink-soft"
                >
                  {t('edgeCreate.noteLabel')}
                </label>
                <input
                  id="edge-note"
                  type="text"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('edgeCreate.notePlaceholder')}
                  className="field-input h-9 text-[13px]"
                  disabled={submitting}
                  maxLength={500}
                />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-[12px] leading-4 text-brand-800">
              <Icon name="info" size={12} className="mt-0.5 shrink-0" />
              <span>
                {t('edgeCreate.hint')}
              </span>
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
          </div>

          <footer className="flex h-12 items-center justify-end gap-2 border-t border-line-soft bg-card px-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-8 rounded-lg border border-line-strong bg-card px-3 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {submitting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                  {t('edgeCreate.creating')}
                </>
              ) : (
                <>
                  <Icon name="plus" size={12} />
                  {t('edgeCreate.submit')}
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
