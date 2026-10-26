import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { zh } from './zh';
import { en } from './en';

/** 支持的语言。默认 zh，不做浏览器自动检测（行为可预期）。 */
export type Locale = 'zh' | 'en';

/** 全部消息键：以 zh 聚合字典为类型基准，en 由各字典模块局部约束。 */
export type MessageKey = keyof typeof zh;

export type TranslateParams = Record<string, string | number>;

/** t(key, params)：{var} 插值；复数语义由字典措辞规避（如 `Fields · {count}`）。 */
export type TranslateFn = (
  key: MessageKey,
  params?: TranslateParams,
) => string;

const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { zh, en };
const LOCALE_STORAGE_KEY = 'clew.locale';
const HTML_LANG: Record<Locale, string> = { zh: 'zh-CN', en: 'en' };
const DOCUMENT_TITLES: Record<Locale, string> = {
  zh: 'Clew · 字段级血缘',
  en: 'Clew · Field-level Data Lineage',
};

/** 非 React 模块（如 lib/api.ts）可用的静态翻译：跟随最近一次 Provider 挂载/切换的 locale。 */
let activeLocale: Locale = 'zh';

/** 非 React 模块读取当前 locale（与 tStatic 同源，跟随最近一次 Provider 挂载/切换）。 */
export function getStaticLocale(): Locale {
  return activeLocale;
}

export function tStatic(key: MessageKey, params?: TranslateParams): string {
  const template = DICTS[activeLocale][key] ?? zh[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function readInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    // localStorage 不可用（隐私模式等）时回退默认语言
  }
  return 'zh';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  activeLocale = locale;

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[locale];
    document.title = DOCUMENT_TITLES[locale];
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // 持久化失败不影响本次会话切换
    }
  }, []);

  const t = useCallback<TranslateFn>(
    (key, params) => {
      const template = DICTS[locale][key] ?? zh[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      );
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n 必须在 I18nProvider 内使用');
  return context;
}
