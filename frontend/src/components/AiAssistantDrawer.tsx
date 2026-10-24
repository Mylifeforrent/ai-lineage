import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  AiChatMessage,
  AiFocus,
  AiStatus,
  AiToolTrace,
  LineageGraph,
} from '../types';
import {
  ApiError,
  getAiStatus,
  isAbortError,
  sendAiChat,
} from '../lib/api';
import { Icon } from './Icon';

interface AiAssistantDrawerProps {
  open: boolean;
  token: string;
  /** 当前画布聚焦的数据集/字段，作为每轮对话的 focus 上下文 */
  focus: AiFocus | null;
  onClose: () => void;
  /** 响应携带 graph 时，把子图交给 Workspace 复用现有画布状态渲染 */
  onGraph: (graph: LineageGraph) => void;
}

interface ChatEntry {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: AiToolTrace[];
  graph?: LineageGraph;
  error?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  search_fields: '搜索字段',
  get_field_details: '字段详情',
  trace_lineage: '追溯血缘',
  get_field_history: '变更历史',
};

const EXAMPLE_PROMPTS = [
  '订单表里的 order_no 是从哪来的？',
  '这个字段的源文件定位在哪里？',
  '最近改过哪些字段？',
];

const NOT_CONFIGURED_TEXT =
  '未配置 LLM，请在 .env 设置 LLM_*（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）。';

function focusLabel(focus: AiFocus | null): string {
  if (!focus) return '未聚焦数据集';
  return focus.field ? `${focus.dataset}.${focus.field}` : focus.dataset;
}

function compactArgs(args: Record<string, unknown>): string {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    text = '';
  }
  if (!text || text === '{}') return '()';
  const body = text.slice(1, -1);
  return body.length > 64 ? `(${body.slice(0, 64)}…)` : `(${body})`;
}

