import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Annotation, TargetKind } from '../types';
import {
  ApiError,
  createAnnotation,
  getAnnotations,
  isAbortError,
} from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Icon } from './Icon';
import { useI18n } from '../i18n';

interface AnnotationSectionProps {
  token: string;
  targetKind: TargetKind;
  targetId: string;
  canWrite: boolean;
}

/**
 * 标注区：追加式、只增不改，不写 change_log，也不随版本回滚删除。
 * viewer 可读；editor+ 才显示追加输入。
 */
export function AnnotationSection({
  token,
  targetKind,
  targetId,
  canWrite,
}: AnnotationSectionProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<Annotation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoading(true);
    setLoadError(null);
    setItems(null);
    setSubmitError(null);
    setBody('');

    getAnnotations(token, targetKind, targetId, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setItems(rows);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setLoadError(
          reason instanceof ApiError
            ? reason.message
            : t('annotation.loadFailed'),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [token, targetKind, targetId]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = body.trim();
      if (!text || submitting) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const created = await createAnnotation(token, {
          target_kind: targetKind,
          target_id: targetId,
          body: text,
        });
        setItems((current) => [...(current ?? []), created]);
        setBody('');
      } catch (reason) {
        setSubmitError(
          reason instanceof ApiError
            ? reason.message
            : t('annotation.submitFailed'),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [body, submitting, targetId, targetKind, token],
  );

  const count = items?.length ?? 0;

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
          <Icon name="message-square" size={12} />
          {t('annotation.title', { count })}
        </h3>
        <span className="rounded-full border border-line bg-page px-1.5 py-px font-mono text-[11px] text-ink-faint">
          {t('annotation.appendOnly')}
        </span>
      </div>

      <div className="space-y-2">
        {loading && (
          <div className="animate-soft-pulse rounded-lg border border-line-soft bg-subtle px-3 py-3 text-[12px] text-ink-muted">
            {t('annotation.loading')}
          </div>
        )}
        {!loading && loadError && (
          <div className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12px] leading-4 text-danger-deep">
            {loadError}
          </div>
        )}
        {!loading && !loadError && count === 0 && (
          <div className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[12px] text-ink-muted">
            {t('annotation.empty')}
          </div>
        )}
        {!loading &&
          !loadError &&
          (items ?? []).map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-line-soft bg-card px-3 py-2.5"
            >
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-soft">
                {item.body}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ink-faint">
                <span>{item.author}</span>
                <span className="h-2 w-px bg-line" />
                <span>{formatDateTime(item.created_at)}</span>
              </div>
            </article>
          ))}
      </div>

      {canWrite ? (
        <form onSubmit={handleSubmit} className="mt-2">
          <label htmlFor={`annotation-${targetKind}-${targetId}`} className="sr-only">
            {t('annotation.inputLabel')}
          </label>
          <textarea
            id={`annotation-${targetKind}-${targetId}`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={4000}
            placeholder={t('annotation.placeholder')}
            className="field-input min-h-[62px] resize-y py-2 text-[13px] leading-5"
            disabled={submitting}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-ink-faint">
              {t('annotation.counter', { count: body.length })}
            </span>
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="flex h-7 items-center gap-1 rounded-lg bg-brand-700 px-2.5 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              <Icon name="plus" size={12} />
              {submitting ? t('annotation.submitting') : t('annotation.submit')}
            </button>
          </div>
          {submitError && (
            <p className="mt-1.5 rounded-md border border-danger/25 bg-danger-soft px-2 py-1.5 text-[11px] leading-4 text-danger-deep" role="alert">
              {submitError}
            </p>
          )}
        </form>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
          <Icon name="lock" size={10} />
          {t('annotation.readonly')}
        </p>
      )}
    </section>
  );
}
