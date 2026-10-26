import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import type {
  AiChatMessage,
  AiDraftItem,
  AiFocus,
  AiHighlightItem,
  AiStatus,
  AiSuggestionCandidate,
  AiToolTrace,
  LineageGraph,
} from '../types';
import {
  acceptDescriptionDraft,
  ApiError,
  confirmAiSuggestion,
  getAiStatus,
  isAbortError,
  rejectAiSuggestion,
  rejectDescriptionDraft,
  sendAiChatStream,
} from '../lib/api';
import { formatConfidence } from '../lib/format';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { ModalShell } from './ModalShell';
import { useI18n, type TranslateFn } from '../i18n';
import type { AiKey } from '../i18n/dicts/ai';

interface AiAssistantDrawerProps {
  open: boolean;
  token: string;
  /** 当前画布聚焦的数据集/字段，作为每轮对话的 focus 上下文 */
  focus: AiFocus | null;
  /** editor+ 才渲染描述草稿的采纳/拒绝按钮 */
  canEdit: boolean;
  onClose: () => void;
  /**
   * 响应联动：graph 存在时把子图交给 Workspace 复用现有画布状态渲染；
   * highlights（mark_highlight 声明）同时交给 Workspace 驱动画布追踪高亮。
   */
  onGraph: (graph: LineageGraph | null, highlights?: AiHighlightItem[]) => void;
  /** suggest_lineage 落库候选后由 Workspace 刷新画布（靛蓝虚线候选边） */
  onSuggested: (count: number) => void;
  /** 候选卡确认/拒绝成功后的画布刷新（onSuggested 同链路的静默版，评审 R17） */
  onRefresh?: () => void;
  /** 回答内证据锚点点击：把该字段应用为画布追踪焦点 */
  onFieldFocus: (dataset: string, field: string) => void;
}

interface ChatEntry {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: AiToolTrace[];
  graph?: LineageGraph;
  drafts?: AiDraftItem[];
  /** suggest 事件携带的候选（每轮一卡；多事件按候选签名去重合并） */
  suggestCards?: AiSuggestionCandidate[][];
  /** 候选卡的本地决策结果（key → 已确认/已拒绝），随会话保留（评审 R17） */
  suggestDecisions?: Record<string, 'confirmed' | 'rejected'>;
  /** 本地中止/系统提示行（不回传模型，不计入历史上下文） */
  notice?: boolean;
  /** SSE 流式进行中：显示打点光标与工具进行态 */
  streaming?: boolean;
  error?: boolean;
}

/** 候选签名：同一候选在 suggest 事件与 done 载荷间去重 */
function suggestKey(item: AiSuggestionCandidate): string {
  return `${item.from_dataset}.${item.from_field ?? '*'}>${item.to_dataset}.${item.to_field ?? '*'}`;
}

/** 工具名 → 字典键映射；标签文本在使用处经 t() 按当前语言取值。 */
const TOOL_LABEL_KEYS: Record<string, AiKey> = {
  search_fields: 'ai.tool.searchFields',
  get_field_details: 'ai.tool.getFieldDetails',
  trace_lineage: 'ai.tool.traceLineage',
  get_field_history: 'ai.tool.getFieldHistory',
  mark_highlight: 'ai.tool.markHighlight',
  suggest_lineage: 'ai.tool.suggestLineage',
  analyze_impact: 'ai.tool.analyzeImpact',
  draft_descriptions: 'ai.tool.draftDescriptions',
};

const EXAMPLE_PROMPT_KEYS: readonly AiKey[] = [
  'ai.exampleOrderSource',
  'ai.exampleFieldLocator',
  'ai.exampleRecentChanges',
];

function focusLabel(focus: AiFocus | null, t: TranslateFn): string {
  if (!focus) return t('ai.noFocus');
  return focus.field ? `${focus.dataset}.${focus.field}` : focus.dataset;
}

/** 常见文件扩展名不作为字段引用（避免 d0_orders.csv 被当成 数据集.字段） */
const NON_FIELD_TOKENS = new Set([
  'csv', 'xlsx', 'xls', 'json', 'md', 'txt', 'png', 'svg', 'db', 'py', 'ts',
]);

const FIELD_REF_PATTERN = /\b([a-zA-Z][\w-]{0,31})\.([a-zA-Z][\w-]{0,63})\b/g;

