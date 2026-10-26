import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EdgeDraft, LineageEdge } from '../types';
import { ApiError, createEdge, isAbortError } from '../lib/api';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';
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

  const isFieldLevel = draft.from_field !== null && draft.to_field !== null;
  const fromLabel = `${draft.from_dataset}.${draft.from_field ?? '*'}`;
  const toLabel = `${draft.to_dataset}.${draft.to_field ?? '*'}`;

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

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
    <ModalShell
      variant="modal"
      open
      title={t('edgeCreate.title')}
      titleId="edge-create-title"
      titleIcon="link"
      eyebrow={isFieldLevel ? t('edgeCreate.eyebrowField') : t('edgeCreate.eyebrowTable')}
      onRequestClose={onClose}
      dismissable={!submitting}
      overlayClassName="p-3 sm:p-6"
      className="max-w-[560px]"
      closeLabel={t('edgeCreate.close')}
      bodyClassName="px-4 py-4"
      footerClassName="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line-soft bg-card px-4"
      footer={
        <>
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
            form="edge-create-form"
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
        </>
      }
    >
      {/* footer 提交按钮经 form 属性关联本表单（ModalShell 结构下 footer 在 form 之外） */}
      <form id="edge-create-form" onSubmit={handleSubmit}>
        <div className="space-y-3.5">
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
      </form>
    </ModalShell>
  );
}
