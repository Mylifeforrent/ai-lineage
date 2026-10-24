import type {
  LocatorEnvelope,
  PreviewCell,
} from '../types';

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

export function humanizeLocator(locator: LocatorEnvelope | null | undefined): string {
  if (!locator?.type) return '定位器信息不可用';
  const input = asRecord(locator.input) ?? {};
  const resolved = asRecord(locator.resolved) ?? {};

  if (locator.type === 'csv') {
    const header = asText(input.header) ?? asText(resolved.header);
    const column =
      asNumber(resolved.column_index) ??
      asNumber(input.column) ??
      asNumber(resolved.column);
    const parts = ['CSV 源文件'];
    if (header) parts.push(`表头「${header}」`);
    if (column) parts.push(`第 ${column} 列`);
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

    const parts = ['XLSX 源文件'];
    if (sheet) parts.push(`工作表「${sheet}」`);
    if (headerPath.length) {
      parts.push(`表头路径 ${headerPath.map((item) => `「${item}」`).join(' → ')}`);
    }
    if (column) {
      parts.push(
        columnIndex && !inputColumn && !resolvedColumn
          ? `${column} 列`
          : `列 ${column}${columnIndex ? `（第 ${columnIndex} 列）` : ''}`,
      );
    }
    if (rowStart) {
      parts.push(rowEnd ? `数据行 ${rowStart}:${rowEnd}` : `数据行 ${rowStart} 起`);
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
        parts.push(value ? `合并表头「${value}」${range}` : `合并区域 ${range}`);
      }
    }
    return parts.join(' · ');
  }

  if (locator.type === 'json') {
    const jsonPath = asText(input.json_path) ?? asText(resolved.json_path);
    return jsonPath ? `JSON 源文件 · ${jsonPath}` : 'JSON 源文件 · 路径信息缺失';
  }

  return `定位器类型「${locator.type}」`;
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

export function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

/** ISO8601 →「2026-10-23 14:30」（本地阅读用，秒级截断）。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const normalized = value.replace('T', ' ');
  return normalized.length > 16 ? normalized.slice(0, 16) : normalized;
}
