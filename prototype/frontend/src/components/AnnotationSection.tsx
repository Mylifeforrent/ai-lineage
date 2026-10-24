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
            : '无法读取标注，请稍后重试。',
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
            : '标注提交失败，请稍后重试。',
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
        <h3 className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
          <Icon name="message-square" size={11} />
          标注（{count}）
        </h3>
        <span className="rounded-full border border-line bg-canvas/55 px-1.5 py-[1px] font-mono text-[8px] text-ink-faint">
          追加式
        </span>
      </div>

      <div className="space-y-2">
        {loading && (
          <div className="animate-soft-pulse rounded-xl border border-line-soft bg-surface/60 px-3 py-3 text-[9.5px] text-ink-faint">
            正在读取标注…
          </div>
        )}
        {!loading && loadError && (
          <div className="rounded-xl border border-rosewood/20 bg-rosewood-soft px-3 py-2.5 text-[9.5px] leading-4 text-rosewood-deep">
            {loadError}
          </div>
        )}
        {!loading && !loadError && count === 0 && (
          <div className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-[9.5px] text-ink-faint">
            暂无标注
          </div>
        )}
        {!loading &&
          !loadError &&
          (items ?? []).map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-line-soft bg-surface/75 px-3 py-2.5"
            >
              <p className="whitespace-pre-wrap break-words text-[10px] leading-[1.7] text-ink-soft">
                {item.body}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[8px] text-ink-faint">
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
            添加标注
          </label>
          <textarea
            id={`annotation-${targetKind}-${targetId}`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="添加标注（追加式，不覆盖原值）"
            className="field-input min-h-[62px] resize-y py-2 text-[10.5px] leading-5"
            disabled={submitting}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="font-mono text-[8px] text-ink-faint">
              {body.length}/4000 · 标注不随版本回滚删除
            </span>
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="flex h-7 items-center gap-1 rounded-md bg-pine-800 px-2.5 text-[9.5px] font-medium text-white transition-colors hover:bg-pine-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="plus" size={10} />
              {submitting ? '提交中…' : '提交标注'}
            </button>
          </div>
          {submitError && (
            <p className="mt-1.5 rounded-md border border-rosewood/20 bg-rosewood-soft px-2 py-1.5 text-[9px] leading-4 text-rosewood-deep" role="alert">
              {submitError}
            </p>
          )}
        </form>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-[8.5px] text-ink-faint">
          <Icon name="lock" size={10} />
          当前角色为只读，不能追加标注。
        </p>
      )}
    </section>
  );
}
