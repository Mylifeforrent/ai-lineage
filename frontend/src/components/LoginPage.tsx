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
import { LanguageToggle } from './LanguageToggle';
import { useI18n } from '../i18n';

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
  const { t } = useI18n();
  return (
    <div
      className={`overflow-hidden rounded-xl border bg-brand-800 text-left ${
        active ? 'border-brand-300' : 'border-brand-700'
      }`}
    >
      <div
        className={`flex h-9 items-center justify-between border-b px-3 ${
          active ? 'bg-brand-700' : 'border-brand-700 bg-brand-800'
        }`}
      >
        <span
          className={`font-mono text-[11px] font-medium ${
            active ? 'text-white' : 'text-brand-100'
          }`}
        >
          {title}
        </span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            active ? 'bg-brand-300' : 'bg-brand-500'
          }`}
        />
      </div>
      {collapsed ? (
        <div className="px-3 py-2.5 font-mono text-[11px] text-brand-300">
                  {t('login.collapsedFields', { count: 4 })}
        </div>
      ) : (
        <div className="divide-y divide-brand-700">
          {fields.map((field, index) => (
            <div
              key={field}
              className={`flex h-7 items-center justify-between px-3 font-mono text-[11px] ${
                active && index === 0
                  ? 'bg-brand-700/60 text-white'
                  : 'text-brand-200'
              }`}
            >
              <span>{field}</span>
              <span className="text-brand-300">
                {index === 0 ? t('login.typeText') : t('login.typeNumber')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LoginPage({ notice, onLoggedIn }: LoginPageProps) {
  const { t } = useI18n();
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
    // 分字段空值校验（评审 R18）：两者皆空报用户名（第一个字段），不啰嗦
    if (!name) {
      setError(t('login.validationUsername'));
      return;
    }
    if (!password) {
      setError(t('login.validationPassword'));
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
        reason instanceof ApiError ? reason.message : t('common.networkError'),
      );
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-page p-3 sm:p-6 lg:p-8">
      <section className="relative grid w-full max-w-[1180px] overflow-hidden rounded-2xl border border-line bg-card shadow-float lg:min-h-[690px] lg:grid-cols-[1.08fr_0.92fr]">
      <div className="absolute right-4 top-4 z-20">
        <LanguageToggle />
      </div>
        <div className="relative hidden overflow-hidden bg-brand-900 px-10 py-9 lg:flex lg:flex-col xl:px-14 xl:py-11">
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <BrandMark size={34} className="text-brand-600" />
              <div>
                <div className="font-sans text-[20px] font-semibold tracking-tight text-white">
                  Clew<span className="text-brand-300">.</span>
                </div>
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand-300">
                  {t('login.leftTagline')}
                </div>
              </div>
            </div>
            <span className="rounded-full border border-brand-700 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-brand-200">
              {t('login.milestoneBadge')}
            </span>
          </div>

          <div className="relative z-10 mt-16 max-w-[510px] animate-fade-up xl:mt-20">
            <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-brand-300">
              <span className="h-px w-8 bg-brand-400" />
              {t('login.eyebrow')}
            </div>
            <h1 className="text-[28px] font-bold leading-[1.25] tracking-tight text-white">
              {t('login.headline1')}
              <br />
              {t('login.headline2')}
            </h1>
            <p className="mt-5 max-w-[430px] text-[13px] leading-6 text-brand-100">
              {t('login.intro')}
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
                  stroke="#FDBA74"
                  strokeWidth="1.2"
                />
                <path
                  d="M151 96 C215 96, 196 151, 253 151"
                  stroke="#FDBA74"
                  strokeWidth="1.2"
                />
                <path
                  d="M151 129 C216 129, 202 170, 253 170"
                  stroke="#FFEDD5"
                  strokeWidth="1.2"
                  strokeDasharray="5 4"
                  opacity="0.9"
                />
                <path
                  d="M417 118 C453 118, 450 57, 485 57"
                  stroke="#FDBA74"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
                <circle cx="206" cy="88" r="3" fill="#FDBA74" />
                <circle cx="218" cy="118" r="3" fill="#FFEDD5" />
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

              <div className="absolute bottom-0 left-[15px] flex items-center gap-3 rounded-lg border border-brand-700 bg-brand-800/85 px-3 py-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-700/60 text-brand-200">
                  <Icon name="file-search" size={13} />
                </span>
                <div>
                  <div className="font-mono text-[11px] text-brand-100">
                    {t('login.demoFile')}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-brand-300">
                    {t('login.demoLocator')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-8 grid grid-cols-3 gap-3 border-t border-brand-700 pt-5">
            {[
              ['01', t('login.f1Title'), t('login.f1Detail')],
              ['02', t('login.f2Title'), t('login.f2Detail')],
              ['03', t('login.f3Title'), t('login.f3Detail')],
            ].map(([index, title, detail]) => (
              <div key={index}>
                <div className="font-mono text-[11px] text-brand-300">{index}</div>
                <div className="mt-1 text-[12px] font-medium text-white">
                  {title}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-brand-300">
                  {detail}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex flex-col justify-center bg-card px-6 py-10 sm:px-12 lg:px-14">
          <div className="mb-9 flex items-center justify-between lg:hidden">
            <Brand compact />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
              {t('login.mobileLabel')}
            </span>
          </div>

          <div className="mx-auto w-full max-w-[372px] animate-fade-up">
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-px w-7 bg-brand-600" />
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand-700">
                  {t('login.accessEyebrow')}
                </span>
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink">
                {t('login.heading')}
              </h2>
              <p className="mt-2.5 text-[13px] leading-6 text-ink-muted">
                {t('login.subheading')}
              </p>
            </div>

            {notice && (
              <div
                className="mb-5 flex gap-2.5 rounded-lg border border-warning/25 bg-warning-soft px-3.5 py-3 text-[13px] leading-5 text-warning-deep"
                role="status"
              >
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="login-username"
                  className="mb-1.5 block text-[12px] font-medium text-ink-soft"
                >
                  {t('login.usernameLabel')}
                </label>
                <div className="group relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint transition-colors duration-150 group-focus-within:text-brand-600">
                    <Icon name="user" size={14} />
                  </span>
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={t('login.usernamePlaceholder')}
                    className="field-input h-9 pl-9"
                    disabled={submitting}
                    required
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="mb-1.5 block text-[12px] font-medium text-ink-soft"
                >
                  {t('login.passwordLabel')}
                </label>
                <div className="group relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint transition-colors duration-150 group-focus-within:text-brand-600">
                    <Icon name="lock" size={14} />
                  </span>
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={t('login.passwordPlaceholder')}
                    className="field-input h-9 pl-9 pr-11"
                    disabled={submitting}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                    aria-pressed={showPassword}
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={14} />
                  </button>
                </div>
              </div>

              {error && (
                <div
                  className="flex gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] leading-5 text-danger-deep"
                  role="alert"
                >
                  <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="group inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-700 px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                    {t('login.submitting')}
                  </>
                ) : (
                  <>
                    {t('login.submit')}
                    <Icon
                      name="arrow-right"
                      size={14}
                      className="transition-transform duration-150 group-hover:translate-x-0.5"
                    />
                  </>
                )}
              </button>
            </form>

            <div className="mt-7 border-t border-line-soft pt-5">
              <div className="flex items-start gap-2.5 text-[12px] leading-5 text-ink-muted">
                <Icon name="lock" size={13} className="mt-0.5 shrink-0" />
                <p>
                  {t('login.footerNote')}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {[t('login.roleViewer'), t('login.roleEditor'), t('login.roleAdmin')].map((role) => (
                  <span
                    key={role}
                    className="inline-flex h-6 items-center rounded-md border border-line bg-card px-2 font-mono text-[11px] text-ink-muted"
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