/**
 * GFM markdown 渲染（演进规划 07：业界聊天 UI 统一做法——表格/代码块/列表
 * 带样式渲染，而非裸文本）。安全：react-markdown 默认不执行内联 HTML。
 */
function linkifyFieldRefs(markdown: string): string {
  /** 把非代码段里的 `数据集.字段` 文本替换为锚点链接，由 a 组件接管为 chip。 */
  const segments = markdown.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment; // 代码段原样保留
      return segment.replace(
        FIELD_REF_PATTERN,
        (full, dataset: string, field: string) => {
          if (NON_FIELD_TOKENS.has(field.toLowerCase())) return full;
          return `[${full}](#ref:${encodeURIComponent(dataset)}.${encodeURIComponent(field)})`;
        },
      );
    })
    .join('');
}

function FieldRefChip({
  dataset,
  field,
  label,
  onFieldFocus,
}: {
  dataset: string;
  field: string;
  label: string;
  onFieldFocus: (dataset: string, field: string) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      title={t('ai.traceOnCanvas', { dataset, field })}
      onClick={() => onFieldFocus(dataset, field)}
      className="mx-0.5 inline-flex items-center rounded border border-ai/25 bg-ai-soft px-1 py-px align-baseline font-mono text-[11px] leading-4 text-ai-deep transition-colors duration-150 hover:border-ai/50 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60"
    >
      {label}
    </button>
  );
}

