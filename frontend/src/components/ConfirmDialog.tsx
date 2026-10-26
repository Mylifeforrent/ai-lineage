import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';
import { useI18n } from '../i18n';

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
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (!open) return null;

  return (
    <ModalShell
      variant="modal"
      open={open}
      title={title}
      titleId="confirm-dialog-title"
      role="alertdialog"
      onRequestClose={onCancel}
      dismissable={!busy}
      overlayClassName="p-4"
      className="max-w-[400px]"
      // alertdialog 的「徽章+标题+正文同块、无关闭钮」布局整体接管 header（视觉零变化）
      header={
        <div className="flex items-start gap-3 px-4 py-4">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              danger
                ? 'bg-danger-soft text-danger'
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
      }
      initialFocusRef={cancelRef}
      footer={
        <>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-line-strong bg-card px-3 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 active:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-white transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-70 ${
              danger
                ? 'bg-danger hover:bg-danger-deep active:bg-danger-deep focus-visible:ring-white/60'
                : 'bg-brand-700 hover:bg-brand-800 active:bg-brand-900 focus-visible:ring-brand-600/60'
            }`}
          >
            {busy && (
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
            )}
            {busy ? t('confirmDialog.busy') : (confirmLabel ?? t('common.confirm'))}
          </button>
        </>
      }
    />
  );
}
