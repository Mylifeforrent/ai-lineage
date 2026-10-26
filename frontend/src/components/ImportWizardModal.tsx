import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ImportFormat,
  ImportResult,
  SourceFileRecord,
} from '../types';
import {
  ApiError,
  getImportBatches,
  isAbortError,
  submitImport,
  uploadSourceFiles,
} from '../lib/api';
import { formatFileSize } from '../lib/format';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { ModalShell } from './ModalShell';
import type { ToastTone } from './Toast';
import { useI18n, type TranslateFn } from '../i18n';
import type { ImportWizKey } from '../i18n/dicts/importWiz';

interface ImportWizardModalProps {
  token: string;
  onClose: () => void;
  /** 「完成」：关闭模态并让 Workspace 刷新数据集列表与子图 */
  onCompleted: () => void;
  /** 「查看版本抽屉」：复用 TopBar「版本」入口（hi-fi 06 §一） */
  onOpenVersions: () => void;
  onNotify: (message: string, tone?: ToastTone) => void;
}

const STEP_KEYS = [
  'importWiz.step1Upload',
  'importWiz.step2Manifest',
  'importWiz.step3Validate',
  'importWiz.step4Report',
] as const;

const SUPPORTED_EXTENSIONS = ['csv', 'xlsx', 'json'] as const;

const FORMAT_HINT_KEYS: Record<ImportFormat, ImportWizKey> = {
  csv: 'importWiz.fmtCsvHint',
  xlsx: 'importWiz.fmtXlsxHint',
  json: 'importWiz.fmtJsonHint',
};

const KIND_KEYS: Partial<Record<string, ImportWizKey>> = {
  field: 'importWiz.kindField',
  edge: 'importWiz.kindEdge',
};

const STATUS_KEYS: Partial<Record<string, ImportWizKey>> = {
  ok: 'importWiz.statusOk',
  merged: 'importWiz.statusMerged',
  rejected: 'importWiz.statusRejected',
};

const STATUS_BADGES: Record<string, string> = {
  ok: 'border-transparent bg-success-soft text-success-deep',
  merged: 'border-transparent bg-warning-soft text-warning-deep',
  rejected: 'border-transparent bg-danger-soft text-danger-deep',
};

function fileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index + 1).toLowerCase();
}

/** 非组件场景：kind/status 映射查不到时回退后端原始值 */
function kindLabel(t: TranslateFn, kind: string): string {
  const key = KIND_KEYS[kind];
  return key ? t(key) : kind;
}

function statusLabel(t: TranslateFn, status: string): string {
  const key = STATUS_KEYS[status];
  return key ? t(key) : status;
}

/** 步骤①上传行（hi-fi 06 §3.3 文件列表行） */
interface UploadRow {
  key: string;
  file: File;
  record: SourceFileRecord | null;
  error: string | null;
}

interface SubmitErrorState {
  message: string;
  /** 网络错误提供「重试」，清单文件级错误回步骤②修改（hi-fi 06 §五） */
  retryable: boolean;
}

