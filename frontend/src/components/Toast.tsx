import { Icon } from './Icon';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-success/25 bg-success-soft text-success-deep',
  error: 'border-danger/25 bg-danger-soft text-danger-deep',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
};

const TONE_ICONS = {
  success: 'check',
  error: 'warning',
  info: 'info',
} as const;

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] max-w-[calc(100vw-2rem)]"
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
    >
      <div
        className={`flex h-10 max-w-md items-center gap-2 rounded-lg border px-3.5 text-[13px] shadow-float animate-fade-up ${TONE_STYLES[toast.tone]}`}
      >
        <Icon name={TONE_ICONS[toast.tone]} size={14} className="shrink-0" />
        <span className="min-w-0 break-words">{toast.message}</span>
      </div>
    </div>
  );
}
