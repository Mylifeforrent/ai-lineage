import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { UserAccount } from '../types';
import { ApiError, createUser, getUsers, isAbortError } from '../lib/api';
import { roleLabel } from '../lib/roles';
import { Icon } from './Icon';

interface UserManagementModalProps {
  token: string;
  currentUsername: string;
  onClose: () => void;
}

const ROLE_OPTIONS = [
  { value: 'viewer', label: '只读（viewer）' },
  { value: 'editor', label: '可编辑（editor）' },
  { value: 'admin', label: '管理员（admin）' },
];

export function UserManagementModal({
  token,
  currentUsername,
  onClose,
}: UserManagementModalProps) {
  const [users, setUsers] = useState<UserAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    getUsers(token, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setUsers(rows);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setLoadError(
          reason instanceof ApiError
            ? reason.message
            : '无法读取用户列表，请稍后重试。',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, reloadKey]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, submitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const name = username.trim();
    if (name.length < 2) {
      setFormError('用户名至少 2 个字符。');
      return;
    }
    if (password.length < 6) {
      setFormError('密码至少 6 个字符。');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await createUser(token, {
        username: name,
        password,
        display_name: displayName.trim() || null,
        role,
      });
      setNotice(`已创建用户「${created.username}」，角色 ${roleLabel(created.role)}。`);
      setUsername('');
      setDisplayName('');
      setPassword('');
      setRole('viewer');
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setFormError(
        reason instanceof ApiError
          ? reason.message
          : '创建用户失败，请稍后重试。',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/45 p-3 backdrop-blur-[3px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-float animate-modal-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-management-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-pine-200 bg-pine-50 text-pine-700">
              <Icon name="users" size={17} />
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
                管理员功能
              </div>
              <h2 id="user-management-title" className="mt-1 text-[15px] font-semibold text-ink">
                用户管理
              </h2>
              <p className="mt-0.5 text-[9.5px] leading-4 text-ink-faint">
                账号由 admin 创建；当前接口仅支持新增用户。
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label="刷新用户列表"
              title="刷新"
            >
              <Icon name="refresh" size={14} />
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label="关闭用户管理"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbf9f3] px-4 py-4 sm:px-5">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
                用户列表
              </h3>
              <span className="font-mono text-[8px] text-ink-faint">
                {users?.length ?? 0} 个账号
              </span>
            </div>

            {loading && (
              <div className="space-y-2" aria-hidden="true">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-11 animate-soft-pulse rounded-xl border border-line bg-surface"
                  />
                ))}
              </div>
            )}

            {!loading && loadError && (
              <div className="rounded-xl border border-rosewood/20 bg-rosewood-soft px-3.5 py-3" role="alert">
                <p className="text-[10.5px] leading-5 text-rosewood-deep">{loadError}</p>
              </div>
            )}

            {!loading && !loadError && (
              <div className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
                {(users ?? []).map((user) => (
                  <div key={user.username} className="flex items-center gap-2.5 px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pine-800 font-mono text-[9px] font-semibold text-white">
                      {Array.from(user.username).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11px] font-medium text-ink">
                          {user.username}
                        </span>
                        {user.username === currentUsername && (
                          <span className="rounded-full border border-pine-200 bg-pine-50 px-1.5 py-[1px] font-mono text-[7.5px] text-pine-700">
                            当前账号
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[8.5px] text-ink-faint">
                        {user.display_name || '未登记显示名'}
                      </div>
                    </div>
                    <span className="shrink-0 rounded border border-line bg-canvas/55 px-1.5 py-[1px] font-mono text-[8.5px] text-ink-muted">
                      {user.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mt-4">
            <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
              <Icon name="user-plus" size={11} />
              新增用户
            </h3>
            <form
              onSubmit={handleSubmit}
              className="rounded-xl border border-line bg-surface/80 p-3"
              noValidate
            >
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-ink-soft">用户名</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="field-input h-8 font-mono text-[10.5px]"
                    placeholder="至少 2 个字符"
                    autoComplete="off"
                    maxLength={64}
                    disabled={submitting}
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-ink-soft">
                    显示名（可选）
                  </span>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="field-input h-8 text-[10.5px]"
                    placeholder="如 张三"
                    maxLength={64}
                    disabled={submitting}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-ink-soft">初始密码</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="field-input h-8 font-mono text-[10.5px]"
                    placeholder="至少 6 个字符"
                    autoComplete="new-password"
                    disabled={submitting}
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium text-ink-soft">角色</span>
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    className="h-8 w-full rounded-xl border border-line bg-canvas/25 px-2.5 font-mono text-[10.5px] text-ink outline-none transition-colors focus:border-pine-500 focus:bg-surface focus:ring-2 focus:ring-pine-500/15"
                    disabled={submitting}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-pine-800 px-3 text-[10px] font-semibold text-white transition-colors hover:bg-pine-900 disabled:cursor-wait disabled:opacity-65"
                >
                  {submitting ? (
                    <>
                      <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                      创建中…
                    </>
                  ) : (
                    <>
                      <Icon name="user-plus" size={11} />
                      创建用户
                    </>
                  )}
                </button>
                <span className="font-mono text-[8px] text-ink-faint">
                  密码仅保存加盐哈希；用户名重复返回 409。
                </span>
              </div>

              {formError && (
                <p className="mt-2 rounded-md border border-rosewood/20 bg-rosewood-soft px-2 py-1.5 text-[9.5px] leading-4 text-rosewood-deep" role="alert">
                  {formError}
                </p>
              )}
              {notice && (
                <p className="mt-2 rounded-md border border-pine-200 bg-pine-50 px-2 py-1.5 text-[9.5px] leading-4 text-pine-800" role="status">
                  {notice}
                </p>
              )}
            </form>
            <p className="mt-2 flex items-start gap-1.5 text-[8.5px] leading-4 text-ink-faint">
              <Icon name="info" size={10} className="mt-0.5 shrink-0" />
              角色变更与停用账号尚未提供接口；原型中的逐行角色下拉与 RBAC
              权限矩阵暂未实现，如需调整请由后端补充管理员接口。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
