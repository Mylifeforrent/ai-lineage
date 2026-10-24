import { useEffect, useRef, useState } from 'react';
import type { Session } from '../types';
import { isAdmin, roleLabel } from '../lib/roles';
import { Brand } from './Brand';
import { Icon } from './Icon';

// 与后端 /lineage/subgraph 的 hops 1..5 契约保持一致
const HOP_OPTIONS = [1, 2, 3, 4, 5] as const;

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
  onOpenVersions,
  onOpenUsers,
  onLogout,
}: TopBarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
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

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-line bg-surface/95 backdrop-blur-sm">
      <div className="flex min-h-[68px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6 xl:px-7">
        <div className="flex min-w-0 items-center gap-4">
          <Brand />
          <span className="hidden h-8 w-px bg-line xl:block" />
          <div className="hidden xl:block">
            <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
              工作台 / 血缘画布
            </div>
            <h1 className="mt-0.5 text-[13px] font-semibold tracking-wide text-ink-soft">
              血缘画布
            </h1>
          </div>
        </div>

        <div className="order-3 w-full min-w-[180px] md:order-none md:ml-2 md:max-w-[340px] md:flex-1">
          <div className="group relative">
            <label htmlFor="dataset-search" className="sr-only">
              搜索数据集或字段
            </label>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint transition-colors group-focus-within:text-pine-600">
              <Icon name="search" size={15} />
            </span>
            <input
              ref={searchRef}
              id="dataset-search"
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="搜索数据集 / 字段…"
              className="h-9 w-full rounded-lg border border-line bg-canvas/60 pl-9 pr-[92px] text-[12px] text-ink outline-none transition-all placeholder:text-ink-faint hover:border-line-strong focus:border-pine-500 focus:bg-surface focus:ring-2 focus:ring-pine-500/15"
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
                  className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded text-ink-faint transition-colors hover:bg-line-soft hover:text-ink-soft"
                  aria-label="清空搜索"
                >
                  <Icon name="close" size={12} />
                </button>
              ) : (
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[9px] leading-3 text-ink-faint shadow-sm">
                  /
                </kbd>
              )}
              <span className="font-mono text-[9px] tabular-nums text-ink-faint">
                {visibleCount}/{datasetCount}
              </span>
            </span>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onOpenAi}
            aria-haspopup="dialog"
            aria-expanded={aiOpen}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35 ${
              aiOpen
                ? 'border-ai/30 bg-ai-soft text-ai-deep'
                : 'border-line bg-canvas/55 text-ink-muted hover:border-ai/25 hover:text-ai-deep'
            }`}
            title="打开 AI 助手：自然语言查血缘并联动出图"
          >
            <Icon name="sparkles" size={13} className={aiOpen ? 'text-ai' : ''} />
            AI 助手
          </button>

          <button
            type="button"
            onClick={onOpenVersions}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-canvas/55 px-2.5 text-[10.5px] font-medium text-ink-muted transition-colors hover:border-pine-300 hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
            title="查看导入批次、业务标签、版本差异与回滚"
          >
            <Icon name="tag" size={13} />
            版本
          </button>

          <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas/55 p-1 pl-2.5">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-ink-faint">
              跳数
            </span>
            <div
              className="flex items-center gap-0.5"
              role="group"
              aria-label="血缘子图跳数"
            >
              {HOP_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onHopsChange(option)}
                  className={`flex h-6 min-w-[25px] items-center justify-center rounded-md px-1.5 font-mono text-[10.5px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/40 ${
                    option === hops
                      ? 'bg-pine-800 text-white shadow-sm'
                      : 'text-ink-muted hover:bg-surface hover:text-ink'
                  }`}
                  aria-pressed={option === hops}
                  aria-label={`${option} 跳`}
                >
                  {option}
                </button>
              ))}
            </div>
            {graphLoading && (
              <span
                className="mr-1 h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-pine-300 border-t-pine-700"
                aria-label="正在加载子图"
              />
            )}
          </div>

          <div
            ref={userMenuRef}
            className="relative flex items-center gap-2 border-l border-line pl-2.5 sm:pl-3"
          >
            <button
              type="button"
              onClick={() => setUserMenuOpen((value) => !value)}
              className="flex items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-canvas/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              title="用户菜单"
            >
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-pine-800 font-mono text-[10px] font-semibold tracking-wide text-white"
                aria-hidden="true"
              >
                {initials}
              </span>
              <span className="hidden sm:block">
                <span className="block max-w-[110px] truncate text-[11.5px] font-medium text-ink">
                  {session.username}
                </span>
                <span className="mt-0.5 block font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                  {roleLabel(session.role)}
                </span>
              </span>
              <Icon
                name="chevron-down"
                size={12}
                className={`hidden shrink-0 text-ink-faint transition-transform sm:block ${
                  userMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {userMenuOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-2 w-[192px] overflow-hidden rounded-xl border border-line bg-surface shadow-float animate-fade-in"
                role="menu"
                aria-label="用户菜单"
              >
                <div className="border-b border-line-soft bg-canvas/45 px-3 py-2.5">
                  <div className="truncate text-[11px] font-medium text-ink">
                    {session.username}
                  </div>
                  <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                    {session.role} · {roleLabel(session.role)}
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
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[10.5px] text-ink-muted transition-colors hover:bg-canvas/70 hover:text-pine-700 focus-visible:outline-none focus-visible:bg-canvas/70"
                  >
                    <Icon name="users" size={13} />
                    用户管理
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-2 border-t border-line-soft px-3 py-2 text-left text-[10.5px] text-ink-muted transition-colors hover:bg-canvas/70 hover:text-ink focus-visible:outline-none focus-visible:bg-canvas/70"
                >
                  <Icon name="logout" size={13} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