function AnswerText({
  content,
  onFieldFocus,
  streaming = false,
}: {
  content: string;
  onFieldFocus: (dataset: string, field: string) => void;
  streaming?: boolean;
}) {
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith('#ref:')) {
        try {
          const raw = decodeURIComponent(href.slice(5));
          const dot = raw.indexOf('.');
          if (dot > 0) {
            return (
              <FieldRefChip
                dataset={raw.slice(0, dot)}
                field={raw.slice(dot + 1)}
                label={String(children ?? raw)}
                onFieldFocus={onFieldFocus}
              />
            );
          }
        } catch {
          // 解码失败时按普通链接处理
        }
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
        >
          {children}
        </a>
      );
    },
    code: ({ className, children }) => {
      const text = String(children ?? '').replace(/\n$/, '');
      const isBlock = (className ?? '').includes('language-') || text.includes('\n');
      if (isBlock) {
        return (
          <pre className="my-2 overflow-x-auto rounded-lg border border-line bg-page px-2.5 py-2 font-mono text-[11px] leading-5 text-ink-soft">
            <code>{text}</code>
          </pre>
        );
      }
      const match = /^([a-zA-Z][\w-]{0,31})\.([a-zA-Z][\w-]{0,63})$/.exec(text);
      if (match && !NON_FIELD_TOKENS.has(match[2].toLowerCase())) {
        return (
          <FieldRefChip
            dataset={match[1]}
            field={match[2]}
            label={text}
            onFieldFocus={onFieldFocus}
          />
        );
      }
      return (
        <code className="rounded bg-subtle px-1 py-px font-mono text-[11px] text-ink-soft">
          {text}
        </code>
      );
    },
    pre: ({ children }) => <>{children}</>,
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[11px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-subtle">{children}</thead>,
    th: ({ children }) => (
      <th className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-medium text-ink-soft">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-t border-line-soft px-2 py-1.5 align-top text-ink-soft">
        {children}
      </td>
    ),
    p: ({ children }) => (
      <p className="my-1.5 break-words text-[13px] leading-6 text-ink-soft first:mt-0 last:mb-0">
        {children}
      </p>
    ),
    ul: ({ children }) => (
      <ul className="my-1.5 list-disc space-y-0.5 pl-4 text-[13px] leading-6 text-ink-soft">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-1.5 list-decimal space-y-0.5 pl-4 text-[13px] leading-6 text-ink-soft">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="break-words">{children}</li>,
    h1: ({ children }) => (
      <h1 className="mb-1 mt-3 text-[15px] font-semibold text-ink first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-1 mt-3 text-[14px] font-semibold text-ink first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1 mt-2.5 text-[13px] font-semibold text-ink first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-2 text-[13px] font-semibold text-ink first:mt-0">{children}</h4>
    ),
    strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-line-strong pl-2 text-[12px] leading-5 text-ink-muted">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-2.5 border-line-soft" />,
  }), [onFieldFocus]);

  return (
    <div className="break-words text-[13px] leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {linkifyFieldRefs(content)}
      </ReactMarkdown>
      {streaming && (
        <span
          className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-ai align-middle"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/** 描述草稿确认卡：采纳 → 写 annotation；拒绝 → 不再重复生成。 */
function DraftCard({
  item,
  token,
  canEdit,
  onUpdate,
}: {
  item: AiDraftItem;
  token: string;
  canEdit: boolean;
  onUpdate: (next: AiDraftItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  async function decide(accept: boolean) {
    setBusy(true);
    try {
      if (accept) {
        onUpdate(await acceptDescriptionDraft(token, item.id));
      } else {
        await rejectDescriptionDraft(token, item.id);
        onUpdate({
          ...item,
          status: 'rejected',
          decided_at: new Date().toISOString(),
        });
      }
    } catch {
      // 失败保持 pending，卡片可重试
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-ai/25 bg-ai-soft/60 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Icon name="sparkles" size={11} className="shrink-0 text-ai" />
        <span className="font-mono text-[11px] font-medium text-ai-deep">
          {item.dataset}.{item.field}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
          {t('ai.draftBadge')}
        </span>
        {item.status === 'accepted' && (
          <span className="ml-auto shrink-0 rounded bg-success-soft px-1.5 py-px font-mono text-[11px] text-success-deep">
            {t('ai.draftAccepted')}
          </span>
        )}
        {item.status === 'rejected' && (
          <span className="ml-auto shrink-0 rounded bg-subtle px-1.5 py-px font-mono text-[11px] text-ink-faint">
            {t('ai.draftRejected')}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[12px] leading-5 text-ink">{item.draft}</p>
      {item.status === 'pending' && canEdit && (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(true)}
            className="inline-flex h-7 items-center rounded-md bg-brand-700 px-2.5 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 disabled:opacity-50"
          >
            {t('ai.draftAccept')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            className="inline-flex h-7 items-center rounded-md border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 disabled:opacity-50"
            >
              {t('ai.draftReject')}
            </button>
          {busy && (
            <span className="text-[11px] text-ink-faint">{t('ai.draftProcessing')}</span>
          )}
        </div>
      )}
      {item.status === 'pending' && !canEdit && (
        <p className="mt-1.5 text-[11px] text-ink-faint">
          {t('ai.draftViewerHint')}
        </p>
      )}
    </div>
  );
}

/**
 * 内联候选确认卡（评审 R17，hi-fi 04 §3.6 视觉基线：虚线框 + ai 色）。
 * 信息与操作对齐详情面板候选卡：确认 / 拒绝走 REST 直通端点（后端要求 editor），
 * viewer 收到的卡片操作置灰并提示；决策结果经 onDecided 写回会话条目（关抽屉不丢）。
 */
function InlineSuggestCard({
  token,
  canEdit,
  candidates,
  decisions,
  onDecided,
  onViewOnCanvas,
}: {
  token: string;
  canEdit: boolean;
  candidates: AiSuggestionCandidate[];
  decisions: Record<string, 'confirmed' | 'rejected'>;
  onDecided: (key: string, status: 'confirmed' | 'rejected') => void;
  onViewOnCanvas: (dataset: string, field: string) => void;
}) {
  const { t } = useI18n();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function decide(item: AiSuggestionCandidate, accept: boolean) {
    const key = suggestKey(item);
    if (busyKey !== null || decisions[key]) return;
    setBusyKey(key);
    setActionError(null);
    try {
      const edgeKey = {
        from_dataset: item.from_dataset,
        from_field: item.from_field,
        to_dataset: item.to_dataset,
        to_field: item.to_field,
      };
      if (accept) {
        await confirmAiSuggestion(token, edgeKey);
      } else {
        await rejectAiSuggestion(token, edgeKey);
      }
      onDecided(key, accept ? 'confirmed' : 'rejected');
    } catch (reason) {
      if (isAbortError(reason)) return;
      // 失败保持 pending，卡片可重试；后端 detail（如 403/429）原样透出
      setActionError(
        reason instanceof ApiError ? reason.message : t('ai.suggestActionFailed'),
      );
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="rounded-xl rounded-tl-md border border-dashed border-ai/25 bg-ai-soft/40 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ai-deep">
        <Icon name="sparkles" size={10} className="shrink-0 text-ai" />
        {t('ai.title')} · suggest_lineage
      </div>
      <div className="space-y-2">
        {candidates.map((item, index) => {
          const key = suggestKey(item);
          const decision = decisions[key];
          const busy = busyKey === key;
          return (
            <div
              key={key}
              className={index > 0 ? 'border-t border-ai/15 pt-2' : ''}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5 font-mono text-[12px] leading-4">
                  <div className="break-all">
                    <span className="text-ink-faint">{item.from_dataset}.</span>
                    <span className="font-medium text-ink-soft">
                      {item.from_field ?? '*'}
                    </span>
                  </div>
                  <div className="flex items-start gap-1 text-ink-faint">
                    <Icon
                      name="arrow-right"
                      size={10}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="min-w-0 break-all">
                      <span>{item.to_dataset}.</span>
                      <span className="font-medium text-brand-700">
                        {item.to_field ?? '*'}
                      </span>
                    </span>
                  </div>
                </div>
                {decision ? (
                  <span
                    className={`shrink-0 rounded px-1.5 py-px font-mono text-[11px] ${
                      decision === 'confirmed'
                        ? 'bg-success-soft text-success-deep'
                        : 'bg-subtle text-ink-faint'
                    }`}
                  >
                    {decision === 'confirmed'
                      ? t('ai.suggestConfirmed')
                      : t('ai.suggestRejected')}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full border border-ai/25 bg-ai-soft px-1.5 py-px font-mono text-[11px] tabular-nums text-ai-deep">
                    {t('ai.suggestConfidence', {
                      value: formatConfidence(item.confidence),
                    })}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[12px] leading-4 text-ink-muted">
                {item.reason}
              </p>
              {!decision && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!canEdit || busyKey !== null}
                      onClick={() => decide(item, true)}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-brand-700 px-2 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      <Icon name="check" size={12} />
                      {busy ? t('ai.suggestConfirming') : t('common.confirm')}
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit || busyKey !== null}
                      onClick={() => decide(item, false)}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong bg-card px-2 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-danger/30 hover:text-danger-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Icon name="trash" size={12} />
                      {busy ? t('ai.suggestConfirming') : t('ai.suggestReject')}
                    </button>
                  </div>
                  {item.from_field && (
                    <button
                      type="button"
                      onClick={() =>
                        onViewOnCanvas(item.from_dataset, item.from_field ?? '')
                      }
                      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ai-deep transition-colors duration-150 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                    >
                      <Icon name="search" size={12} />
                      {t('ai.suggestViewOnCanvas')}
                    </button>
                  )}
                </div>
              )}
              {!decision && !canEdit && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-faint">
                  <Icon name="lock" size={10} className="shrink-0" />
                  {t('ai.suggestNeedEditor')}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {actionError && (
        <p
          className="mt-2 flex items-start gap-1.5 rounded-lg border border-danger/25 bg-danger-soft px-2 py-1.5 text-[11px] leading-4 text-danger-deep"
          role="alert"
        >
          <Icon name="warning" size={11} className="mt-0.5 shrink-0" />
          <span className="break-words">{actionError}</span>
        </p>
      )}
      <p className="mt-2 border-t border-line-soft pt-2 text-[11px] leading-4 text-ink-muted">
        {t('ai.suggestCardHint')}
      </p>
    </div>
  );
}

function ToolTraceCard({ trace }: { trace: AiToolTrace[] }) {
  // 纯 UI 折叠态：默认折叠，含失败调用的消息默认展开
  const [open, setOpen] = useState(() => trace.some((item) => !item.ok));
  const { t } = useI18n();
  if (trace.length === 0) return null;
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-line bg-page">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors duration-150 hover:bg-subtle/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
      >
        <Icon name="code" size={12} className="shrink-0 text-ink-faint" />
        <span className="shrink-0 text-[11px] font-medium text-ink-muted">
          {t('ai.toolTraceCount', { count: trace.length })}
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {trace.map((item, index) => (
            <span
              key={`${item.tool}-${index}`}
              className="inline-flex max-w-full items-center gap-1 rounded border border-line bg-card px-1.5 py-px font-mono text-[11px] text-ink-muted"
              title={`${t(TOOL_LABEL_KEYS[item.tool] ?? 'ai.toolCall')} ${JSON.stringify(item.args)}`}
            >
              <span className="shrink-0">{t(TOOL_LABEL_KEYS[item.tool] ?? 'ai.toolCall')}</span>
              <span
                className={`shrink-0 font-semibold ${
                  item.ok ? 'text-success' : 'text-danger'
                }`}
                aria-label={item.ok ? t('ai.toolOk') : t('ai.toolFail')}
              >
                {item.ok ? '✓' : '✗'}
              </span>
            </span>
          ))}
        </span>
        <Icon
          name="chevron-down"
          size={12}
          className={`shrink-0 text-ink-faint transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-line-soft px-2.5 py-1.5">
          {trace.map((item, index) => (
            <div
              key={`${item.tool}-detail-${index}`}
              className={`flex items-start gap-2 rounded-md px-1 py-1.5 ${
                item.ok ? '' : 'bg-danger-soft'
              }`}
            >
              <Icon
                name={item.ok ? 'check' : 'close'}
                size={12}
                className={`mt-0.5 shrink-0 ${item.ok ? 'text-success' : 'text-danger'}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`text-[12px] font-medium ${
                      item.ok ? 'text-ink-soft' : 'text-danger-deep'
                    }`}
                  >
                    {t(TOOL_LABEL_KEYS[item.tool] ?? 'ai.toolCall')}
                  </span>
                  <span className="rounded bg-subtle px-1.5 py-px font-mono text-[11px] text-ink-muted">
                    {item.tool}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-all rounded-md bg-subtle px-2 py-1.5 font-mono text-[11px] leading-4 text-ink-muted">
                  {JSON.stringify(item.args)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AiAssistantDrawer({
  open,
  token,
  focus,
  canEdit,
  onClose,
  onGraph,
  onSuggested,
  onRefresh,
  onFieldFocus,
}: AiAssistantDrawerProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusReloadKey, setStatusReloadKey] = useState(0);

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

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
            : t('ai.statusLoadFailed'),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatusLoading(false);
      });
    return () => controller.abort();
  }, [open, token, statusReloadKey]);

  // 打开时焦点移入（输入框）、关闭后焦点还原、Esc 栈顶协议、Tab 圈定、
  // body 滚动锁均由 ModalShell → useOverlayBehavior 统一承担（评审 R13）；
  // 常驻组件 open=false 时不渲染 ModalShell，行为基座仅在打开期间激活。

  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries, sending, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateEntry = useCallback(
    (id: number, patch: (entry: ChatEntry) => ChatEntry) => {
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? patch(entry) : entry)),
      );
    },
    [],
  );

  /** 关闭即软中断（评审 R17）：流进行中先追加本地中止提示再 abort，随后收起抽屉；
   *  不回滚已落库的建议（停止只终止「当前回合」的前端等待）。 */
  const handleRequestClose = useCallback(() => {
    if (sending) {
      setEntries((current) => [
        ...current,
        {
          id: entrySeq.current,
          role: 'assistant' as const,
          content: t('ai.stoppedLocally'),
          notice: true,
        },
      ]);
      entrySeq.current += 1;
      abortRef.current?.abort();
    }
    onClose();
  }, [sending, onClose, t]);

  /** 清空对话（评审 R17）：确认后清空会话与本地决策；会话仍存内存，不回滚后端已落库数据 */
  const handleClearEntries = useCallback(() => {
    setClearConfirmOpen(false);
    setEntries([]);
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
    const assistantId = entrySeq.current;
    entrySeq.current += 1;
    setEntries((current) => [
      ...current,
      userEntry,
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    setInput('');
    setSending(true);

    // 只回传有内容的 user/assistant 文本；system 提示由后端固定。
    // 本地提示行（notice）与错误条目不回传模型。
    const history: AiChatMessage[] = [
      ...entries,
      userEntry,
    ]
      .filter(
        (entry) =>
          !entry.error && !entry.notice && entry.content.trim().length > 0,
      )
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
      await sendAiChatStream(
        token,
        { messages: history, ...(focusPayload ? { focus: focusPayload } : {}) },
        (event) => {
          switch (event.type) {
            case 'token':
              updateEntry(assistantId, (entry) => ({
                ...entry,
                content: entry.content + event.delta,
              }));
              break;
            case 'tool':
              updateEntry(assistantId, (entry) => ({
                ...entry,
                toolTrace: [
                  ...(entry.toolTrace ?? []),
                  { tool: event.tool, args: event.args, ok: event.ok },
                ],
              }));
              break;
            case 'suggest':
              onSuggested(event.count);
              if (event.candidates?.length) {
                updateEntry(assistantId, (entry) => {
                  const existing = entry.suggestCards ?? [];
                  const seen = new Set(existing.flat().map(suggestKey));
                  const fresh = event.candidates.filter(
                    (item) => !seen.has(suggestKey(item)),
                  );
                  return fresh.length
                    ? { ...entry, suggestCards: [...existing, fresh] }
                    : entry;
                });
              }
              break;
            case 'drafts':
              updateEntry(assistantId, (entry) => ({
                ...entry,
                drafts: event.items,
              }));
              break;
            case 'done':
              updateEntry(assistantId, (entry) => {
                // done 载荷与 suggest 事件可能携带同一批候选，按签名去重合并
                const cards = entry.suggestCards ?? [];
                const seen = new Set(cards.flat().map(suggestKey));
                const fresh = (event.suggestions ?? []).filter(
                  (item) => !seen.has(suggestKey(item)),
                );
                return {
                  ...entry,
                  content: event.answer,
                  toolTrace: event.tool_trace,
                  graph: event.graph,
                  drafts:
                    event.drafts && event.drafts.length > 0
                      ? event.drafts
                      : entry.drafts,
                  suggestCards: fresh.length
                    ? [...cards, fresh]
                    : entry.suggestCards,
                  streaming: false,
                };
              });
              // 每轮回答都通知 Workspace：无 graph 则只更新高亮焦点
              //（未声明 highlights 时为显式清除上一轮追踪态）
              onGraph(event.graph ?? null, event.highlights);
              break;
            case 'error':
              updateEntry(assistantId, (entry) => ({
                ...entry,
                streaming: false,
                error: true,
                // 限流（429）优先用 i18n 文案；其余沿用后端 detail（评审 R17/R11）
                content:
                  event.status === '429'
                    ? t('ai.rateLimited')
                    : t('ai.serviceError', {
                        status: event.status,
                        detail: event.detail,
                      }),
              }));
              break;
          }
        },
        controller.signal,
      );
      updateEntry(assistantId, (entry) => ({
        ...entry,
        streaming: false,
      }));
    } catch (reason) {
      if (isAbortError(reason)) {
        updateEntry(assistantId, (entry) => ({
          ...entry,
          streaming: false,
          content: entry.content || t('ai.cancelled'),
        }));
      } else {
        updateEntry(assistantId, (entry) => ({
          ...entry,
          streaming: false,
          error: true,
          content:
            reason instanceof ApiError
              ? reason.status === 429
                ? t('ai.rateLimited')
                : reason.message
              : t('ai.connectFailed'),
        }));
      }
    } finally {
      // 复位条件改为「仍是当前回合的 controller」：停止/关抽屉的中止（controller
      // 仍为当前）也能恢复输入；被新一轮替换的旧回合不抢复位（评审 R17）
      if (abortRef.current === controller) setSending(false);
    }
  }

  if (!open) return null;

  const inputDisabled = !configured || sending || statusLoading;

  return (
    <>
    <ModalShell
      variant="drawer"
      open
      title={t('ai.title')}
      titleId="ai-drawer-title"
      titleIcon="sparkles"
      badgeClassName="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ai/25 bg-ai-soft text-ai"
      onRequestClose={handleRequestClose}
      className="sm:w-[480px]"
      closeLabel={t('ai.closeAria')}
      initialFocusRef={inputRef}
      titleNode={
        <>
          <h2
            id="ai-drawer-title"
            className="min-w-0 text-[14px] font-semibold text-ink"
          >
            {t('ai.title')}
          </h2>
          {statusLoading ? (
            <span
              className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-ai/25 border-t-ai"
              aria-label={t('ai.statusLoadingAria')}
            />
          ) : configured && status?.model ? (
            <span
              className="max-w-[180px] truncate rounded-full border border-ai/25 bg-ai-soft px-2 py-px font-mono text-[11px] text-ai-deep"
              title={status.model}
            >
              {status.model}
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-line bg-subtle px-2 py-px font-mono text-[11px] text-ink-muted">
              {statusError ? t('ai.statusUnknown') : t('ai.notConfigured')}
            </span>
          )}
        </>
      }
      headerExtra={
        <>
          <button
            type="button"
            onClick={() => setClearConfirmOpen(true)}
            disabled={sending}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('ai.clearChat')}
            title={t('ai.clearChat')}
          >
            <Icon name="trash" size={14} />
          </button>
          <button
            type="button"
            onClick={() => setStatusReloadKey((value) => value + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors duration-150 hover:bg-subtle hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            aria-label={t('ai.reloadAria')}
            title={t('ai.reloadTitle')}
          >
            <Icon name="refresh" size={14} />
          </button>
        </>
      }
      subHeader={
        <>
          <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line-soft bg-page px-4">
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              {t('ai.focusCurrent')}
            </span>
            <span
              className={`min-w-0 truncate font-mono text-[12px] ${
                focus ? 'font-medium text-brand-700' : 'text-ink-faint'
              }`}
              title={focusLabel(focus, t)}
            >
              {focusLabel(focus, t)}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-card px-1.5 py-px font-mono text-[11px] text-ink-muted">
              <Icon name="lock" size={10} />
              {t('ai.readonlyTools')}
            </span>
          </div>

          {(statusError || (!statusLoading && status && !status.configured)) && (
            <div className="shrink-0 border-b border-line-soft px-4 py-2.5">
              <div
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12px] leading-5 ${
                  statusError
                    ? 'border-danger/25 bg-danger-soft text-danger-deep'
                    : 'border-warning/25 bg-warning-soft text-warning-deep'
                } animate-fade-in`}
                role="status"
              >
                <Icon
                  name="warning"
                  size={12}
                  className={`mt-0.5 shrink-0 ${statusError ? 'text-danger' : 'text-warning'}`}
                />
                <div className="min-w-0">
                  <div className="font-medium">
                    {statusError ? t('ai.statusErrorTitle') : t('ai.unavailableTitle')}
                  </div>
                  <p className="mt-0.5 break-words">
                    {statusError ?? t('ai.notConfiguredHint')}
                  </p>
                  {!statusError && (
                    <p className="mt-0.5 break-words">
                      {t('ai.notConfiguredAction')}
                    </p>
                  )}
                  {statusError && (
                    <button
                      type="button"
                      onClick={() => setStatusReloadKey((value) => value + 1)}
                      className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-md border border-danger/25 bg-card px-2 font-mono text-[11px] text-danger-deep transition-colors duration-150 hover:border-danger/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                    >
                      <Icon name="refresh" size={11} />
                      {t('common.retry')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      }
      bodyProps={{
        ref: listRef,
        role: 'log',
        'aria-live': 'polite',
        'aria-label': t('ai.logAria'),
      }}
      bodyClassName="min-h-0 flex-1 overflow-y-auto bg-page px-4 py-4 pb-6"
      footerClassName="shrink-0 border-t border-line-soft bg-card p-3"
      footer={
        <form onSubmit={handleSubmit}>
          <div className="flex items-end gap-2">
            <label htmlFor="ai-chat-input" className="sr-only">
              {t('ai.inputLabel')}
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
                  ? t('ai.placeholderChecking')
                  : statusError
                    ? t('ai.placeholderStatusError')
                    : configured
                      ? t('ai.placeholderReady')
                      : t('ai.placeholderNotConfigured')
              }
              className="field-input min-h-[56px] flex-1 resize-none py-2 text-[13px] leading-5 disabled:cursor-not-allowed"
            />
            {sending ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-danger px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-danger-deep active:bg-danger-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              >
                <Icon name="stop" size={14} />
                {t('ai.stop')}
              </button>
            ) : (
              <button
                type="submit"
                disabled={inputDisabled || !input.trim()}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-700 px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                <Icon name="send" size={14} />
                {t('ai.send')}
              </button>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[11px] text-ink-faint">
            <span>{t('ai.inputHint')}</span>
            <span className="tabular-nums">
              {input.length >= 8000 ? (
                <span className="text-danger-deep">{input.length}/8000</span>
              ) : (
                `${input.length}/8000`
              )}
            </span>
          </div>
        </form>
      }
    >
          {entries.length === 0 && !sending ? (
            <div className="flex min-h-full flex-col items-center justify-center px-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-ai/25 bg-ai-soft text-ai">
                <Icon name="sparkles" size={24} />
              </div>
              <h3 className="mt-4 text-xl font-medium text-ink">
                {t('ai.emptyTitle')}
              </h3>
              <p className="mt-2 max-w-[300px] text-[13px] leading-6 text-ink-muted">
                {t('ai.emptyBody')}
              </p>
              <div className="mt-5 grid w-full max-w-[300px] gap-1.5">
                {EXAMPLE_PROMPT_KEYS.map((key) => {
                  const prompt = t(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setInput(prompt);
                        inputRef.current?.focus();
                      }}
                      disabled={inputDisabled}
                      className="w-full rounded-lg border border-line bg-card px-3 py-2 text-left text-[12px] text-ink-muted transition-colors duration-150 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) =>
                entry.notice ? (
                  <div key={entry.id} className="flex justify-center">
                    <p className="flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[11px] leading-4 text-ink-faint">
                      <Icon name="info" size={10} className="shrink-0" />
                      {entry.content}
                    </p>
                  </div>
                ) : entry.role === 'user' ? (
                  <div key={entry.id} className="flex flex-col items-end">
                    <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      {t('ai.you')}
                    </div>
                    <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl rounded-tr-md border border-brand-100 bg-brand-50 px-3 py-2 text-[13px] leading-5 text-ink">
                      {entry.content}
                    </div>
                  </div>
                ) : (
                  <div key={entry.id}>
                    <div className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      <Icon name="sparkles" size={10} className="text-ai" />
                      {t('ai.title')}
                    </div>
                    <div
                      className={`rounded-xl rounded-tl-md border px-3 py-2.5 ${
                        entry.error
                          ? 'border-danger/25 bg-danger-soft/70'
                          : 'border-line bg-card'
                      }`}
                    >
                      {entry.toolTrace && entry.toolTrace.length > 0 && (
                        <ToolTraceCard trace={entry.toolTrace} />
                      )}
                      {entry.content.trim() ? (
                        <AnswerText
                          content={entry.content}
                          onFieldFocus={onFieldFocus}
                          streaming={entry.streaming}
                        />
                      ) : entry.streaming ? (
                        <p className="flex items-center gap-2 text-[12px] text-ink-muted">
                          <span
                            className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-ai/25 border-t-ai"
                            aria-hidden="true"
                          />
                          {t('ai.thinking')}
                        </p>
                      ) : (
                        <p className="text-[12px] italic leading-5 text-ink-faint">
                          {t('ai.noAnswer')}
                        </p>
                      )}
                      {(entry.drafts ?? []).length > 0 && (
                        <div className="mt-2 space-y-2">
                          {(entry.drafts ?? []).map((draft) => (
                            <DraftCard
                              key={draft.id}
                              item={draft}
                              token={token}
                              canEdit={canEdit}
                              onUpdate={(next) =>
                                updateEntry(entry.id, (current) => ({
                                  ...current,
                                  drafts: (current.drafts ?? []).map((item) =>
                                    item.id === next.id ? next : item),
                                }))
                              }
                            />
                          ))}
                        </div>
                      )}
                      {entry.graph && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-success/25 bg-success-soft px-2.5 py-2 text-[12px] text-success-deep">
                          <Icon name="network" size={12} className="shrink-0" />
                          <span className="font-medium">{t('ai.canvasUpdated')}</span>
                          <span className="font-mono text-[11px] tabular-nums">
                            {t('ai.graphSummary', {
                              datasets: entry.graph.datasets.length,
                              edges: entry.graph.edges.length,
                            })}
                          </span>
                          <button
                            type="button"
                            onClick={handleRequestClose}
                            className="ml-auto rounded px-1.5 py-0.5 font-medium text-success-deep transition-colors duration-150 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                          >
                            {t('ai.closeAndView')}
                          </button>
                        </div>
                      )}
                    </div>
                    {(entry.suggestCards ?? []).length > 0 && (
                      <div className="mt-2 space-y-2">
                        {(entry.suggestCards ?? []).map((cards, cardIndex) => (
                          <InlineSuggestCard
                            key={cardIndex}
                            token={token}
                            canEdit={canEdit}
                            candidates={cards}
                            decisions={entry.suggestDecisions ?? {}}
                            onDecided={(key, status) => {
                              updateEntry(entry.id, (current) => ({
                                ...current,
                                suggestDecisions: {
                                  ...(current.suggestDecisions ?? {}),
                                  [key]: status,
                                },
                              }));
                              // 确认（转人工边）/拒绝成功后刷新画布，同 onSuggested 链路
                              onRefresh?.();
                            }}
                            onViewOnCanvas={onFieldFocus}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
    </ModalShell>

    <ConfirmDialog
      open={clearConfirmOpen}
      title={t('ai.clearConfirmTitle')}
      danger
      message={<p>{t('ai.clearConfirmMessage')}</p>}
      onConfirm={handleClearEntries}
      onCancel={() => setClearConfirmOpen(false)}
    />
    </>
  );
}
