import type {
  LocatorEnvelope,
  PreviewCell,
} from '../types';
import type { Locale, TranslateFn } from '../i18n';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item))
    .filter((item): item is string => Boolean(item));
}

export function columnIndexToLabel(index: number): string {
  if (!Number.isInteger(index) || index < 1) return '—';
  let remainder = index;
  let label = '';
  while (remainder > 0) {
    const modulo = (remainder - 1) % 26;
    label = String.fromCharCode(65 + modulo) + label;
    remainder = Math.floor((remainder - 1) / 26);
  }
  return label;
}

export function locatorTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'csv':
      return 'CSV';
    case 'xlsx':
      return 'XLSX';
    case 'json':
      return 'JSON';
    default:
      return 'UNKNOWN';
  }
}

export function humanizeLocator(
  locator: LocatorEnvelope | null | undefined,
  t: TranslateFn,
): string {
  if (!locator?.type) return t('format.locatorUnavailable');
  const input = asRecord(locator.input) ?? {};
  const resolved = asRecord(locator.resolved) ?? {};

  if (locator.type === 'csv') {
    const header = asText(input.header) ?? asText(resolved.header);
    const column =
      asNumber(resolved.column_index) ??
      asNumber(input.column) ??
      asNumber(resolved.column);
    const parts = [t('format.csvSource')];
    if (header) parts.push(t('format.headerQuoted', { header }));
    if (column) parts.push(t('format.columnOrdinal', { column }));
    return parts.join(' · ');
  }

  if (locator.type === 'xlsx') {
    const sheet = asText(input.sheet) ?? asText(resolved.sheet);
    const headerPath = asTextArray(input.header_path);
    const inputColumn = asText(input.column);
    const resolvedColumn = asText(resolved.column);
    const columnIndex = asNumber(resolved.column_index);
    const column =
      inputColumn ??
      resolvedColumn ??
      (columnIndex ? columnIndexToLabel(columnIndex) : null);
    const rowStart =
      asNumber(resolved.row_start) ?? asNumber(input.row_start);
    const rowEnd = asNumber(resolved.row_end) ?? asNumber(input.row_end);

    const parts = [t('format.xlsxSource')];
    if (sheet) parts.push(t('format.sheetQuoted', { sheet }));
    if (headerPath.length) {
      parts.push(
        t('format.headerPath', {
          path: headerPath.map((item) => `「${item}」`).join(' → '),
        }),
      );
    }
    if (column) {
      if (columnIndex && !inputColumn && !resolvedColumn) {
        parts.push(t('format.columnLetter', { column }));
      } else if (columnIndex) {
        parts.push(t('format.columnWithIndex', { column, columnIndex }));
      } else {
        parts.push(t('format.columnPlain', { column }));
      }
    }
    if (rowStart) {
      parts.push(
        rowEnd
          ? t('format.dataRows', { start: rowStart, end: rowEnd })
          : t('format.dataRowsFrom', { start: rowStart }),
      );
    }

    const anchors = Array.isArray(resolved.merged_anchors)
      ? resolved.merged_anchors
      : [];
    for (const rawAnchor of anchors) {
      const anchor = asRecord(rawAnchor);
      if (!anchor) continue;
      const value = asText(anchor.value);
      const range = asText(anchor.range);
      if (range) {
        parts.push(
          value
            ? t('format.mergedHeader', { value, range })
            : t('format.mergedRange', { range }),
        );
      }
    }
    return parts.join(' · ');
  }

  if (locator.type === 'json') {
    const jsonPath = asText(input.json_path) ?? asText(resolved.json_path);
    return jsonPath
      ? t('format.jsonSourcePath', { path: jsonPath })
      : t('format.jsonSourceMissing');
  }

  return t('format.locatorType', { type: locator.type });
}

export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function displayCell(value: PreviewCell | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && value === '') return '∅';
  return String(value);
}

export function formatJsonValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function formatCount(value: number, locale: Locale = 'zh'): string {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US').format(value);
}

/** ISO8601 →「2026-10-23 14:30」（本地阅读用，秒级截断）。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const normalized = value.replace('T', ' ');
  return normalized.length > 16 ? normalized.slice(0, 16) : normalized;
}

/** 字节数 →「12.4MB / 20.5KB / 512B」（导入向导文件行展示用）。 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
