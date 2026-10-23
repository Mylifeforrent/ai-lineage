import { useEffect, useRef } from 'react';
import type { Session } from '../types';
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
  onLogout,
}: TopBarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

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

  const initials = Array.from(session.username).slice(0, 2).join('').toUpperCase();

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

          <div className="flex items-center gap-2 border-l border-line pl-2.5 sm:pl-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-pine-800 font-mono text-[10px] font-semibold tracking-wide text-white"
              aria-hidden="true"
            >
              {initials}
            </div>
            <div className="hidden sm:block">
              <div className="max-w-[110px] truncate text-[11.5px] font-medium text-ink">
                {session.username}
              </div>
              <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                {session.role}
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              title="退出登录"
              aria-label="退出登录"
            >
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
