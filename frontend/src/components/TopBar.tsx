import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Session } from '../types';
import { isAdmin, roleLabel } from '../lib/roles';
import { Brand } from './Brand';
import { Icon } from './Icon';
import { LanguageToggle } from './LanguageToggle';
import { useI18n } from '../i18n';

// 与后端 /lineage/subgraph 的 hops 1..5 契约保持一致
const HOP_OPTIONS = [1, 2, 3, 4, 5] as const;

// 角色徽章三套（00 §7.4）：admin/editor/viewer，未知角色按 viewer 中性档兜底
const ROLE_BADGE_CLASSES: Record<string, string> = {
  admin: 'border-transparent bg-brand-800 text-white',
  editor: 'border-brand-200 bg-brand-50 text-brand-800',
  viewer: 'border-line bg-subtle text-ink-muted',
};

interface TopBarProps {
  session: Session;
  search: string;
  onSearchChange: (value: string) => void;
  datasetCount: number;
  visibleCount: number;
  hops: number;
  onHopsChange: (hops: number) => void;
  graphLoading: boolean;
  aiOpen: boolean;
  onOpenAi: () => void;
  onOpenImport: () => void;
  /** editor+ 才渲染「导入数据」入口（不渲染写入口模式，权限校验在后端） */
  canImport: boolean;
  onOpenVersions: () => void;
  onOpenUsers: () => void;
  onLogout: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

/** 用户菜单中的语言切换项（md 以下替代顶栏 LanguageToggle）：语言名用原文名 */
const LOCALE_MENU_OPTIONS: ReadonlyArray<{ value: 'zh' | 'en'; nameKey: 'langToggle.zhName' | 'langToggle.enName' }> = [
  { value: 'zh', nameKey: 'langToggle.zhName' },
  { value: 'en', nameKey: 'langToggle.enName' },
];

export function TopBar({
  session,
  search,
  onSearchChange,
  datasetCount,
  visibleCount,
  hops,
  onHopsChange,
  graphLoading,
  aiOpen,
  onOpenAi,
  onOpenImport,
  canImport,
  onOpenVersions,
  onOpenUsers,
  onLogout,
}: TopBarProps) {
  const { t, locale, setLocale } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const hopButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [userMenuOpen]);

  const initials = Array.from(session.username).slice(0, 2).join('').toUpperCase();
  const admin = isAdmin(session.role);

