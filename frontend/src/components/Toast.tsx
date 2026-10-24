import { Icon } from './Icon';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-pine-200 bg-pine-50 text-pine-800',
  error: 'border-rosewood/25 bg-rosewood-soft text-rosewood-deep',
  info: 'border-line bg-surface text-ink-soft',
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
      className="pointer-events-none fixed bottom-5 left-1/2 z-[95] w-[calc(100%-2rem)] max-w-md -translate-x-1/2"
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
    >
      <div
        className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[10.5px] leading-5 shadow-float backdrop-blur-sm animate-fade-up ${TONE_STYLES[toast.tone]}`}
      >
        <Icon name={TONE_ICONS[toast.tone]} size={13} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">{toast.message}</span>
      </div>
    </div>
  );
}