function ToolChips({ trace }: { trace: AiToolTrace[] }) {
  if (trace.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {trace.map((item, index) => (
        <span
          key={`${item.tool}-${index}`}
          className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-[2px] font-mono text-[8.5px] leading-4 ${
            item.ok
              ? 'border-line bg-canvas/70 text-ink-muted'
              : 'border-rosewood/25 bg-rosewood-soft text-rosewood-deep'
          }`}
          title={`${TOOL_LABELS[item.tool] ?? '工具调用'} ${JSON.stringify(item.args)}`}
        >
          <span className="shrink-0 font-medium">{item.tool}</span>
          <span className="min-w-0 truncate opacity-75">
            {compactArgs(item.args)}
          </span>
          <span
            className={`shrink-0 font-semibold ${
              item.ok ? 'text-pine-600' : 'text-rosewood'
            }`}
            aria-label={item.ok ? '调用成功' : '调用失败'}
          >
            {item.ok ? '✓' : '✗'}
          </span>
        </span>
      ))}
    </div>
  );
}

export function AiAssistantDrawer({
  open,
  token,
  focus,
  onClose,
  onGraph,
}: AiAssistantDrawerProps) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusReloadKey, setStatusReloadKey] = useState(0);

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const entrySeq = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const configured = status?.configured === true;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStatusLoading(true);
    setStatusError(null);
    getAiStatus(token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setStatus(result);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        // 状态接口失败时保守地视为不可用，输入区展示重试入口而不崩溃。
        setStatus(null);
        setStatusError(
          reason instanceof ApiError
            ? reason.message
            : '无法读取 AI 状态，请稍后重试。',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatusLoading(false);
      });
    return () => controller.abort();
  }, [open, token, statusReloadKey]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries, sending, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const appendEntry = useCallback((entry: Omit<ChatEntry, 'id'>) => {
    const id = entrySeq.current;
    entrySeq.current += 1;
    setEntries((current) => [...current, { ...entry, id }]);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending || !configured) return;

    const userEntry: ChatEntry = {
      id: entrySeq.current,
      role: 'user',
      content: text,
    };
    entrySeq.current += 1;
    const nextEntries = [...entries, userEntry];
    setEntries(nextEntries);
    setInput('');
    setSending(true);

    // 只回传有内容的 user/assistant 文本；system 提示由后端固定。
    const history: AiChatMessage[] = nextEntries
      .filter((entry) => !entry.error && entry.content.trim().length > 0)
      .map((entry) => ({
        role: entry.role,
        content: entry.content.slice(0, 8000),
      }))
      .slice(-50);
    const focusPayload: AiFocus | undefined = focus?.dataset.trim()
      ? {
          dataset: focus.dataset,
          ...(focus.field?.trim() ? { field: focus.field } : {}),
        }
      : undefined;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await sendAiChat(
        token,
        { messages: history, ...(focusPayload ? { focus: focusPayload } : {}) },
        controller.signal,
      );
      appendEntry({
        role: 'assistant',
        content: response.answer,
        toolTrace: response.tool_trace,
        graph: response.graph,
      });
      if (response.graph) onGraph(response.graph);
    } catch (reason) {
      if (controller.signal.aborted || isAbortError(reason)) return;
      if (reason instanceof ApiError && reason.status === 503) {
        setStatus({ configured: false, model: null });
      }
      appendEntry({
        role: 'assistant',
        error: true,
        content:
          reason instanceof ApiError
            ? reason.message
            : 'AI 请求失败，请稍后重试。',
      });
    } finally {
      if (!controller.signal.aborted) setSending(false);
    }
  }

  if (!open) return null;

  const inputDisabled = !configured || sending || statusLoading;

  return (
    <div
      className="fixed inset-0 z-[72] flex justify-end bg-ink/40 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="flex h-full w-full max-w-[460px] flex-col overflow-hidden border-l border-line bg-surface shadow-float animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-drawer-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
              <Icon name="sparkles" size={12} className="text-ai" />
              Function calling · 只读工具
            </div>
            <div className="mt-1 flex items-center gap-2">
              <h2
                id="ai-drawer-title"
                className="font-display text-[22px] font-medium tracking-[-0.02em] text-ink"
              >
                AI 助手
              </h2>
              {statusLoading ? (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-ai/25 border-t-ai"
                  aria-label="正在读取 AI 状态"
                />
              ) : configured && status?.model ? (
                <span
                  className="max-w-[170px] truncate rounded-full border border-ai/20 bg-ai-soft px-2 py-[2px] font-mono text-[8.5px] text-ai-deep"
                  title={status.model}
                >
                  {status.model}
                </span>
              ) : (
                <span className="rounded-full border border-line bg-canvas/70 px-2 py-[2px] font-mono text-[8.5px] text-ink-faint">
                  {statusError ? '状态未知' : '未配置'}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[9.5px] leading-4 text-ink-faint">
              工具调用只读；涉及出图时会自动切换画布子图。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setStatusReloadKey((value) => value + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label="重新检查 LLM 配置"
              title="重新检查配置"
            >
              <Icon name="refresh" size={14} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-canvas hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label="关闭 AI 助手"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        </header>

        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft bg-canvas/45 px-4 py-2">
          <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-ink-faint">
            当前聚焦
          </span>
          <span
            className="min-w-0 truncate font-mono text-[9.5px] text-pine-700"
            title={focusLabel(focus)}
          >
            {focusLabel(focus)}
          </span>
        </div>

        {(statusError || (!statusLoading && status && !status.configured)) && (
          <div className="shrink-0 border-b border-line-soft px-4 py-2.5">
            <div
              className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[9.5px] leading-4 ${
                statusError
                  ? 'border-rosewood/25 bg-rosewood-soft text-rosewood-deep'
                  : 'border-ochre/25 bg-ochre-soft text-ochre-deep'
              }`}
              role="status"
            >
              <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">
                  {statusError ? '无法读取 AI 状态' : 'AI 助手暂不可用'}
                </div>
                <p className="mt-0.5 break-words opacity-90">
                  {statusError ?? NOT_CONFIGURED_TEXT}
                </p>
                {statusError && (
                  <button
                    type="button"
                    onClick={() => setStatusReloadKey((value) => value + 1)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded border border-rosewood/25 bg-surface/70 px-1.5 py-0.5 font-mono text-[8.5px] transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/30"
                  >
                    <Icon name="refresh" size={10} />
                    重试
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto bg-[#fbf9f3] px-4 py-4"
          role="log"
          aria-live="polite"
          aria-label="AI 对话消息"
        >
          {entries.length === 0 && !sending ? (
            <div className="flex min-h-full flex-col items-center justify-center px-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-ai/20 bg-ai-soft text-ai">
                <Icon name="sparkles" size={24} />
              </div>
              <h3 className="mt-4 font-display text-[21px] font-medium tracking-[-0.02em] text-ink">
                用自然语言查血缘
              </h3>
              <p className="mt-2 max-w-[280px] text-[10px] leading-5 text-ink-muted">
                AI 会调用只读工具查询字段、上下游子图与变更历史；
                返回子图时画布会自动切换并高亮。
              </p>
              <div className="mt-5 grid w-full max-w-[300px] gap-1.5">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => {
                      setInput(prompt);
                      inputRef.current?.focus();
                    }}
                    disabled={inputDisabled}
                    className="rounded-lg border border-line-soft bg-surface/75 px-2.5 py-2 text-left text-[9.5px] text-ink-muted transition-colors hover:border-pine-300 hover:text-pine-700 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) =>
                entry.role === 'user' ? (
                  <div key={entry.id} className="ml-8 flex flex-col items-end">
                    <div className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                      你
                    </div>
                    <div className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-md border border-pine-200 bg-pine-50/80 px-3 py-2 text-[11px] leading-5 text-pine-900">
                      {entry.content}
                    </div>
                  </div>
                ) : (
                  <div key={entry.id} className="mr-2">
                    <div className="mb-1 flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                      <Icon name="sparkles" size={10} className="text-ai" />
                      AI 助手
                    </div>
                    <div
                      className={`rounded-2xl rounded-tl-md border px-3 py-2.5 ${
                        entry.error
                          ? 'border-rosewood/25 bg-rosewood-soft/70'
                          : 'border-line bg-surface'
                      }`}
                    >
                      {entry.toolTrace && entry.toolTrace.length > 0 && (
                        <ToolChips trace={entry.toolTrace} />
                      )}
                      {entry.content.trim() ? (
                        <p
                          className={`whitespace-pre-wrap break-words text-[11px] leading-5 ${
                            entry.error ? 'text-rosewood-deep' : 'text-ink-soft'
                          }`}
                        >
                          {entry.content}
                        </p>
                      ) : (
                        <p className="text-[10px] italic leading-5 text-ink-faint">
                          模型未返回文字回答。
                        </p>
                      )}
                      {entry.graph && (
                        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-pine-200 bg-pine-50/80 px-2 py-1.5 text-[9px] text-pine-700">
                          <Icon name="network" size={11} className="shrink-0" />
                          <span className="font-medium">画布已更新</span>
                          <span className="font-mono text-[8.5px] text-pine-700/75">
                            {entry.graph.datasets.length} 个数据集 ·{' '}
                            {entry.graph.edges.length} 条连线
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}

              {sending && (
                <div className="mr-2">
                  <div className="mb-1 flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                    <Icon name="sparkles" size={10} className="text-ai" />
                    AI 助手
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-dashed border-line bg-surface/70 px-3 py-2.5">
                    <span
                      className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-ai/25 border-t-ai"
                      aria-hidden="true"
                    />
                    <span className="text-[9.5px] text-ink-muted">
                      正在调用工具并组织回答…
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-line bg-surface/95 px-3 py-3"
        >
          <div className="flex items-end gap-2">
            <label htmlFor="ai-chat-input" className="sr-only">
              向 AI 助手提问
            </label>
            <textarea
              ref={inputRef}
              id="ai-chat-input"
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              maxLength={8000}
              disabled={inputDisabled}
              placeholder={
                statusLoading
                  ? '正在检查 LLM 配置…'
                  : statusError
                    ? '无法读取 AI 状态，请先重试'
                    : configured
                      ? '问点什么…（工具调用仅只读，AI 建议需人工确认）'
                      : '配置 LLM 后即可提问'
              }
              className="field-input min-h-[54px] resize-none py-2 text-[11px] leading-5 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={inputDisabled || !input.trim()}
              className="flex h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-pine-800 px-3.5 text-[10.5px] font-semibold text-white transition-colors hover:bg-pine-900 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {sending ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
              ) : (
                <Icon name="send" size={13} />
              )}
              {sending ? '发送中' : '发送'}
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[8px] text-ink-faint">
            <span>Enter 发送 · Shift + Enter 换行</span>
            <span>graph 结果自动联动画布</span>
          </div>
        </form>
      </aside>
    </div>
  );
}
