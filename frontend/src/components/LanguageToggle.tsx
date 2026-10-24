import { useI18n, type Locale } from '../i18n';

const OPTIONS: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'zh', label: '中' },
  { value: 'en', label: 'EN' },
];

/** 中/EN 两段式语言切换；偏好持久化由 I18nProvider 负责。 */
export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t('langToggle.label')}
      className="flex h-7 items-center rounded-lg border border-line-strong bg-card p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = locale === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setLocale(option.value)}
            aria-pressed={active}
            className={`flex h-6 items-center rounded-md px-1.5 font-mono text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 ${
              active
                ? 'bg-subtle text-ink'
                : 'text-ink-faint hover:text-ink-soft'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
