import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ApiError,
  isAbortError,
  login,
  persistSession,
} from '../lib/api';
import type { Session } from '../types';
import { Brand, BrandMark } from './Brand';
import { Icon } from './Icon';

interface LoginPageProps {
  notice: string | null;
  onLoggedIn: (session: Session) => void;
}

function MiniNode({
  title,
  fields,
  active = false,
  collapsed = false,
}: {
  title: string;
  fields: string[];
  active?: boolean;
  collapsed?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-surface text-left shadow-[0_10px_30px_-20px_rgba(0,0,0,0.55)] ${
        active ? 'border-pine-300' : 'border-white/15'
      }`}
    >
      <div
        className={`flex h-9 items-center justify-between border-b px-3 ${
          active
            ? 'border-pine-200 bg-pine-50'
            : 'border-white/10 bg-[#203f36]'
        }`}
      >
        <span
          className={`font-mono text-[10.5px] font-medium ${
            active ? 'text-pine-700' : 'text-[#dbe9e2]'
          }`}
        >
          {title}
        </span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            active ? 'bg-pine-500' : 'bg-[#769086]'
          }`}
        />
      </div>
      {collapsed ? (
        <div className="px-3 py-2.5 font-mono text-[9.5px] text-ink-faint">
                  4 个字段 · 已收起
        </div>
      ) : (
        <div className="divide-y divide-line-soft">
          {fields.map((field, index) => (
            <div
              key={field}
              className={`flex h-[27px] items-center justify-between px-3 font-mono text-[9.5px] ${
                active && index === 0
                  ? 'bg-pine-50/80 text-pine-700'
                  : 'text-ink-soft'
              }`}
            >
              <span>{field}</span>
              <span className="text-[8px] text-ink-faint">
                {index === 0 ? '文本' : '数值'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LoginPage({ notice, onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const name = username.trim();
    if (!name || !password) {
      setError('请输入用户名和密码');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    setError(null);

    try {
      const session = await login(name, password, controller.signal);
      persistSession(session);
      onLoggedIn(session);
    } catch (reason) {
      if (isAbortError(reason)) return;
      setError(
        reason instanceof ApiError ? reason.message : '无法连接服务，请稍后重试',
      );
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas p-3 sm:p-6 lg:p-8">
      <div
        className="pointer-events-none absolute inset-0 bg-fine-grid bg-grid-28 opacity-50"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -left-32 top-1/4 h-80 w-80 rounded-full bg-pine-200/30 blur-3xl"
        aria-hidden="true"
      />

      <section className="relative grid w-full max-w-[1180px] overflow-hidden rounded-[24px] border border-line bg-surface shadow-float lg:min-h-[690px] lg:grid-cols-[1.08fr_0.92fr]">
        <div className="relative hidden overflow-hidden bg-pine-900 px-10 py-9 text-[#edf4f0] lg:flex lg:flex-col xl:px-14 xl:py-11">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.17]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.22) 1px, transparent 1px)',
              backgroundSize: '34px 34px',
            }}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -right-20 -top-32 h-[420px] w-[420px] rounded-full bg-pine-500/30 blur-[90px]"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -bottom-36 -left-20 h-[380px] w-[380px] rounded-full bg-ember/20 blur-[110px]"
            aria-hidden="true"
          />

          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <BrandMark size={34} className="text-pine-600" />
              <div>
                <div className="font-display text-[22px] font-semibold tracking-[-0.02em] text-white">
                  Lineage<span className="text-pine-300">Lite</span>
                </div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#8fb0a3]">
                  让数据来源清晰可见
                </div>
              </div>
            </div>
            <span className="rounded-full border border-white/15 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[#a8c4b8]">
              M2 · 血缘画布
            </span>
          </div>

          <div className="relative z-10 mt-16 max-w-[510px] animate-fade-up xl:mt-20">
            <div className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-pine-300">
              <span className="h-px w-8 bg-pine-400" />
              字段级血缘 · 源文件可回查
            </div>
            <h1 className="font-display text-[46px] font-medium leading-[1.08] tracking-[-0.035em] text-[#f5f1e7] xl:text-[55px]">
              每一条血缘，
              <br />
              都落回原始文件。
            </h1>
            <p className="mt-5 max-w-[430px] text-[13px] leading-6 text-[#a9c0b6]">
              从字段到工作表、行列与 JSONPath，把「数据从哪来」变成
              可以被打开、核对与讨论的证据。
            </p>
          </div>

          <div className="relative z-10 mt-11 flex-1 animate-fade-up [animation-delay:120ms]">
            <div className="relative mx-auto h-[285px] w-full max-w-[510px]">
              <svg
                viewBox="0 0 520 285"
                className="absolute inset-0 h-full w-full"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M151 63 C205 63, 205 132, 253 132"
                  stroke="#5c8f7b"
                  strokeWidth="1.2"
                />
                <path
                  d="M151 96 C215 96, 196 151, 253 151"
                  stroke="#7fa898"
                  strokeWidth="1.2"
                />
                <path
                  d="M151 129 C216 129, 202 170, 253 170"
                  stroke="#2f64d8"
                  strokeWidth="1.2"
                  strokeDasharray="5 4"
                  opacity="0.9"
                />
                <path
                  d="M417 118 C453 118, 450 57, 485 57"
                  stroke="#7fa898"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
                <circle cx="206" cy="88" r="3" fill="#b3d9c7" />
                <circle cx="218" cy="118" r="3" fill="#2f64d8" />
              </svg>

              <div className="absolute left-0 top-1 w-[155px]">
                <MiniNode
                  title="ods_order"
                  fields={['order_id', 'amount', 'region']}
                />
              </div>
              <div className="absolute left-[174px] top-[98px] w-[168px]">
                <MiniNode
                  title="dwd_order"
                  fields={['order_id', 'amount', 'region']}
                  active
                />
              </div>
              <div className="absolute right-0 top-[52px] w-[130px]">
                <MiniNode
                  title="dws_daily"
                  fields={['order_id']}
                  collapsed
                />
              </div>

              <div className="absolute bottom-0 left-[15px] flex items-center gap-3 rounded-lg border border-white/10 bg-[#173b31]/85 px-3 py-2 backdrop-blur-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-pine-500/20 text-pine-200">
                  <Icon name="file-search" size={13} />
                </span>
                <div>
                  <div className="font-mono text-[9px] text-[#d5e6de]">
                    订单明细.xlsx · 工作表「订单」
                  </div>
                  <div className="mt-0.5 font-mono text-[8.5px] text-[#8fb0a3]">
                    C 列 · 数据行 3:15000
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-8 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
            {[
              ['01', '身份与角色', 'JWT / RBAC'],
              ['02', '字段级定位', 'CSV / XLSX / JSON'],
              ['03', '系统内回源', '高亮核查'],
            ].map(([index, title, detail]) => (
              <div key={index}>
                <div className="font-mono text-[9px] text-pine-400">{index}</div>
                <div className="mt-1 text-[11px] font-medium text-[#dbe8e2]">
                  {title}
                </div>
                <div className="mt-0.5 font-mono text-[8.5px] text-[#7f9e91]">
                  {detail}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex flex-col justify-center bg-surface px-6 py-10 sm:px-12 lg:px-14 xl:px-16">
          <div className="mb-9 flex items-center justify-between lg:hidden">
            <Brand compact />
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
              字段级血缘
            </span>
          </div>

          <div className="mx-auto w-full max-w-[372px] animate-fade-up">
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-px w-7 bg-pine-600" />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-pine-700">
                  工作台访问
                </span>
              </div>
              <h2 className="font-display text-[36px] font-medium tracking-[-0.03em] text-ink">
                回到血缘现场
              </h2>
              <p className="mt-2.5 text-[12.5px] leading-6 text-ink-muted">
                登录后浏览字段级血缘、校验源文件定位，并查看你所在角色的可操作范围。
              </p>
            </div>

            {notice && (
              <div
                className="mb-5 flex gap-2.5 rounded-xl border border-ochre/20 bg-ochre-soft px-3.5 py-3 text-[12px] leading-5 text-ochre-deep"
                role="status"
              >
                <Icon name="info" size={15} className="mt-0.5 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="login-username"
                  className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-soft"
                >
                  用户名
                </label>
                <div className="group relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint transition-colors group-focus-within:text-pine-600">
                    <Icon name="user" size={15} />
                  </span>
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="请输入用户名"
                    className="field-input h-11 pl-10"
                    disabled={submitting}
                    required
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-soft"
                >
                  密码
                </label>
                <div className="group relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint transition-colors group-focus-within:text-pine-600">
                    <Icon name="lock" size={15} />
                  </span>
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    className="field-input h-11 pl-10 pr-11"
                    disabled={submitting}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-line-soft hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/40"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPassword}
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={15} />
                  </button>
                </div>
              </div>

              {error && (
                <div
                  className="flex gap-2.5 rounded-xl border border-rosewood/20 bg-rosewood-soft px-3.5 py-3 text-[12px] leading-5 text-rosewood-deep"
                  role="alert"
                >
                  <Icon name="warning" size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="group mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-pine-800 text-[13px] font-semibold text-white shadow-[0_10px_25px_-14px_rgba(19,54,46,0.8)] transition-all hover:bg-pine-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-65"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                    正在验证身份
                  </>
                ) : (
                  <>
                    登录工作台
                    <Icon
                      name="arrow-right"
                      size={15}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </>
                )}
              </button>
            </form>

            <div className="mt-7 border-t border-line-soft pt-5">
              <div className="flex items-start gap-2.5 text-[11px] leading-5 text-ink-faint">
                <Icon name="lock" size={13} className="mt-0.5 shrink-0" />
                <p>
                  账号由管理员创建，密码仅保存加盐哈希。登录态使用短期 JWT，
                  失效后会自动返回此页。
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {['viewer 只读', 'editor 可编辑', 'admin 可管理'].map((role) => (
                  <span
                    key={role}
                    className="rounded-full border border-line-soft bg-canvas/70 px-2.5 py-1 font-mono text-[9px] text-ink-muted"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
