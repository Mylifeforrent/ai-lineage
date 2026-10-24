import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EdgeDraft, LineageEdge } from '../types';
import { ApiError, createEdge, isAbortError } from '../lib/api';
import { Icon } from './Icon';

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
      setError('置信度必须是 0 到 1 之间的数字。');
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
          : '新增血缘失败，请稍后重试。',
      );
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/45 p-3 backdrop-blur-[3px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="w-full max-w-[520px] overflow-hidden rounded-2xl border border-line bg-surface shadow-float animate-modal-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edge-create-title"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-pine-200 bg-pine-50 text-pine-700">
              <Icon name="link" size={17} />
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
                人工补边 · {isFieldLevel ? '字段级' : '表级'}
              </div>
              <h2 id="edge-create-title" className="mt-1 text-[15px] font-semibold text-ink">
                新增血缘
              </h2>
              <p className="mt-1 break-all font-mono text-[9.5px] leading-4 text-ink-muted">
                {fromLabel}
                <span className="mx-1.5 text-ink-faint">→</span>
                {toLabel}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft disabled:opacity-50"
            aria-label="关闭新增血缘弹窗"
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="space-y-3.5 px-4 py-4 sm:px-5">
            <div>
              <label
                htmlFor="edge-transform"
                className="mb-1 block text-[10.5px] font-medium text-ink-soft"
              >
                转换说明
              </label>
              <input
                id="edge-transform"
                type="text"
                value={transform}
                onChange={(event) => setTransform(event.target.value)}
                placeholder="如 trim/cast、lookup、金额汇总"
                className="field-input h-9"
                disabled={submitting}
                maxLength={200}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
              <div>
                <label
                  htmlFor="edge-confidence"
                  className="mb-1 block text-[10.5px] font-medium text-ink-soft"
                >
                  置信度（0~1）
                </label>
                <input
                  id="edge-confidence"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={confidence}
                  onChange={(event) => setConfidence(event.target.value)}
                  className="field-input h-9 font-mono"
                  disabled={submitting}
                />
              </div>
              <div>
                <label
                  htmlFor="edge-note"
                  className="mb-1 block text-[10.5px] font-medium text-ink-soft"
                >
                  备注
                </label>
                <input
                  id="edge-note"
                  type="text"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="为什么补这条边（可选）"
                  className="field-input h-9"
                  disabled={submitting}
                  maxLength={500}
                />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-line-soft bg-canvas/45 px-3 py-2 text-[9px] leading-4 text-ink-faint">
              <Icon name="info" size={11} className="mt-0.5 shrink-0" />
              <span>
                人工边来源记为 manual，会写入变更日志；同一上下游已存在血缘时后端返回 409。
              </span>
            </div>

            {error && (
              <div
                className="flex gap-2 rounded-lg border border-rosewood/20 bg-rosewood-soft px-3 py-2 text-[10px] leading-4 text-rosewood-deep"
                role="alert"
              >
                <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-line bg-canvas/40 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-8 rounded-lg border border-line bg-surface px-3 text-[10.5px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-pine-800 px-3.5 text-[10.5px] font-semibold text-white transition-colors hover:bg-pine-900 disabled:cursor-wait disabled:opacity-65"
            >
              {submitting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                  创建中…
                </>
              ) : (
                <>
                  <Icon name="plus" size={12} />
                  创建血缘边
                </>
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
