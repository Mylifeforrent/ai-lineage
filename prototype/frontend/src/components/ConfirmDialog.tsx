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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="relative z-[51] mx-auto w-full max-w-[400px] overflow-hidden rounded-xl border border-line bg-card shadow-modal animate-modal-in"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="flex items-start gap-3 px-4 py-4">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              danger
                ? 'bg-danger-soft text-danger-deep'
                : 'bg-warning-soft text-warning-deep'
            }`}
          >
            <Icon name={danger ? 'trash' : 'warning'} size={17} />
          </span>
          <div className="min-w-0">
            <h2
              id="confirm-dialog-title"
              className="text-[14px] font-semibold text-ink"
            >
              {title}
            </h2>
            <div className="mt-1.5 text-[13px] leading-5 text-ink-muted">
              {message}
            </div>
          </div>
        </div>
        <div className="flex h-12 items-center justify-end gap-2 border-t border-line-soft px-4">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-line-strong bg-card px-3 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-blue-400 hover:text-blue-700 active:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-70 ${
              danger
                ? 'bg-danger hover:bg-danger-deep active:bg-danger-deep focus-visible:ring-white/60'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-blue-600/60'
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
