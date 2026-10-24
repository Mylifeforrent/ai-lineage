import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { LineageEdge } from '../types';
import { ApiError, confirmAiSuggestion, patchEdge } from '../lib/api';
import { edgeEntityKey } from '../lib/entities';
import { formatConfidence } from '../lib/format';
import { Icon } from './Icon';
import { SourceBadge } from './SourceBadge';
import { AnnotationSection } from './AnnotationSection';
import { HistoryDrawer } from './HistoryDrawer';
import type { ToastTone } from './Toast';

interface EdgeDetailPanelProps {
  edge: LineageEdge;
  token: string;
  canEdit: boolean;
  startEditing: boolean;
  onClose: () => void;
  onRequestDelete: (edge: LineageEdge) => void;
  onRefresh: () => void;
  onNotify: (message: string, tone?: ToastTone) => void;
}

const KIND_LABEL = (edge: LineageEdge) =>
  edge.from_field === null || edge.to_field === null ? '表级血缘' : '字段级血缘';

const endpointLabel = (
  dataset: string,
  field: string | null,
): string => `${dataset}.${field ?? '*'}`;

interface EdgeEditorProps {
  token: string;
  edge: LineageEdge;
  onCancel: () => void;
  onSaved: () => void;
}

function EdgeEditor({ token, edge, onCancel, onSaved }: EdgeEditorProps) {
  const [transform, setTransform] = useState(edge.transform ?? '');
  const [note, setNote] = useState(edge.note ?? '');
  const [confidence, setConfidence] = useState(
    edge.confidence === null ? '1' : String(edge.confidence),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const parsedConfidence = Number(confidence);
    if (
      !Number.isFinite(parsedConfidence) ||
      parsedConfidence < 0 ||
      parsedConfidence > 1
    ) {
      setError('置信度必须是 0 到 1 之间的数字。');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSaving(true);
    setError(null);
    try {
      await patchEdge(
        token,
        edge.id,
        {
          transform: transform.trim() || null,
          note: note.trim() || null,
          confidence: parsedConfidence,
        },
        controller.signal,
      );
      onSaved();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(
        reason instanceof ApiError
          ? reason.message
          : '血缘边保存失败，请稍后重试。',
      );
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
      <div className="rounded-xl border border-pine-200 bg-pine-50/45 px-3 py-2.5">
        <div className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-pine-700">
          <Icon name="edit" size={11} />
          编辑转换与备注
        </div>
        <p className="mt-1 text-[9px] leading-4 text-pine-800/80">
          来源与上下游端点不可修改；保存后会写入变更日志。
        </p>
      </div>

      <div>
        <label htmlFor="edge-detail-transform" className="mb-1 block text-[10.5px] font-medium text-ink-soft">
          转换说明
        </label>
        <textarea
          id="edge-detail-transform"
          value={transform}
          onChange={(event) => setTransform(event.target.value)}
          rows={2}
          maxLength={200}
          placeholder="如 trim/cast、lookup"
          className="field-input resize-y py-2 font-mono text-[10.5px] leading-5"
          disabled={saving}
        />
      </div>

      <div>
        <label htmlFor="edge-detail-confidence" className="mb-1 block text-[10.5px] font-medium text-ink-soft">
          置信度（0~1）
        </label>
        <input
          id="edge-detail-confidence"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(event) => setConfidence(event.target.value)}
          className="field-input h-9 font-mono text-[10.5px]"
          disabled={saving}
        />
      </div>

      <div>
        <label htmlFor="edge-detail-note" className="mb-1 block text-[10.5px] font-medium text-ink-soft">
          备注
        </label>
        <textarea
          id="edge-detail-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="补充人工判断依据（可选）"
          className="field-input resize-y py-2 text-[10.5px] leading-5"
          disabled={saving}
        />
      </div>

      {error && (
        <div
          className="flex gap-2 rounded-lg border border-rosewood/20 bg-rosewood-soft px-3 py-2 text-[10px] leading-4 text-rosewood-deep"
          role="alert"
        >
          <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-pine-800 text-[10.5px] font-semibold text-white transition-colors hover:bg-pine-900 disabled:cursor-wait disabled:opacity-65"
        >
          {saving ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
              保存中…
            </>
          ) : (
            <>
              <Icon name="check" size={12} />
              保存
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-9 rounded-lg border border-line bg-surface px-3 text-[10.5px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
        >
          取消
        </button>
      </div>
    </form>
  );
}

export function EdgeDetailPanel({
  edge,
  token,
  canEdit,
  startEditing,
  onClose,
  onRequestDelete,
  onRefresh,
  onNotify,
}: EdgeDetailPanelProps) {
  const [editing, setEditing] = useState(startEditing);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const confirmAbort = useRef<AbortController | null>(null);
  const targetId = edgeEntityKey(edge);

  useEffect(() => {
    setEditing(startEditing);
    setHistoryOpen(false);
    confirmAbort.current?.abort();
    setConfirming(false);
    setConfirmError(null);
  }, [edge.id, startEditing]);

  useEffect(() => () => confirmAbort.current?.abort(), []);

  async function handleConfirmAi() {
    if (confirming) return;
    confirmAbort.current?.abort();
    const controller = new AbortController();
    confirmAbort.current = controller;
    setConfirming(true);
    setConfirmError(null);
    try {
      const confirmed = await confirmAiSuggestion(
        token,
        {
          from_dataset: edge.from_dataset,
          from_field: edge.from_field,
          to_dataset: edge.to_dataset,
          to_field: edge.to_field,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      onNotify(`AI 候选 #${confirmed.id} 已确认转为人工边`, 'success');
      onRefresh();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setConfirmError(
        reason instanceof ApiError
          ? reason.message
          : '确认 AI 候选失败，请稍后重试。',
      );
    } finally {
      if (!controller.signal.aborted) setConfirming(false);
    }
  }

  return (
    <aside
      className="relative z-10 flex w-full shrink-0 flex-col border-t border-line bg-[#f8f5ed]/80 xl:h-full xl:w-[340px] xl:border-l xl:border-t-0"
      aria-label="血缘边详情"
    >
      <div className="flex shrink-0 items-start justify-between border-b border-line-soft px-4 py-3.5">
        <div className="min-w-0">
          <div className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-ink-faint">
            血缘边检查
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[9px] text-ink-muted">
            <Icon name="link" size={10} className="shrink-0" />
            <span className="truncate">#{edge.id}</span>
            <Icon name="chevron-right" size={9} className="shrink-0" />
            <span className="truncate text-pine-700">{KIND_LABEL(edge)}</span>
          </div>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-surface hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
            aria-label="查看血缘边变更历史"
            title="变更历史"
          >
            <Icon name="history" size={14} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-surface hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
              aria-label={editing ? '退出边编辑' : '编辑血缘边'}
              title={editing ? '退出编辑' : '编辑'}
            >
              <Icon name="edit" size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors hover:border-line hover:bg-surface hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
            aria-label="关闭血缘边详情"
            title="关闭详情"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-7">
        <div className="animate-fade-in">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-line bg-surface/80 px-1.5 py-[2px] font-mono text-[8.5px] uppercase tracking-[0.08em] text-ink-muted">
              {KIND_LABEL(edge)}
            </span>
            <SourceBadge source={edge.source} />
            <span className="rounded border border-line bg-canvas/65 px-1.5 py-[2px] font-mono text-[8.5px] text-ink-muted">
              置信度 {formatConfidence(edge.confidence)}
            </span>
          </div>
          <h2 className="mt-2.5 font-display text-[22px] font-medium tracking-[-0.025em] text-ink">
            血缘边 #{edge.id}
          </h2>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-surface/75">
          <div className="border-b border-line-soft px-3 py-2">
            <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-ink-faint">
              上下游端点
            </span>
          </div>
          <div className="divide-y divide-line-soft">
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded bg-canvas/70 px-1.5 py-[1px] font-mono text-[7.5px] text-ink-faint">
                上游
              </span>
              <span className="break-all font-mono text-[10px] leading-4 text-ink-soft">
                {endpointLabel(edge.from_dataset, edge.from_field)}
              </span>
            </div>
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded bg-canvas/70 px-1.5 py-[1px] font-mono text-[7.5px] text-ink-faint">
                下游
              </span>
              <span className="break-all font-mono text-[10px] leading-4 text-pine-800">
                {endpointLabel(edge.to_dataset, edge.to_field)}
              </span>
            </div>
          </div>
        </div>

        {edge.source === 'ai' && (
          <div className="mt-4 rounded-xl border border-ai/25 bg-ai-soft/40 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-ai-deep">
              <Icon name="sparkles" size={12} />
              AI 候选血缘
            </div>
            <p className="mt-1 text-[9px] leading-4 text-ink-muted">
              该边由启发式建议生成（source=ai），尚未生效。确认后转为人工边
              （source=manual）并写入变更日志；拒绝可直接删除该边。
            </p>
            {canEdit ? (
              <button
                type="button"
                onClick={handleConfirmAi}
                disabled={confirming}
                className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-pine-800 text-[10px] font-semibold text-white transition-colors hover:bg-pine-900 disabled:cursor-wait disabled:opacity-65"
              >
                {confirming ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                    确认中…
                  </>
                ) : (
                  <>
                    <Icon name="check" size={11} />
                    确认转为人工边
                  </>
                )}
              </button>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-[9px] text-ink-faint">
                <Icon name="lock" size={10} />
                只读角色不能确认 AI 候选。
              </p>
            )}
            {confirmError && (
              <p
                className="mt-2 rounded-md border border-rosewood/20 bg-rosewood-soft px-2 py-1.5 text-[9px] leading-4 text-rosewood-deep"
                role="alert"
              >
                {confirmError}
              </p>
            )}
          </div>
        )}

        {editing ? (
          <EdgeEditor
            key={`edge-${edge.id}`}
            token={token}
            edge={edge}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onNotify(`血缘边 #${edge.id} 已更新`, 'success');
              onRefresh();
            }}
          />
        ) : (
          <>
            <div className="mt-4 grid gap-2">
              <div className="rounded-xl border border-line-soft bg-surface/70 px-3 py-2.5">
                <div className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                  转换说明
                </div>
                <p className="mt-1 break-words font-mono text-[10px] leading-4 text-ink-soft">
                  {edge.transform || '未填写'}
                </p>
              </div>
              <div className="rounded-xl border border-line-soft bg-surface/70 px-3 py-2.5">
                <div className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-faint">
                  备注
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-[1.7] text-ink-soft">
                  {edge.note || '未填写'}
                </p>
              </div>
            </div>

            {canEdit && (
              <div className="mt-4 flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[10.5px] font-medium text-ink-muted transition-colors hover:border-pine-300 hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/35"
                >
                  <Icon name="edit" size={13} />
                  编辑转换与备注
                </button>
                <button
                  type="button"
                  onClick={() => onRequestDelete(edge)}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-rosewood/20 bg-rosewood-soft px-3 text-[10.5px] font-medium text-rosewood transition-colors hover:border-rosewood/40 hover:bg-[#f4dfe1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rosewood/30"
                >
                  <Icon name="trash" size={13} />
                  删除
                </button>
              </div>
            )}
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[9px] text-ink-faint">
              <Icon name={canEdit ? 'edit' : 'lock'} size={10} />
              {canEdit
                ? edge.source === 'ai'
                  ? 'AI 候选确认后才会生效；删除等价于拒绝该候选'
                  : '编辑会写入变更日志；删除可通过版本标签回滚恢复'
                : '只读角色 · 可查看标注与变更历史'}
            </div>

            <AnnotationSection
              token={token}
              targetKind="edge"
              targetId={targetId}
              canWrite={canEdit}
            />

            <section className="mt-5">
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="flex w-full items-center justify-between rounded-xl border border-line bg-surface/70 px-3 py-2.5 text-[9.5px] font-medium text-ink-muted transition-colors hover:border-pine-300 hover:text-pine-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine-500/30"
              >
                <span className="flex items-center gap-1.5">
                  <Icon name="history" size={12} />
                  变更历史
                </span>
                <Icon name="chevron-right" size={12} className="text-ink-faint" />
              </button>
            </section>
          </>
        )}
      </div>

      {historyOpen && (
        <HistoryDrawer
          token={token}
          entityKind="edge"
          entityKey={targetId}
          title={`血缘边 #${edge.id}`}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </aside>
  );
}