  /** radiogroup 键盘协议：方向键在 1–5 间移动并立即选中（roving tabindex，选中项持有 Tab 位） */
  function handleHopKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    option: number,
  ) {
    const options: readonly number[] = HOP_OPTIONS;
    const index = options.indexOf(option);
    let delta = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') delta = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') delta = -1;
    else return;
    event.preventDefault();
    const next = options[Math.min(options.length - 1, Math.max(0, index + delta))];
    if (next === undefined || next === option) return;
    onHopsChange(next);
    hopButtonRefs.current.get(next)?.focus();
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 min-w-0 shrink-0 items-center gap-3 border-b border-line bg-card px-4 xl:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Brand />
        <span className="hidden h-8 w-px bg-line xl:block" />
        <div className="hidden xl:block">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            {t('topbar.workspacePath')}
          </div>
          <h1 className="mt-0.5 text-[13px] font-semibold text-ink-soft">
            {t('topbar.pageTitle')}
          </h1>
        </div>
      </div>

      <div className="min-w-[180px] md:ml-2 md:max-w-[340px] md:flex-1">
        <div className="group relative">
          <label htmlFor="dataset-search" className="sr-only">
            {t('topbar.searchLabel')}
          </label>
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint transition-colors duration-150 group-focus-within:text-brand-600">
            <Icon name="search" size={14} />
          </span>
          <input
            ref={searchRef}
            id="dataset-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('topbar.searchPlaceholder')}
            className="field-input h-8 rounded-lg pl-9 pr-[92px] text-[13px]"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            {search ? (
              <button
                type="button"
                onClick={() => {
                  onSearchChange('');
                  searchRef.current?.focus();
                }}
                className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1"
                aria-label={t('topbar.clearSearch')}
              >
                <Icon name="close" size={12} />
              </button>
            ) : (
              <kbd className="rounded border border-line bg-card px-1.5 font-mono text-[11px] leading-4 text-ink-faint">
                /
              </kbd>
            )}
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">
              {visibleCount}/{datasetCount}
            </span>
          </span>
        </div>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2.5 sm:gap-3">
        {canImport && (
          <button
            type="button"
            onClick={onOpenImport}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand-700 px-2.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            title={t('topbar.importTitle')}
            aria-label={t('topbar.import')}
          >
            <Icon name="upload" size={14} />
            {/* R14：lg 以下降为 icon-only，文案仅保留在 ≥lg 档 */}
            <span className="hidden lg:inline">{t('topbar.import')}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenAi}
          aria-haspopup="dialog"
          aria-expanded={aiOpen}
          aria-label={t('topbar.ai')}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
            aiOpen
              ? 'border-ai/25 bg-ai-soft text-ai-deep'
              : 'border-line bg-card text-ink-muted hover:border-ai/25 hover:text-ai-deep'
          }`}
          title={t('topbar.aiTitle')}
        >
          <Icon name="sparkles" size={14} className={aiOpen ? 'text-ai' : ''} />
          <span className="hidden lg:inline">{t('topbar.ai')}</span>
        </button>

        <button
          type="button"
          onClick={onOpenVersions}
          aria-label={t('topbar.versions')}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-card px-2.5 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 active:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
          title={t('topbar.versionsTitle')}
        >
          <Icon name="tag" size={14} />
          <span className="hidden lg:inline">{t('topbar.versions')}</span>
        </button>

        {/* R14：md 及以上为 radiogroup 按钮组（单选语义 + roving tabindex）；md 以下收为单个下拉 */}
        <div className="hidden shrink-0 items-center gap-2 rounded-lg border border-line bg-card p-1 pl-2.5 md:flex">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            {t('topbar.hops')}
          </span>
          <div
            className="flex items-center gap-0.5"
            role="radiogroup"
            aria-label={t('topbar.hopsGroup')}
          >
            {HOP_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === hops}
                tabIndex={option === hops ? 0 : -1}
                ref={(element) => {
                  if (element) hopButtonRefs.current.set(option, element);
                  else hopButtonRefs.current.delete(option);
                }}
                onClick={() => onHopsChange(option)}
                onKeyDown={(event) => handleHopKeyDown(event, option)}
                className={`flex h-7 min-w-[25px] items-center justify-center rounded-md px-1.5 font-mono text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 ${
                  option === hops
                    ? 'bg-brand-700 text-white'
                    : 'text-ink-muted hover:bg-subtle hover:text-ink'
                }`}
                aria-label={t('topbar.hopLabel', { count: option })}
              >
                {option}
              </button>
            ))}
          </div>
          {graphLoading && (
            <span
              className="mr-1 h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-brand-300 border-t-brand-700"
              aria-label={t('topbar.loadingSubgraph')}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center md:hidden">
          <select
            value={hops}
            onChange={(event) => onHopsChange(Number(event.target.value))}
            aria-label={t('topbar.hopsGroup')}
            className="h-8 rounded-lg border border-line bg-card px-2 font-mono text-[12px] text-ink-soft transition-colors duration-150 hover:border-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
          >
            {HOP_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t('topbar.hopLabel', { count: option })}
              </option>
            ))}
          </select>
          {graphLoading && (
            <span
              className="ml-1.5 h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-brand-300 border-t-brand-700"
              aria-label={t('topbar.loadingSubgraph')}
            />
          )}
        </div>

        {/* R14：md 以下语言切换并入用户菜单，顶栏不再占位 */}
        <div className="hidden md:block">
          <LanguageToggle />
        </div>

        <div
          ref={userMenuRef}
          className="relative flex items-center gap-2 border-l border-line pl-3"
        >
          <button
            type="button"
            onClick={() => setUserMenuOpen((value) => !value)}
            className="flex items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors duration-150 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            title={t('topbar.userMenu')}
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-800 font-mono text-[11px] font-medium text-white"
              aria-hidden="true"
            >
              {initials}
            </span>
            <span className="hidden sm:block">
              <span className="block max-w-[110px] truncate text-[13px] font-medium text-ink">
                {session.username}
              </span>
              <span
                className={`mt-0.5 inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium leading-none ${
                  ROLE_BADGE_CLASSES[session.role] ?? ROLE_BADGE_CLASSES.viewer
                }`}
              >
                {roleLabel(session.role, t)}
              </span>
            </span>
            <Icon
              name="chevron-down"
              size={12}
              className={`hidden shrink-0 text-ink-faint transition-transform duration-150 sm:block ${
                userMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {userMenuOpen && (
            <div
              className="absolute right-0 top-full z-30 mt-2 w-[200px] overflow-hidden rounded-lg border border-line bg-card py-1 shadow-float animate-fade-in"
              role="menu"
              aria-label={t('topbar.userMenu')}
            >
              <div className="border-b border-line-soft bg-page px-3 py-2.5">
                <div className="truncate text-[13px] font-medium text-ink">
                  {session.username}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span
                    className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium leading-none ${
                      ROLE_BADGE_CLASSES[session.role] ?? ROLE_BADGE_CLASSES.viewer
                    }`}
                  >
                    {roleLabel(session.role, t)}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {session.role}
                  </span>
                </div>
              </div>
              {/* R14：md 以下语言切换并入用户菜单（menuitemradio 单选语义） */}
              <div className="px-3 py-2 md:hidden">
                <div
                  className="mb-1.5 text-[11px] text-ink-faint"
                  aria-hidden="true"
                >
                  {t('langToggle.label')}
                </div>
                <div className="flex gap-1.5" role="group" aria-label={t('langToggle.label')}>
                  {LOCALE_MENU_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={locale === option.value}
                      onClick={() => setLocale(option.value)}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 ${
                        locale === option.value
                          ? 'border-brand-200 bg-brand-50 text-brand-800'
                          : 'border-line bg-card text-ink-muted hover:bg-subtle hover:text-ink'
                      }`}
                    >
                      {locale === option.value && (
                        <Icon name="check" size={11} />
                      )}
                      {t(option.nameKey)}
                    </button>
                  ))}
                </div>
              </div>
              {admin && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onOpenUsers();
                  }}
                  className="flex h-8 w-full items-center gap-2 px-3 text-left text-[13px] text-ink-soft transition-colors duration-150 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
                >
                  <Icon name="users" size={13} />
                  {t('topbar.userManagement')}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  onLogout();
                }}
                className="mt-1 flex h-8 w-full items-center gap-2 border-t border-line-soft px-3 text-left text-[13px] text-ink-soft transition-colors duration-150 hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none"
              >
                <Icon name="logout" size={13} />
                {t('topbar.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