/** 通用 Dropzone（hi-fi 06 §3.3/§3.4：label 包裹 sr-only input，键盘经 focus-within 可达） */
function Dropzone({
  title,
  hint,
  accept,
  multiple = false,
  disabled = false,
  compact = false,
  onFiles,
}: {
  title: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong bg-page text-center transition-colors duration-150 focus-within:ring-2 focus-within:ring-brand-600/60 ${
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10'
      } ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : dragOver
            ? 'border-brand-400 bg-brand-50/60'
            : 'hover:border-brand-300 hover:bg-brand-50/40'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        if (disabled) return;
        onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <Icon
        name="file"
        size={24}
        className="text-ink-faint transition-colors duration-150 group-hover:text-brand-600"
      />
      <span className="text-[13px] font-medium text-ink-soft">{title}</span>
      <span className="font-mono text-[11px] text-ink-faint">{hint}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        aria-label={title}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

/** 步骤条（hi-fi 06 §3.2：纯展示，aria-current 标当前步，回退只经脚部「上一步」） */
function Stepper({ current }: { current: number }) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t('importWiz.stepsAria')}
      className="shrink-0 border-b border-line-soft px-4 py-3"
    >
      <ol className="flex w-full items-center gap-2">
        {STEP_KEYS.map((key, index) => {
          const stepNo = index + 1;
          const done = stepNo < current;
          const active = stepNo === current;
          const node = (
            <li key={key} className="flex shrink-0 items-center gap-1.5" aria-current={active ? 'step' : undefined}>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium leading-none ${
                  done
                    ? 'bg-success-soft text-success-deep'
                    : active
                      ? 'bg-brand-700 font-semibold text-white'
                      : 'border border-line bg-card text-ink-faint'
                }`}
              >
                {done ? <Icon name="check" size={12} /> : stepNo}
              </span>
              <span
                className={`text-[12px] ${
                  done
                    ? 'text-ink-soft'
                    : active
                      ? 'font-medium text-ink'
                      : 'text-ink-faint'
                }`}
              >
                {t(key)}
              </span>
            </li>
          );
          return stepNo < STEP_KEYS.length
            ? [
                node,
                <span
                  key={`${key}-connector`}
                  className={`h-px flex-1 ${stepNo < current ? 'bg-brand-300' : 'bg-line'}`}
                  aria-hidden="true"
                />,
              ]
            : [node];
        })}
      </ol>
    </nav>
  );
}

/** 绑定源文件 chip（hi-fi 06 §3.4，00 §7.5 chip 规格） */
function SourceChip({ record }: { record: SourceFileRecord }) {
  return (
    <span
      className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-line bg-card px-2 font-mono text-[11px] text-ink-muted"
      title={record.original_name}
    >
      <span className="shrink-0">#{record.id}</span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">{record.original_name}</span>
    </span>
  );
}

/** 已选清单文件行（hi-fi 06 §3.4：文件名 + 移除按钮） */
function ManifestFileRow({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2">
      <Icon name="file" size={14} className="shrink-0 text-ink-faint" />
      <span
        className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink"
        title={file.name}
      >
        {file.name}
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
        {formatFileSize(file.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors duration-150 hover:bg-danger-soft hover:text-danger-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
        aria-label={t('importWiz.removeManifestFile', { name: file.name })}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/** 列结构参考折叠块（hi-fi 06 §3.4，复用 03 §3.2⑩ details 规格） */
function ColumnsReference() {
  const { t } = useI18n();
  return (
    <details className="group rounded-xl border border-line-soft bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[13px] font-medium text-ink-muted outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white">
        {t('importWiz.colsReference')}
        <Icon
          name="chevron-down"
          size={12}
          className="text-ink-faint transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line-soft bg-subtle/50 px-3 py-2.5 font-mono text-[11px] leading-4 text-ink-muted">
        <p className="break-words">{t('importWiz.colsDatasets')}</p>
        <p className="mt-1.5 break-words">{t('importWiz.colsLineage')}</p>
        <p className="mt-1.5 break-words">{t('importWiz.colsLocatorNote')}</p>
      </div>
    </details>
  );
}

/**
 * 导入向导（hi-fi 06）：xl 模态四步向导。
 * ① 上传源文件（POST /files，逐文件上传，任一失败保留已成功项）→
 * ② 上传清单/选格式（本地校验格式一致）→
 * ③ 校验与执行（POST /import 同事务完成）→
 * ④ 批次报告（拒绝行 / 统计 / 报告下载）。
 * busy（上传中/提交中）锁定 Esc、遮罩与关闭；有已上传文件时关闭前二次确认。
 */
export function ImportWizardModal({
  token,
  onClose,
  onCompleted,
  onOpenVersions,
  onNotify,
}: ImportWizardModalProps) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [format, setFormat] = useState<ImportFormat | null>(null);
  const [manifestDatasets, setManifestDatasets] = useState<File | null>(null);
  const [manifestLineage, setManifestLineage] = useState<File | null>(null);
  const [manifest, setManifest] = useState<File | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitErrorState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [nextVersion, setNextVersion] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 步②切换格式的二次确认（评审 R18）：有会被丢弃的已选清单文件时先确认
  const [formatConfirmOpen, setFormatConfirmOpen] = useState(false);
  const pendingFormatRef = useRef<ImportFormat | null>(null);

  const rowSeq = useRef(1);
  const uploadAbort = useRef<AbortController | null>(null);
  const submitAbort = useRef<AbortController | null>(null);

  const uploading = uploadRows.some(
    (row) => row.record === null && row.error === null,
  );
  const busy = uploading || submitting;
  const uploadedRecords = uploadRows
    .map((row) => row.record)
    .filter((record): record is SourceFileRecord => record !== null);

  // 头部「将入库为版本 v{n+1}」：n 取 GET /import/batches 的最大版本号；取不到可靠值则省略徽章
  useEffect(() => {
    const controller = new AbortController();
    getImportBatches(token, controller.signal)
      .then((batches) => {
        if (controller.signal.aborted) return;
        const maxVersion = batches.reduce(
          (max, batch) => Math.max(max, batch.version_no),
          0,
        );
        setNextVersion(maxVersion + 1);
      })
      .catch(() => {
        // 预分配徽章仅提示用途；失败时省略，步骤④仍展示实际版本号
      });
    return () => controller.abort();
  }, [token]);

  // 打开时焦点移入、关闭后焦点还原、Esc 栈顶协议、Tab 圈定、body 滚动锁
  // 均由 ModalShell → useOverlayBehavior 统一承担（评审 R13）

  useEffect(() => {
    return () => {
      uploadAbort.current?.abort();
      submitAbort.current?.abort();
    };
  }, []);

  /** 关闭：导入已完成则等价「完成」（关闭 + 刷新）；无已上传文件直接关；有则先二次确认（hi-fi 06 §一/§八.4） */
  function requestClose() {
    if (busy) return;
    if (result) {
      // 导入已落库，X / Esc / 遮罩关闭均需让工作台刷新（评审 F2）
      onCompleted();
      return;
    }
    if (uploadRows.length > 0) {
      setConfirmOpen(true);
      return;
    }
    onClose();
  }

  /** 步骤①：选择文件后逐文件上传（POST /files）；失败行保留原因，可移除后重选 */
  async function handleSourceFiles(fileList: File[]) {
    if (busy) return;
    const rejected: string[] = [];
    const accepted: UploadRow[] = [];
    fileList.forEach((file) => {
      if (
        !SUPPORTED_EXTENSIONS.includes(
          fileExtension(file.name) as (typeof SUPPORTED_EXTENSIONS)[number],
        )
      ) {
        rejected.push(file.name);
        return;
      }
      accepted.push({
        key: `file-${rowSeq.current}`,
        file,
        record: null,
        error: null,
      });
      rowSeq.current += 1;
    });
    setBatchError(
      rejected.length
        ? t('importWiz.unsupportedFiles', {
            names: rejected.join(locale === 'zh' ? '、' : ', '),
          })
        : null,
    );
    if (!accepted.length) return;

    setUploadRows((current) => [...current, ...accepted]);
    const controller = new AbortController();
    uploadAbort.current?.abort();
    uploadAbort.current = controller;

    for (const row of accepted) {
      if (controller.signal.aborted) return;
      try {
        const [record] = await uploadSourceFiles(token, [row.file], controller.signal);
        if (controller.signal.aborted) return;
        if (!record) {
          // 后端异常返回空数组时按失败行处理，避免 undefined 穿透类型守卫（评审 F4）
          setUploadRows((current) =>
            current.map((item) =>
              item.key === row.key
                ? { ...item, error: t('importWiz.uploadBadResponse') }
                : item,
            ),
          );
          continue;
        }
        setUploadRows((current) =>
          current.map((item) =>
            item.key === row.key ? { ...item, record } : item,
          ),
        );
      } catch (reason) {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setUploadRows((current) =>
          current.map((item) =>
            item.key === row.key
              ? {
                  ...item,
                  error:
                    reason instanceof ApiError
                      ? reason.message
                      : t('importWiz.uploadFailed'),
                }
              : item,
          ),
        );
      }
    }
  }

  /** 步骤②：清单文件本地校验（与所选格式一致，hi-fi 06 §五） */
  function acceptManifestFile(kind: 'datasets' | 'lineage' | 'manifest', file: File) {
    const currentFormat = format;
    if (!currentFormat) return;
    const ext = fileExtension(file.name);
    if (ext !== currentFormat) {
      setManifestError(
        t('importWiz.manifestFormatMismatch', { ext: currentFormat }),
      );
      return;
    }
    setManifestError(null);
    if (kind === 'datasets') setManifestDatasets(file);
    else if (kind === 'lineage') setManifestLineage(file);
    else setManifest(file);
  }

  /** 实际切换格式：静默清空三类已选清单文件与格式级错误 */
  function applyFormatChange(next: ImportFormat) {
    setFormat(next);
    setManifestDatasets(null);
    setManifestLineage(null);
    setManifest(null);
    setManifestError(null);
  }

  /** 步②切换格式（评审 R18）：确有会被丢弃的已选清单文件时先二次确认，取消则不切换 */
  function handleFormatChange(next: ImportFormat) {
    if (next === format) return;
    if (manifestDatasets || manifestLineage || manifest) {
      pendingFormatRef.current = next;
      setFormatConfirmOpen(true);
      return;
    }
    applyFormatChange(next);
  }

  const manifestReady =
    format !== null &&
    (format === 'csv'
      ? manifestDatasets !== null && manifestLineage !== null
      : manifest !== null);

  /** 步骤③：提交即执行（后端同事务完成校验与入库，hi-fi 06 §3.5 映射说明） */
  async function handleSubmitImport() {
    if (!format || !manifestReady || submitting) return;
    const controller = new AbortController();
    submitAbort.current = controller;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = await submitImport(
        token,
        {
          format,
          sourceFileIds: uploadedRecords.map((record) => record.id),
          manifest: format === 'csv' ? null : manifest,
          manifestDatasets: format === 'csv' ? manifestDatasets : null,
          manifestLineage: format === 'csv' ? manifestLineage : null,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResult(payload);
      // 同步预测徽章：再次导入时「将入库为版本 v{n+1}」不显示陈旧值
      setNextVersion(payload.version_no + 1);
      setStep(4);
    } catch (reason) {
      if (controller.signal.aborted || isAbortError(reason)) return;
      setSubmitError({
        message:
          reason instanceof ApiError
            ? reason.message
            : t('common.networkError'),
        retryable: !(reason instanceof ApiError),
      });
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  /** 步骤④：报告 JSON（{batch_id, version_no, report}）序列化为 Blob 下载，无需二次请求 */
  function downloadReport() {
    if (!result) return;
    try {
      const payload = JSON.stringify(
        {
          batch_id: result.batch_id,
          version_no: result.version_no,
          report: result.report,
        },
        null,
        2,
      );
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `import-batch-${result.batch_id}-report.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      onNotify(t('importWiz.reportDownloadFailed'), 'error');
    }
  }

  /** 再次导入：重置回步骤①；步骤①已登记文件保留（sha256 去重，可重复引用） */
  function restart() {
    setStep(1);
    setFormat(null);
    setManifestDatasets(null);
    setManifestLineage(null);
    setManifest(null);
    setManifestError(null);
    setSubmitError(null);
    setResult(null);
    setBatchError(null);
  }

  function goBack() {
    if (busy) return;
    setSubmitError(null);
    setStep((current) => (current === 4 ? 3 : current === 3 ? 2 : 1));
  }

  const versionBadgeValue = result?.version_no ?? nextVersion;
  const failedCount = uploadRows.filter((row) => row.error !== null).length;

  const summaryManifestNames =
    format === 'csv'
      ? [manifestDatasets?.name, manifestLineage?.name]
          .filter((name): name is string => Boolean(name))
          .join(locale === 'zh' ? '、' : ', ')
      : manifest?.name ?? '';

  function renderStepBody(): ReactNode {
    if (step === 1) {
      return (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2.5 text-[12px] leading-5 text-ink-muted">
            <Icon name="info" size={12} className="mt-0.5 shrink-0 text-ink-faint" />
            <span>{t('importWiz.step1Intro')}</span>
          </div>

          {(batchError || failedCount > 0) && (
            <div
              className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-3 text-[12px] leading-5 text-danger-deep"
              role="alert"
            >
              <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
              <span>
                {batchError ??
                  t('importWiz.failedFilesSummary', { count: failedCount })}
              </span>
            </div>
          )}

          <Dropzone
            title={t('importWiz.dropSourceTitle')}
            hint={t('importWiz.dropSourceHint')}
            accept=".csv,.xlsx,.json"
            multiple
            disabled={uploading}
            onFiles={handleSourceFiles}
          />

          {uploadRows.length > 0 && (
            <div className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-card">
              {uploadRows.map((row) => {
                const ext =
                  row.record?.src_type ?? (fileExtension(row.file.name) || '—');
                return (
                  <div
                    key={row.key}
                    className={`flex flex-wrap items-center gap-2.5 px-3 py-2.5 ${
                      row.error ? 'bg-danger-soft' : ''
                    }`}
                  >
                    <Icon
                      name="file"
                      size={14}
                      className="shrink-0 text-ink-faint"
                    />
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink"
                      title={row.file.name}
                    >
                      {row.file.name}
                    </span>
                    {row.error ? (
                      <span className="min-w-0 basis-full break-words text-[12px] leading-4 text-danger-deep">
                        {row.error}
                      </span>
                    ) : row.record ? (
                      <>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
                          {formatFileSize(row.record.size_bytes)}
                        </span>
                        <span className="rounded border border-line bg-page px-1.5 py-px font-mono text-[11px] uppercase text-ink-faint">
                          {ext}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-px font-mono text-[11px] ${
                            row.record.deduped
                              ? 'border border-transparent bg-info-soft text-info-deep'
                              : 'border border-line bg-subtle text-ink-muted'
                          }`}
                        >
                          {row.record.deduped
                            ? t('importWiz.reusedFile', { id: row.record.id })
                            : t('importWiz.newFile', { id: row.record.id })}
                        </span>
                      </>
                    ) : (
                      <span role="status" className="flex items-center gap-2.5">
                        <span
                          className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-brand-200 border-t-brand-600"
                          aria-hidden="true"
                        />
                        <span className="text-[11px] text-ink-faint">
                          {t('importWiz.uploading')}
                        </span>
                      </span>
                    )}
                    {!uploading && (
                      <button
                        type="button"
                        onClick={() => {
                          setUploadRows((current) =>
                            current.filter((item) => item.key !== row.key),
                          );
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors duration-150 hover:bg-danger-soft hover:text-danger-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                        aria-label={t('importWiz.removeFile', {
                          name: row.file.name,
                        })}
                        title={t('importWiz.removeFileTitle')}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-xl border border-line bg-card px-3 py-2.5">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
              {t('importWiz.boundSources', { count: uploadedRecords.length })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {uploadedRecords.map((record) => (
                <SourceChip key={record.id} record={record} />
              ))}
              <button
                type="button"
                onClick={goBack}
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                title={t('importWiz.backToEditTitle')}
              >
                <Icon name="chevron-left" size={12} />
                {t('importWiz.modify')}
              </button>
            </div>
          </div>

          <fieldset className="rounded-xl border border-line bg-card px-3 py-3">
            <legend className="sr-only">{t('importWiz.manifestFormat')}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(FORMAT_HINT_KEYS) as ImportFormat[]).map((value) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 transition-colors duration-150 focus-within:ring-2 focus-within:ring-brand-600/60 ${
                    format === value
                      ? 'border-brand-300 bg-brand-50'
                      : 'border-line hover:border-brand-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="manifest-format"
                    value={value}
                    checked={format === value}
                    onChange={() => handleFormatChange(value)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-mono text-[13px] font-medium text-ink">
                      {value}
                    </span>
                    <span className="mt-1 block text-[12px] leading-4 text-ink-muted">
                      {t(FORMAT_HINT_KEYS[value])}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {format === 'csv' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
                  {t('importWiz.labelDatasetsCsv')}
                </span>
                <Dropzone
                  title={t('importWiz.dropCompactTitle')}
                  hint=".csv"
                  accept=".csv"
                  compact
                  disabled={busy}
                  onFiles={(files) => acceptManifestFile('datasets', files[0])}
                />
                {manifestDatasets && (
                  <ManifestFileRow
                    file={manifestDatasets}
                    onRemove={() => setManifestDatasets(null)}
                  />
                )}
              </div>
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
                  {t('importWiz.labelLineageCsv')}
                </span>
                <Dropzone
                  title={t('importWiz.dropCompactTitle')}
                  hint=".csv"
                  accept=".csv"
                  compact
                  disabled={busy}
                  onFiles={(files) => acceptManifestFile('lineage', files[0])}
                />
                {manifestLineage && (
                  <ManifestFileRow
                    file={manifestLineage}
                    onRemove={() => setManifestLineage(null)}
                  />
                )}
              </div>
            </div>
          )}

          {format === 'xlsx' && (
            <div>
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
                  {t('importWiz.labelXlsxWorkbook')}
                </span>
              <Dropzone
                title={t('importWiz.dropCompactTitle')}
                hint=".xlsx"
                accept=".xlsx"
                compact
                disabled={busy}
                onFiles={(files) => acceptManifestFile('manifest', files[0])}
              />
              {manifest && (
                <ManifestFileRow
                  file={manifest}
                  onRemove={() => setManifest(null)}
                />
              )}
            </div>
          )}

          {format === 'json' && (
            <div>
                <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">
                  {t('importWiz.labelJsonFile')}
                </span>
              <Dropzone
                title={t('importWiz.dropCompactTitle')}
                hint=".json"
                accept=".json"
                compact
                disabled={busy}
                onFiles={(files) => acceptManifestFile('manifest', files[0])}
              />
              {manifest && (
                <ManifestFileRow
                  file={manifest}
                  onRemove={() => setManifest(null)}
                />
              )}
            </div>
          )}

          {manifestError && (
            <p
              className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12px] leading-4 text-danger-deep"
              role="alert"
            >
              <Icon name="warning" size={12} className="mt-0.5 shrink-0" />
              {manifestError}
            </p>
          )}

          <ColumnsReference />
        </div>
      );
    }

    if (step === 3) {
      if (submitting) {
        return (
          <div
            className="flex flex-col items-center justify-center gap-3 py-16 animate-fade-in"
            role="status"
            aria-live="polite"
          >
            <span
              className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
              aria-hidden="true"
            />
            <p className="text-[13px] font-medium text-ink-soft">
              {t('importWiz.validatingImport')}
            </p>
            <p className="text-xs text-ink-muted">
              {t('importWiz.validatingHint')}
            </p>
          </div>
        );
      }

      if (submitError) {
        return (
          <div className="space-y-4 animate-fade-in">
            <div
              className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3"
              role="alert"
            >
              <p className="text-[13px] font-medium text-danger-deep">
                {t('importWiz.importNotExecuted')}
              </p>
              <p className="mt-1 break-words text-[12px] leading-5 text-danger-deep">
                {submitError.message}
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-card px-3 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                >
                  {t('importWiz.backToPrevious')}
                </button>
                {submitError.retryable && (
                  <button
                    type="button"
                    onClick={handleSubmitImport}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-card px-3 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                  >
                    <Icon name="refresh" size={12} />
                    {t('common.retry')}
                  </button>
                )}
              </div>
            </div>
            <SummaryCard
              format={format}
              records={uploadedRecords}
              manifestNames={summaryManifestNames}
            />
          </div>
        );
      }

      return (
        <div className="space-y-4 animate-fade-in">
          <SummaryCard
            format={format}
            records={uploadedRecords}
            manifestNames={summaryManifestNames}
          />
          <div className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5 text-[12px] leading-5 text-brand-800">
            <Icon name="info" size={12} className="mt-0.5 shrink-0 text-brand-700" />
            <span>{t('importWiz.step3Notice')}</span>
          </div>
        </div>
      );
    }

    // step === 4：批次报告（hi-fi 06 §3.6）
    const summary = result?.report.summary;
    const rejectedItems =
      result?.report.items.filter((item) => item.status === 'rejected') ?? [];
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-success/25 bg-success-soft px-3 py-2.5 text-[13px] leading-5 text-success-deep">
          <Icon name="check" size={12} className="shrink-0" />
          <span>
            {t('importWiz.importDone')} · {t('importWiz.importedAsVersion')}{' '}
            <span className="font-mono tabular-nums">v{result?.version_no}</span> ·{' '}
            {t('importWiz.batch')}{' '}
            <span className="font-mono tabular-nums">#{result?.batch_id}</span>
          </span>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('importWiz.statTotal')} value={summary.total} />
            <StatCard label={t('importWiz.statOk')} value={summary.ok} tone="success" />
            <StatCard label={t('importWiz.statMerged')} value={summary.merged} tone="warning" />
            <StatCard
              label={t('importWiz.statRejected')}
              value={summary.rejected}
              tone="danger"
              alert={summary.rejected > 0}
            />
          </div>
        )}

        {summary && summary.rejected === 0 && (
          <p className="text-[12px] text-success-deep">
            {t('importWiz.allRowsOk')}
          </p>
        )}

        {rejectedItems.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-line bg-card">
            <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2 font-mono text-[11px] font-medium text-ink-muted">
              <span className="w-12 shrink-0">{t('importWiz.colRow')}</span>
              <span className="w-16 shrink-0">{t('common.type')}</span>
              <span className="w-[220px] shrink-0">{t('importWiz.colRef')}</span>
              <span className="min-w-0 flex-1">{t('importWiz.colReason')}</span>
            </div>
            <ul className="divide-y divide-line-soft" role="list">
              {rejectedItems.map((item, index) => (
                <li
                  key={`${item.ref}-${item.source_row ?? index}-${index}`}
                  className="flex items-start gap-2 px-3 py-2.5 transition-colors duration-150 hover:bg-brand-50/70"
                >
                  <span className="w-12 shrink-0 font-mono text-[12px] tabular-nums text-ink-soft">
                    {item.source_row ?? '—'}
                  </span>
                  <span className="w-16 shrink-0">
                    <span className="rounded border border-line bg-page px-1.5 py-px font-mono text-[11px] text-ink-faint">
                      {kindLabel(t, item.kind)}
                    </span>
                  </span>
                  <span className="w-[220px] shrink-0 break-all font-mono text-[12px] text-ink">
                    {item.ref}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[12px] leading-5 text-ink-soft">
                    <span className="mr-1.5 inline-flex h-5 items-center rounded-full border border-transparent bg-danger-soft px-1.5 font-mono text-[11px] text-danger-deep">
                      {t('importWiz.statusRejected')}
                    </span>
                    {item.reason ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result && result.report.items.length > 0 && (
          <details className="group rounded-xl border border-line-soft bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[13px] font-medium text-ink-muted outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white">
              {t('importWiz.allResults', {
                count: result.report.summary.total,
              })}
              <Icon
                name="chevron-down"
                size={12}
                className="text-ink-faint transition-transform duration-150 group-open:rotate-180"
              />
            </summary>
            <ul className="divide-y divide-line-soft border-t border-line-soft">
              {result.report.items.map((item, index) => (
                <li
                  key={`${item.ref}-${item.source_row ?? index}-${index}`}
                  className="flex items-start gap-2 px-3 py-2"
                >
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-px font-mono text-[11px] ${
                      STATUS_BADGES[item.status] ?? 'border-line bg-subtle text-ink-muted'
                    }`}
                  >
                    {statusLabel(t, item.status)}
                  </span>
                  <span className="w-14 shrink-0 text-[11px] text-ink-faint">
                    {kindLabel(t, item.kind)}
                  </span>
                  <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink-soft">
                    {item.ref}
                  </span>
                  <span className="hidden min-w-0 flex-1 break-words text-[12px] leading-4 text-ink-muted sm:block">
                    {item.reason ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5 text-[12px] leading-5 text-brand-800">
          <Icon name="info" size={12} className="mt-0.5 shrink-0 text-brand-700" />
          <span>{t('importWiz.step4Notice')}</span>
        </div>
      </div>
    );
  }

  const canProceedFromStep1 = uploadedRecords.length > 0;

  return (
    <>
      <ModalShell
        variant="modal"
        open
        title={t('importWiz.title')}
        titleId="import-wizard-title"
        titleIcon="upload"
        onRequestClose={requestClose}
        dismissable={!busy}
        overlayClassName="p-3 sm:p-6"
        className="flex max-h-[85vh] max-w-[880px] flex-col"
        closeLabel={t('importWiz.closeAria')}
        titleNode={
          <>
            <h2
              id="import-wizard-title"
              className="min-w-0 text-[14px] font-semibold text-ink"
            >
              {t('importWiz.title')}
            </h2>
            {step >= 3 && versionBadgeValue !== null && (
              <span className="hidden rounded-full border border-line bg-subtle px-2 py-px font-mono text-[11px] text-ink-muted sm:inline-flex">
                {result
                  ? t('importWiz.badgeImported', {
                      version: versionBadgeValue,
                    })
                  : t('importWiz.badgeWillImport', {
                      version: versionBadgeValue,
                    })}
              </span>
            )}
          </>
        }
        subHeader={<Stepper current={step} />}
        footerClassName="flex h-12 shrink-0 items-center justify-between gap-2 border-t border-line-soft px-4"
        footer={
          <>
            {step === 4 ? (
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={restart}
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                >
                  <Icon name="plus" size={12} />
                  {t('importWiz.importAgain')}
                </button>
                <button
                  type="button"
                  onClick={downloadReport}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                >
                  <Icon name="download" size={12} />
                  {t('importWiz.downloadReport')}
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 items-center">
                {step > 1 ? (
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={busy}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-card px-3 text-[13px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong"
                  >
                    <Icon name="chevron-left" size={12} />
                    {t('importWiz.prevStep')}
                  </button>
                ) : (
                  <span aria-hidden="true" />
                )}
              </div>
            )}

            {step !== 4 && (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
                {t('importWiz.stepProgress', { step })}
              </span>
            )}

            {step === 4 ? (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenVersions}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-card px-2.5 text-[12px] font-medium text-ink-soft transition-colors duration-150 hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                >
                  <Icon name="tag" size={12} />
                  {t('importWiz.openVersions')}
                </button>
                <button
                  type="button"
                  onClick={onCompleted}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
                >
                  <Icon name="check" size={12} />
                  {t('importWiz.done')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (step === 1) {
                    if (canProceedFromStep1) setStep(2);
                    return;
                  }
                  if (step === 2) {
                    if (manifestReady) setStep(3);
                    return;
                  }
                  void handleSubmitImport();
                }}
                disabled={
                  busy ||
                  (step === 1 && !canProceedFromStep1) ||
                  (step === 2 && !manifestReady)
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-800 active:bg-brand-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                {submitting && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
                )}
                {step === 3
                  ? submitting
                    ? t('importWiz.importing')
                    : t('importWiz.startImport')
                  : t('importWiz.nextStep')}
              </button>
            )}
          </>
        }
      >
        {/* key={step}：步骤切换时重建节点，让 animate-fade-in（200ms）重放（hi-fi 06 §六） */}
        <div key={step}>{renderStepBody()}</div>
      </ModalShell>

      <ConfirmDialog
        open={confirmOpen}
        title={t('importWiz.discardTitle')}
        confirmLabel={t('importWiz.discardConfirm')}
        message={
          <div className="space-y-1.5">
            <p>{t('importWiz.discardMessage')}</p>
          </div>
        }
        onConfirm={() => {
          setConfirmOpen(false);
          onClose();
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={formatConfirmOpen}
        title={t('importWiz.formatSwitchTitle')}
        confirmLabel={t('importWiz.formatSwitchConfirm')}
        message={
          <div className="space-y-1.5">
            <p>{t('importWiz.formatSwitchMessage')}</p>
          </div>
        }
        onConfirm={() => {
          const next = pendingFormatRef.current;
          pendingFormatRef.current = null;
          setFormatConfirmOpen(false);
          if (next) applyFormatChange(next);
        }}
        onCancel={() => {
          pendingFormatRef.current = null;
          setFormatConfirmOpen(false);
        }}
      />
    </>
  );
}

/** 步骤③提交摘要卡（hi-fi 06 §3.5） */
function SummaryCard({
  format,
  records,
  manifestNames,
}: {
  format: ImportFormat | null;
  records: SourceFileRecord[];
  manifestNames: string;
}) {
  const { t } = useI18n();
  return (
    <div className="divide-y divide-line-soft rounded-xl border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
        <span className="text-[12px] text-ink-muted">
          {t('importWiz.manifestFormat')}
        </span>
        <span className="font-mono text-[13px] font-medium text-ink">
          {format ?? '—'}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
        <span className="text-[12px] text-ink-muted">
          {t('importWiz.summaryBoundSources')}
        </span>
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          {records.map((record) => (
            <SourceChip key={record.id} record={record} />
          ))}
          <span className="font-mono text-[11px] tabular-nums text-ink-faint">
            {t('importWiz.fileCount', { count: records.length })}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
        <span className="text-[12px] text-ink-muted">
          {t('importWiz.summaryManifestFiles')}
        </span>
        <span
          className="min-w-0 max-w-full truncate font-mono text-[13px] text-ink"
          title={manifestNames}
        >
          {manifestNames || '—'}
        </span>
      </div>
    </div>
  );

}

/** 步骤④统计卡（hi-fi 06 §3.6） */
function StatCard({
  label,
  value,
  tone = 'neutral',
  alert = false,
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  alert?: boolean;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success-deep'
      : tone === 'warning'
        ? 'text-warning-deep'
        : tone === 'danger'
          ? 'text-danger-deep'
          : 'text-ink';
  return (
    <div
      className={`rounded-xl border bg-card p-3 text-center ${
        alert ? 'border-danger/25' : 'border-line'
      }`}
    >
      <div className={`text-lg font-bold tabular-nums leading-6 ${toneClass}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-ink-muted">{label}</div>
    </div>
  );
}
