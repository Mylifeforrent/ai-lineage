import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 通用二次确认弹窗（删除边、回滚标签等破坏性操作）。 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-line bg-surface shadow-float animate-modal-in"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="flex items-start gap-3 px-5 py-4">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              danger
                ? 'bg-rosewood-soft text-rosewood'
                : 'bg-ochre-soft text-ochre-deep'
            }`}
          >
            <Icon name={danger ? 'trash' : 'warning'} size={17} />
          </span>
          <div className="min-w-0">
            <h2
              id="confirm-dialog-title"
              className="text-[13px] font-semibold text-ink"
            >
              {title}
            </h2>
            <div className="mt-1.5 text-[10.5px] leading-5 text-ink-muted">
              {message}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line-soft bg-canvas/45 px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-8 rounded-lg border border-line bg-surface px-3 text-[10.5px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10.5px] font-semibold text-white transition-colors disabled:cursor-wait disabled:opacity-70 ${
              danger
                ? 'bg-rosewood hover:bg-rosewood-deep'
                : 'bg-pine-800 hover:bg-pine-900'
            }`}
          >
            {busy && (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
            )}
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
