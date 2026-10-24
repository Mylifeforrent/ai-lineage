import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { LineageEdge } from '../types';
import { ApiError, confirmAiSuggestion, patchEdge } from '../lib/api';
import { edgeEntityKey } from '../lib/entities';
import { formatConfidence } from '../lib/format';
import { Icon } from './Icon';
import { useI18n, type TranslateFn } from '../i18n';
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

const kindLabel = (edge: LineageEdge, t: TranslateFn) =>
  edge.from_field === null || edge.to_field === null
    ? t('edgeDetail.kindTable')
    : t('edgeDetail.kindField');

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
  const { t } = useI18n();
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
      setError(t('edgeDetail.confidenceInvalid'));
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
          : t('edgeDetail.saveFailed'),
      );
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
      <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5">
        <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-brand-700">
          <Icon name="edit" size={11} />
          {t('edgeDetail.editBanner')}
        </div>
        <p className="mt-1 text-[12px] leading-4 text-brand-800">
          {t('edgeDetail.editBannerNote')}
        </p>
      </div>

      <div>
        <label htmlFor="edge-detail-transform" className="mb-1.5 block text-[12px] font-medium text-ink-soft">
          {t('edgeDetail.transformLabel')}
        </label>
        <textarea
          id="edge-detail-transform"
          value={transform}
          onChange={(event) => setTransform(event.target.value)}
          rows={2}
          maxLength={200}
          placeholder={t('edgeDetail.transformPlaceholder')}
          className="field-input resize-y py-2 font-mono text-[13px] leading-5"
          disabled={saving}
        />
      </div>

      <div>
        <label htmlFor="edge-detail-confidence" className="mb-1.5 block text-[12px] font-medium text-ink-soft">
          {t('edgeDetail.confidenceLabel')}
        </label>
        <input
          id="edge-detail-confidence"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(event) => setConfidence(event.target.value)}
          className="field-input h-8 font-mono text-[13px]"
          disabled={saving}
        />
      </div>

      <div>
        <label htmlFor="edge-detail-note" className="mb-1.5 block text-[12px] font-medium text-ink-soft">
          {t('edgeDetail.noteLabel')}
        </label>
        <textarea
          id="edge-detail-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder={t('edgeDetail.notePlaceholder')}
          className="field-input resize-y py-2 text-[13px] leading-5"
          disabled={saving}
        />
      </div>

      {error && (
        <div
          className="flex gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[12px] leading-4 text-danger-deep"
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
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-700 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {saving ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
              {t('edgeDetail.saving')}
            </>
          ) : (
            <>
              <Icon name="check" size={12} />
              {t('edgeDetail.save')}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-8 rounded-lg border border-line-strong bg-card px-3 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('common.cancel')}
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
  const { t } = useI18n();
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
      onNotify(t('edgeDetail.aiConfirmed', { id: confirmed.id }), 'success');
      onRefresh();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setConfirmError(
        reason instanceof ApiError
          ? reason.message
          : t('edgeDetail.confirmFailed'),
      );
    } finally {
      if (!controller.signal.aborted) setConfirming(false);
    }
  }

  return (
    <aside
      className="relative flex w-full shrink-0 flex-col border-t border-line bg-card xl:h-full xl:w-[320px] xl:border-l xl:border-t-0"
      aria-label={t('edgeDetail.asideLabel')}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-soft px-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            {t('edgeDetail.inspectorTitle')}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-ink-muted">
            <Icon name="link" size={12} className="shrink-0" />
            <span className="truncate">#{edge.id}</span>
            <Icon name="chevron-right" size={12} className="shrink-0" />
            <span className="truncate text-brand-700">{kindLabel(edge, t)}</span>
          </div>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors duration-150 hover:border-line hover:bg-card hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            aria-label={t('edgeDetail.viewHistory')}
            title={t('edgeDetail.historyShort')}
          >
            <Icon name="history" size={14} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors duration-150 hover:border-line hover:bg-card hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              aria-label={editing ? t('edgeDetail.exitEdit') : t('edgeDetail.editEdge')}
              title={editing ? t('edgeDetail.exitEditShort') : t('edgeDetail.editShort')}
            >
              <Icon name="edit" size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-ink-faint transition-colors duration-150 hover:border-line hover:bg-card hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
            aria-label={t('edgeDetail.close')}
            title={t('edgeDetail.closeShort')}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-7">
        <div className="animate-fade-in">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] uppercase text-ink-muted">
              {kindLabel(edge, t)}
            </span>
            <SourceBadge source={edge.source} />
            <span className="rounded border border-line bg-page px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
              {t('edgeDetail.confidenceBadge', { value: formatConfidence(edge.confidence) })}
            </span>
          </div>
          <h2 className="mt-2.5 text-lg font-semibold text-ink">
            {t('edgeDetail.edgeTitle', { id: edge.id })}
          </h2>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-card">
          <div className="border-b border-line-soft px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
              {t('edgeDetail.endpoints')}
            </span>
          </div>
          <div className="divide-y divide-line-soft">
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded bg-subtle px-1.5 py-px font-mono text-[11px] text-ink-muted">
                {t('edgeDetail.upstream')}
              </span>
              <span className="break-all font-mono text-[13px] leading-5 text-ink-soft">
                {endpointLabel(edge.from_dataset, edge.from_field)}
              </span>
            </div>
            <div className="flex items-start gap-2 px-3 py-2">
              <span className="mt-0.5 shrink-0 rounded bg-subtle px-1.5 py-px font-mono text-[11px] text-ink-muted">
                {t('edgeDetail.downstream')}
              </span>
              <span className="break-all font-mono text-[13px] leading-5 text-brand-800">
                {endpointLabel(edge.to_dataset, edge.to_field)}
              </span>
            </div>
          </div>
        </div>

        {edge.source === 'ai' && (
          <div className="mt-4 rounded-xl border border-ai/25 bg-ai-soft/40 p-3">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ai-deep">
              <Icon name="sparkles" size={12} className="text-ai" />
              {t('edgeDetail.aiCandidate')}
            </div>
            <p className="mt-1 text-[12px] leading-4 text-ink-muted">
              {t('edgeDetail.aiCandidateNote')}
            </p>
            {canEdit ? (
              <button
                type="button"
                onClick={handleConfirmAi}
                disabled={confirming}
                className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-700 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {confirming ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                    {t('edgeDetail.confirming')}
                  </>
                ) : (
                  <>
                    <Icon name="check" size={12} />
                    {t('edgeDetail.confirmToManual')}
                  </>
                )}
              </button>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-faint">
                <Icon name="lock" size={12} />
                {t('edgeDetail.confirmReadonly')}
              </p>
            )}
            {confirmError && (
              <p
                className="mt-2 rounded-md border border-danger/25 bg-danger-soft px-2 py-1.5 text-[12px] leading-4 text-danger-deep"
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
              onNotify(t('edgeDetail.edgeUpdated', { id: edge.id }), 'success');
              onRefresh();
            }}
          />
        ) : (
          <>
            <div className="mt-4 grid gap-2">
              <div className="rounded-xl border border-line-soft bg-card px-3 py-2.5">
                <div className="font-mono text-[11px] uppercase text-ink-faint">
                  {t('edgeDetail.transformLabel')}
                </div>
                <p className="mt-1 break-words font-mono text-[13px] leading-5 text-ink-soft">
                  {edge.transform || t('edgeDetail.notFilled')}
                </p>
              </div>
              <div className="rounded-xl border border-line-soft bg-card px-3 py-2.5">
                <div className="font-mono text-[11px] uppercase text-ink-faint">
                  {t('edgeDetail.noteLabel')}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-ink-soft">
                  {edge.note || t('edgeDetail.notFilled')}
                </p>
              </div>
            </div>

            {canEdit && (
              <div className="mt-4 flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-line-strong bg-card text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                >
                  <Icon name="edit" size={13} />
                  {t('edgeDetail.editTransformNote')}
                </button>
                <button
                  type="button"
                  onClick={() => onRequestDelete(edge)}
                  className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-danger/25 bg-danger-soft px-3 text-[13px] font-medium text-danger-deep transition-colors duration-150 hover:border-danger/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                >
                  <Icon name="trash" size={13} />
                  {t('edgeDetail.delete')}
                </button>
              </div>
            )}
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
              <Icon name={canEdit ? 'edit' : 'lock'} size={12} />
              {canEdit
                ? edge.source === 'ai'
                  ? t('edgeDetail.tipEditAi')
                  : t('edgeDetail.tipEdit')
                : t('edgeDetail.tipReadonly')}
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
                className="flex w-full items-center justify-between rounded-xl border border-line bg-card px-3 py-2.5 text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              >
                <span className="flex items-center gap-1.5">
                  <Icon name="history" size={12} />
                  {t('edgeDetail.historyShort')}
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
          title={t('edgeDetail.edgeTitle', { id: edge.id })}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </aside>
  );
}
